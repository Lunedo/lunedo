import { uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import type { Database, Executor } from "../database/database.js";
import { fileNameKey } from "../files/names.js";
import { PRESENCE_STALE_SECONDS } from "../spaces/versions.js";
import {
  type PageBaseline,
  pageBaselines,
  type SourceHolderState,
  type SourcePageState,
  sourceHolders,
  sourcePageStates,
  templateState,
} from "./baselines.js";
import { ImportFormatError } from "./errors.js";
import { Narrowing, narrowsView } from "./narrowing.js";
import { externalIdOf, personOf } from "./people.js";
import { roleFor } from "./permissions.js";
import type { ImportReader, ReadContext } from "./source.js";
import type { StagingStore } from "./staging.js";

export const changeKinds = [
  "page",
  "template",
  "comment",
  "attachment",
  "spacePermission",
  "restriction",
] as const;
export type ChangeKind = (typeof changeKinds)[number];
export const changeTypes = [
  "new",
  "updated",
  "conflict",
  "deleted",
  "moved",
  "movedHere",
  "labels",
  "gone",
  "permission",
] as const;
export type ChangeType = (typeof changeTypes)[number];
export const changeDecisions = ["pagehall", "source", "both", "trash", "keep"] as const;
export type ChangeDecision = (typeof changeDecisions)[number];

export interface ChangeRow {
  readonly kind: ChangeKind;
  readonly sourceId: string;
  readonly change: ChangeType;
  readonly itemId: string | null;
  readonly targetId: string | null;
  readonly title: string | null;
  readonly details: Record<string, unknown>;
}

export interface ComparisonCounts {
  new: number;
  updated: number;
  unchanged: number;
  conflicts: number;
  deleted: number;
  moved: number;
  movedHere: number;
  labels: number;
  deletedHere: number;
  newComments: number;
  goneComments: number;
  newAttachmentVersions: number;
  goneAttachments: number;
  newTemplates: number;
  updatedTemplates: number;
  permissions: number;
  restricted: number;
}

export type PrincipalRef =
  | { readonly kind: "account"; readonly id: string }
  | { readonly kind: "group"; readonly id: string }
  | { readonly kind: "organizationMembers"; readonly id: null };

const BATCH = 500;

export async function lineageImports(executor: Executor, spaceId: string): Promise<string[]> {
  const result = await executor.execute<{ id: string }>(sql`
    select id from imports where quarantine_space_id = ${spaceId} or target_space_id = ${spaceId}`);
  return result.rows.map((row) => row.id);
}

export async function openSessions(executor: Executor, itemIds: readonly string[]): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set();
  const result = await executor.execute<{ item_id: string }>(sql`
    select distinct item_id from collaboration_presence
    where item_id = any(${sql.param([...new Set(itemIds)])}::uuid[])
      and seen_at > now() - make_interval(secs => ${PRESENCE_STALE_SECONDS})`);
  return new Set(result.rows.map((row) => row.item_id));
}

export function sourceChanged(state: { version: number; checksum: string }, baseline: PageBaseline): boolean {
  const version = baseline.sourceVersion ?? 0;
  return state.version > version || (state.version === version && state.checksum !== baseline.checksum);
}

export interface LocalPage {
  readonly id: string;
  readonly revision: number;
  readonly title: string;
  readonly parentId: string | null;
  readonly present: boolean;
}

export function changedLocally(page: LocalPage, baseline: PageBaseline): boolean {
  return page.revision !== Number(baseline.local.revision ?? -1) || page.title !== baseline.local.title;
}

export async function localPages(
  executor: Executor,
  itemIds: readonly string[],
): Promise<Map<string, LocalPage>> {
  if (itemIds.length === 0) return new Map();
  const result = await executor.execute<{
    id: string;
    revision: string | number;
    title: string;
    parent_id: string | null;
  }>(sql`
    select t.id, d.revision, t.title, t.parent_id from tree_items t join page_documents d on d.item_id = t.id
    where t.id = any(${sql.param([...new Set(itemIds)])}::uuid[]) and t.trash_entry_id is null`);
  return new Map(
    result.rows.map((row) => [
      row.id,
      {
        id: row.id,
        revision: Number(row.revision),
        title: row.title,
        parentId: row.parent_id,
        present: true,
      },
    ]),
  );
}

export async function resolvePrincipal(
  executor: Executor,
  input: { organizationId: string; lineage: readonly string[] },
  holder: {
    kind: "account" | "group" | "organizationMembers";
    personId: string | null;
    group: string | null;
  },
): Promise<PrincipalRef | null> {
  if (holder.kind === "organizationMembers") return { kind: "organizationMembers", id: null };
  if (holder.kind === "account") {
    if (!holder.personId) return null;
    const external = externalIdOf(personOf(holder.personId));
    if (!external) return null;
    const result = await executor.execute<{ id: string }>(sql`
      select coalesce(a.merged_into_id, a.id) as id from account_external_ids x join accounts a on a.id = x.account_id
      where x.organization_id = ${input.organizationId} and x.source = ${external.source}
        and x.external_id = ${external.id}`);
    const id = result.rows[0]?.id;
    return id ? { kind: "account", id } : null;
  }
  if (!holder.group) return null;
  const key = holder.group.trim().toLocaleLowerCase("en");
  const result = await executor.execute<{ id: string }>(sql`
    select coalesce(
      (select ig.group_id from import_groups ig where ig.import_id = any(${sql.param([...input.lineage])}::uuid[])
        and ig.name_key = ${key} and ig.group_id is not null order by ig.mapped_at desc nulls last limit 1),
      (select g.id from groups g where g.organization_id = ${input.organizationId} and lower(g.name) = ${key}
        order by g.created_at limit 1)) as id`);
  const id = result.rows[0]?.id;
  return id ? { kind: "group", id } : null;
}

export class ReimportComparer {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  async compare(run: {
    importId: string;
    organizationId: string;
    spaceId: string;
    reader: ImportReader;
    staging: StagingStore;
    beat(): Promise<void>;
  }): Promise<ComparisonCounts> {
    const context: ReadContext = { staging: run.staging };
    const source = await run.reader.space(context);
    const imported = await this.#database.execute<{ source_space_id: string }>(sql`
      select source_space_id from imported_spaces where space_id = ${run.spaceId}`);
    if (imported.rows[0]?.source_space_id !== source.sourceId) {
      throw new ImportFormatError(
        "foreignSpace",
        "The export is not from the space this space was imported from.",
      );
    }
    const lineage = await lineageImports(this.#database, run.spaceId);
    const baselines = await pageBaselines(this.#database, run.spaceId);
    const rows: ChangeRow[] = [];
    const counts: ComparisonCounts = {
      new: 0,
      updated: 0,
      unchanged: 0,
      conflicts: 0,
      deleted: 0,
      moved: 0,
      movedHere: 0,
      labels: 0,
      deletedHere: 0,
      newComments: 0,
      goneComments: 0,
      newAttachmentVersions: 0,
      goneAttachments: 0,
      newTemplates: 0,
      updatedTemplates: 0,
      permissions: 0,
      restricted: 0,
    };
    const seen = new Set<string>();
    const titles = new Map<string, string>();
    const parents = new Map<string, string | null>();
    const restrictionChanges: { state: SourcePageState; baseline: PageBaseline; itemId: string }[] = [];
    for await (const states of sourcePageStates(run.reader, context)) {
      const targets = states.flatMap((state) => {
        const target = baselines.get(state.sourceId)?.targetId;
        return target ? [target] : [];
      });
      const local = await localPages(this.#database, targets);
      const present = await openSessions(this.#database, targets);
      for (const state of states) {
        seen.add(state.sourceId);
        titles.set(state.sourceId, state.title);
        parents.set(state.sourceId, state.parentId);
        const baseline = baselines.get(state.sourceId);
        if (!baseline) {
          rows.push({
            kind: "page",
            sourceId: state.sourceId,
            change: "new",
            itemId: null,
            targetId: null,
            title: state.title,
            details: { type: state.type, parentId: state.parentId },
          });
          counts.new += 1;
          continue;
        }
        const page = baseline.targetId ? local.get(baseline.targetId) : undefined;
        if (!page) {
          counts.deletedHere += 1;
          continue;
        }
        let changed = false;
        if (sourceChanged(state, baseline)) {
          changed = true;
          const local = changedLocally(page, baseline);
          const editing = present.has(page.id);
          if (local || editing) {
            rows.push({
              kind: "page",
              sourceId: state.sourceId,
              change: "conflict",
              itemId: page.id,
              targetId: page.id,
              title: page.title,
              details: {
                reason: local ? "both" : "editing",
                sourceTitle: state.title,
                sourceVersion: state.version,
                sourceModifiedAt: state.modifiedAt,
                type: state.type,
              },
            });
            counts.conflicts += 1;
          } else {
            rows.push({
              kind: "page",
              sourceId: state.sourceId,
              change: "updated",
              itemId: page.id,
              targetId: page.id,
              title: page.title,
              details: { sourceTitle: state.title, sourceVersion: state.version, type: state.type },
            });
            counts.updated += 1;
          }
        }
        const before = new Set(baseline.data.labels ?? []);
        const after = new Set(state.labels);
        const added = state.labels.filter((label) => !before.has(label));
        const removed = [...before].filter((label) => !after.has(label));
        if (added.length > 0 || removed.length > 0) {
          changed = true;
          rows.push({
            kind: "page",
            sourceId: state.sourceId,
            change: "labels",
            itemId: page.id,
            targetId: page.id,
            title: page.title,
            details: { added, removed },
          });
          counts.labels += 1;
        }
        if ((baseline.data.parentId ?? null) !== state.parentId && state.sourceId !== source.homePageId) {
          changed = true;
          const here = page.parentId !== (baseline.local.parentId ?? null);
          rows.push({
            kind: "page",
            sourceId: state.sourceId,
            change: here ? "movedHere" : "moved",
            itemId: page.id,
            targetId: page.id,
            title: page.title,
            details: { from: baseline.data.parentId ?? null, to: state.parentId },
          });
          if (here) counts.movedHere += 1;
          else counts.moved += 1;
        }
        if (JSON.stringify(baseline.data.restrictions ?? null) !== JSON.stringify(state.restrictions)) {
          restrictionChanges.push({ state, baseline, itemId: page.id });
        }
        if (!changed) counts.unchanged += 1;
      }
      await run.beat();
    }
    const missing = [...baselines.values()].filter(
      (baseline) => !seen.has(baseline.sourceId) && !baseline.kept && baseline.targetId,
    );
    for (let start = 0; start < missing.length; start += BATCH) {
      const batch = missing.slice(start, start + BATCH);
      const local = await localPages(
        this.#database,
        batch.map((baseline) => baseline.targetId as string),
      );
      for (const baseline of batch) {
        const page = local.get(baseline.targetId as string);
        if (!page) continue;
        rows.push({
          kind: "page",
          sourceId: baseline.sourceId,
          change: "deleted",
          itemId: page.id,
          targetId: page.id,
          title: page.title,
          details: { changedHere: changedLocally(page, baseline) },
        });
        counts.deleted += 1;
      }
    }
    await this.#templates(run, context, rows, counts);
    await this.#comments(run, context, lineage, baselines, titles, rows, counts);
    await this.#attachments(run, context, lineage, baselines, titles, rows, counts);
    const principal = { organizationId: run.organizationId, lineage };
    await this.#spacePermissions(run, context, principal, rows, counts);
    await this.#restrictions(restrictionChanges, principal, rows, counts);
    await this.#holdNarrowed(run.spaceId, baselines, parents, rows, counts);
    await this.#database.transaction(async (tx) => {
      await tx.execute(sql`delete from import_changes where import_id = ${run.importId}`);
      for (let start = 0; start < rows.length; start += BATCH) {
        const chunk = rows.slice(start, start + BATCH).map((row) => ({
          id: uuidv7(),
          kind: row.kind,
          source_id: row.sourceId,
          change: row.change,
          item_id: row.itemId,
          target_id: row.targetId,
          title: row.title,
          details: row.details,
        }));
        await tx.execute(sql`
          insert into import_changes (id, import_id, kind, source_id, change, item_id, target_id, title, details)
          select r.id, ${run.importId}, r.kind, r.source_id, r.change, r.item_id, r.target_id, r.title, r.details
          from jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb)
            as r(id uuid, kind text, source_id text, change text, item_id uuid, target_id uuid, title text, details jsonb)
          on conflict (import_id, kind, source_id, change) do nothing`);
      }
    });
    return counts;
  }

  async #holdNarrowed(
    spaceId: string,
    baselines: ReadonlyMap<string, PageBaseline>,
    parents: ReadonlyMap<string, string | null>,
    rows: ChangeRow[],
    counts: ComparisonCounts,
  ): Promise<void> {
    const narrowing = await Narrowing.load(this.#database, {
      spaceId,
      pending: new Set(
        rows.flatMap((row) =>
          row.change === "permission" && row.itemId && narrowsView(row.details) ? [row.itemId] : [],
        ),
      ),
      sourceParents: parents,
      sourceItems: new Map(
        [...baselines.values()].flatMap((baseline) =>
          baseline.targetId ? [[baseline.sourceId, baseline.targetId] as const] : [],
        ),
      ),
    });
    for (const [index, row] of rows.entries()) {
      if (row.kind !== "page") continue;
      const causes = narrowing.causes({ sourceId: row.sourceId, itemId: row.itemId });
      if (causes.length === 0) continue;
      if (row.change === "updated") {
        rows[index] = {
          ...row,
          change: "conflict",
          details: { ...row.details, reason: "restricted", heldBy: causes },
        };
        counts.updated -= 1;
        counts.conflicts += 1;
      } else if (row.change === "conflict") {
        rows[index] = { ...row, details: { ...row.details, restricted: true, heldBy: causes } };
      } else if (row.change === "new" || row.change === "labels") {
        rows[index] = { ...row, details: { ...row.details, restricted: true, heldBy: causes } };
        counts[row.change] -= 1;
        counts.restricted += 1;
      }
    }
  }

  async #templates(
    run: { spaceId: string; reader: ImportReader },
    context: ReadContext,
    rows: ChangeRow[],
    counts: ComparisonCounts,
  ): Promise<void> {
    const baselines = await this.#database.execute<{
      source_id: string;
      target_id: string | null;
      checksum: string;
      local: { updatedAt?: string };
      updated_at: Date | string | null;
      name: string | null;
    }>(sql`
      select b.source_id, b.target_id, b.checksum, b.local, p.updated_at, p.name from import_baselines b
      left join page_templates p on p.id = b.target_id
      where b.space_id = ${run.spaceId} and b.kind = 'template'`);
    const known = new Map(baselines.rows.map((row) => [row.source_id, row]));
    for await (const template of run.reader.templates(context)) {
      const state = templateState(template);
      const baseline = known.get(state.sourceId);
      if (!baseline) {
        rows.push({
          kind: "template",
          sourceId: state.sourceId,
          change: "new",
          itemId: null,
          targetId: null,
          title: state.name,
          details: {},
        });
        counts.newTemplates += 1;
        continue;
      }
      if (baseline.checksum === state.checksum || !baseline.target_id || baseline.updated_at === null)
        continue;
      const local =
        new Date(baseline.updated_at).getTime() !== new Date(baseline.local.updatedAt ?? 0).getTime();
      rows.push({
        kind: "template",
        sourceId: state.sourceId,
        change: local ? "conflict" : "updated",
        itemId: null,
        targetId: baseline.target_id,
        title: baseline.name ?? state.name,
        details: { reason: "both", sourceTitle: state.name },
      });
      if (local) counts.conflicts += 1;
      else counts.updatedTemplates += 1;
    }
  }

  async #comments(
    run: { spaceId: string; reader: ImportReader },
    context: ReadContext,
    lineage: readonly string[],
    baselines: ReadonlyMap<string, PageBaseline>,
    titles: ReadonlyMap<string, string>,
    rows: ChangeRow[],
    counts: ComparisonCounts,
  ): Promise<void> {
    const pageIds = [...titles.keys()];
    const exported = new Set<string>();
    for (let start = 0; start < pageIds.length; start += 100) {
      const comments = await run.reader.comments(context, pageIds.slice(start, start + 100));
      const ids = comments.map((comment) => comment.sourceId);
      for (const id of ids) exported.add(id);
      const mapped = await this.#database.execute<{ source_id: string }>(sql`
        select distinct source_id from import_items
        where import_id = any(${sql.param([...lineage])}::uuid[]) and kind in ('comment', 'commentSkipped')
          and source_id = any(${sql.param(ids)}::text[])`);
      counts.newComments += ids.length - mapped.rows.length;
    }
    const existing = await this.#database.execute<{
      source_id: string;
      target_id: string;
      item_id: string;
    }>(sql`
      select distinct on (i.source_id) i.source_id, i.target_id, c.item_id from import_items i
      join comments c on c.id = i.target_id
      join tree_items t on t.id = c.item_id
      where i.import_id = any(${sql.param([...lineage])}::uuid[]) and i.kind = 'comment' and c.deleted_at is null
        and t.space_id = ${run.spaceId} and t.trash_entry_id is null`);
    const pagesOf = new Map(
      [...baselines.values()].flatMap((baseline) =>
        baseline.targetId && titles.has(baseline.sourceId)
          ? [[baseline.targetId, baseline.sourceId] as const]
          : [],
      ),
    );
    for (const row of existing.rows) {
      if (exported.has(row.source_id)) continue;
      const page = pagesOf.get(row.item_id);
      if (!page) continue;
      rows.push({
        kind: "comment",
        sourceId: row.source_id,
        change: "gone",
        itemId: row.item_id,
        targetId: row.target_id,
        title: titles.get(page) ?? null,
        details: {},
      });
      counts.goneComments += 1;
    }
  }

  async #attachments(
    run: { spaceId: string; reader: ImportReader },
    context: ReadContext,
    lineage: readonly string[],
    baselines: ReadonlyMap<string, PageBaseline>,
    titles: ReadonlyMap<string, string>,
    rows: ChangeRow[],
    counts: ComparisonCounts,
  ): Promise<void> {
    const names = new Set<string>();
    let batch: string[] = [];
    const flush = async () => {
      const ids = batch;
      batch = [];
      if (ids.length === 0) return;
      const mapped = await this.#database.execute<{ count: number }>(sql`
        select count(distinct source_id)::int as count from import_items
        where import_id = any(${sql.param([...lineage])}::uuid[])
          and kind in ('attachmentVersion', 'attachmentSkipped') and source_id = any(${sql.param(ids)}::text[])`);
      counts.newAttachmentVersions += ids.length - (mapped.rows[0]?.count ?? 0);
    };
    for await (const attachment of run.reader.attachments(context)) {
      names.add(`${attachment.pageId}/${fileNameKey(attachment.fileName)}`);
      batch.push(...attachment.versions.map((version) => version.sourceId));
      if (batch.length >= BATCH) await flush();
    }
    await flush();
    const existing = await this.#database.execute<{
      source_id: string;
      target_id: string;
      item_id: string;
      name: string;
    }>(sql`
      select distinct on (i.source_id) i.source_id, i.target_id, a.item_id, a.name from import_items i
      join attachments a on a.id = i.target_id join tree_items t on t.id = a.item_id
      where i.import_id = any(${sql.param([...lineage])}::uuid[]) and i.kind = 'attachmentName'
        and a.deleted_at is null and t.space_id = ${run.spaceId} and t.trash_entry_id is null`);
    for (const row of existing.rows) {
      const pageId = row.source_id.slice(0, row.source_id.indexOf("/"));
      if (names.has(row.source_id) || !titles.has(pageId) || !baselines.has(pageId)) continue;
      rows.push({
        kind: "attachment",
        sourceId: row.source_id,
        change: "gone",
        itemId: row.item_id,
        targetId: row.target_id,
        title: row.name,
        details: {},
      });
      counts.goneAttachments += 1;
    }
  }

  async #spacePermissions(
    run: { spaceId: string; reader: ImportReader },
    context: ReadContext,
    principal: { organizationId: string; lineage: readonly string[] },
    rows: ChangeRow[],
    counts: ComparisonCounts,
  ): Promise<void> {
    const holders = await sourceHolders(run.reader, context);
    const baselines = await this.#database.execute<{ source_id: string; checksum: string }>(sql`
      select source_id, checksum from import_baselines where space_id = ${run.spaceId} and kind = 'spacePermission'`);
    const before = new Map(baselines.rows.map((row) => [row.source_id, row.checksum]));
    const current = await this.#database.execute<{
      principal_kind: string;
      principal_id: string | null;
      role: string;
    }>(
      sql`select principal_kind::text as principal_kind, principal_id, role::text as role from space_permissions
        where space_id = ${run.spaceId}`,
    );
    const roles = new Map(
      current.rows.map((row) => [`${row.principal_kind}:${row.principal_id ?? ""}`, row.role]),
    );
    const wanted: {
      holder:
        | SourceHolderState
        | { key: string; kind: string; personId: string | null; group: string | null };
      role: string | null;
    }[] = [];
    const keys = new Set(holders.map((holder) => holder.key));
    for (const holder of holders) {
      if (holder.kind === "anonymous" || before.get(holder.key) === holder.checksum) continue;
      wanted.push({ holder, role: roleFor(new Set(holder.permissions)).role });
    }
    for (const key of before.keys()) {
      if (keys.has(key) || key === "anonymous") continue;
      const holder = key.startsWith("user:")
        ? { key, kind: "account", personId: key.slice(5), group: null }
        : key.startsWith("group:")
          ? { key, kind: "group", personId: null, group: key.slice(6) }
          : { key, kind: "organizationMembers", personId: null, group: null };
      wanted.push({ holder, role: null });
    }
    for (const { holder, role } of wanted) {
      const resolved = await resolvePrincipal(this.#database, principal, {
        kind: holder.kind as "account" | "group" | "organizationMembers",
        personId: holder.personId,
        group: holder.group,
      });
      const currentRole = resolved ? (roles.get(`${resolved.kind}:${resolved.id ?? ""}`) ?? null) : null;
      if (resolved && currentRole === role) continue;
      if (!resolved && role === null) continue;
      rows.push({
        kind: "spacePermission",
        sourceId: holder.key,
        change: "permission",
        itemId: null,
        targetId: null,
        title: null,
        details: {
          scope: "space",
          action: currentRole === null ? "grant" : role === null ? "remove" : "change",
          holderKind: holder.kind,
          sourceName: holder.group ?? holder.personId,
          principal: resolved,
          role,
          currentRole,
          checksum: "checksum" in holder ? holder.checksum : null,
          permissions: "permissions" in holder ? holder.permissions : [],
        },
      });
      counts.permissions += 1;
    }
  }

  async #restrictions(
    changes: readonly { state: SourcePageState; baseline: PageBaseline; itemId: string }[],
    principal: { organizationId: string; lineage: readonly string[] },
    rows: ChangeRow[],
    counts: ComparisonCounts,
  ): Promise<void> {
    for (const { state, baseline, itemId } of changes) {
      const kinds = await this.#database.execute<{ kind: "view" | "edit" }>(sql`
        select kind::text as kind from page_restrictions where item_id = ${itemId}`);
      const local = new Set(kinds.rows.map((row) => row.kind));
      const before = baseline.data.restrictions ?? { kinds: [], holders: [] };
      const title = baseline.local.title ?? state.title;
      for (const kind of ["view", "edit"] as const) {
        const now = state.restrictions.kinds.includes(kind);
        if (now === before.kinds.includes(kind) || now === local.has(kind)) continue;
        rows.push({
          kind: "restriction",
          sourceId: `${state.sourceId}:${now ? "restrict" : "unrestrict"}:${kind}`,
          change: "permission",
          itemId,
          targetId: itemId,
          title,
          details: {
            scope: "page",
            action: now ? "restrict" : "unrestrict",
            restriction: kind,
            restrictions: state.restrictions,
          },
        });
        counts.permissions += 1;
      }
      const added = state.restrictions.holders.filter((holder) => !before.holders.includes(holder));
      const removed = before.holders.filter((holder) => !state.restrictions.holders.includes(holder));
      for (const [action, list] of [
        ["listHolder", added],
        ["unlistHolder", removed],
      ] as const) {
        for (const entry of list) {
          const [kind, holderKind, ...rest] = entry.split(":");
          const id = rest.join(":");
          const resolved = await resolvePrincipal(this.#database, principal, {
            kind: holderKind === "person" ? "account" : "group",
            personId: holderKind === "person" ? id : null,
            group: holderKind === "group" ? id : null,
          });
          if (resolved?.kind === "organizationMembers") continue;
          const listed = resolved
            ? await this.#database.execute<{ found: boolean }>(sql`
                select exists (select 1 from page_restriction_holders where item_id = ${itemId} and kind = ${kind}
                  and principal_kind = ${resolved.kind} and principal_id = ${resolved.id}) as found`)
            : null;
          const isListed = listed?.rows[0]?.found === true;
          if (resolved && isListed === (action === "listHolder")) continue;
          if (!resolved && action === "unlistHolder") continue;
          rows.push({
            kind: "restriction",
            sourceId: `${state.sourceId}:${action}:${entry}`,
            change: "permission",
            itemId,
            targetId: itemId,
            title,
            details: {
              scope: "page",
              action,
              restriction: kind,
              holderKind: holderKind === "person" ? "account" : "group",
              sourceName: id,
              principal: resolved,
              restrictions: state.restrictions,
            },
          });
          counts.permissions += 1;
        }
      }
    }
  }
}
