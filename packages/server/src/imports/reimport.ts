import { uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { AccessImpact } from "../authorization/space-access.js";
import type { Database, Transaction } from "../database/database.js";
import type { JobQueue } from "../jobs/job-queue.js";
import type { PageAccessImpact, PageAccessService } from "../sharing/page-access.js";
import { actorIdOf } from "../spaces/common.js";
import type { PermissionChange, SpacePermissionService } from "../spaces/permissions.js";
import type { SpaceRole } from "../spaces/schema.js";
import { visibleItem } from "../spaces/visibility.js";
import { deleteCredentials } from "./credentials.js";
import { ImportError } from "./errors.js";
import { importWorkJob } from "./jobs.js";
import type { ChangeDecision, ChangeType, PrincipalRef } from "./reimport-compare.js";
import { FILE_RETENTION_DAYS } from "./settings.js";
import { signalImportChange } from "./signals.js";
import type { ImportSource } from "./source.js";

export const changeTabs = ["conflicts", "updates", "deleted", "moved", "permissions"] as const;
export type ChangeTab = (typeof changeTabs)[number];

const TAB_CHANGES: Record<ChangeTab, readonly ChangeType[]> = {
  conflicts: ["conflict"],
  updates: ["new", "updated", "labels"],
  deleted: ["deleted", "gone"],
  moved: ["moved", "movedHere"],
  permissions: ["permission"],
};

const DECISIONS: Record<string, readonly ChangeDecision[]> = {
  conflict: ["pagehall", "source", "both"],
  deleted: ["trash", "keep"],
};

export interface ChangePerson {
  readonly id: string;
  readonly name: string | null;
}

export interface ChangeHolder {
  readonly kind: "account" | "group" | "organizationMembers";
  readonly id: string | null;
  readonly name: string | null;
  readonly sourceName: string | null;
}

export interface ChangeEntryView {
  readonly id: string;
  readonly kind: string;
  readonly change: ChangeType;
  readonly item: { readonly id: string; readonly title: string; readonly spaceKey: string } | null;
  readonly title: string | null;
  readonly sourceTitle: string | null;
  readonly reason: "both" | "editing" | "restricted" | null;
  readonly editing: boolean;
  readonly changedHere: { readonly by: ChangePerson | null; readonly at: Date } | null;
  readonly changedAtSource: Date | null;
  readonly from: { readonly id: string; readonly title: string } | null;
  readonly to: { readonly id: string; readonly title: string } | null;
  readonly labels: { readonly added: readonly string[]; readonly removed: readonly string[] } | null;
  readonly permission: {
    readonly scope: "space" | "page";
    readonly action: string;
    readonly holder: ChangeHolder | null;
    readonly role: string | null;
    readonly currentRole: string | null;
    readonly restriction: string | null;
    readonly applicable: boolean;
  } | null;
  readonly decision: ChangeDecision | null;
  readonly decidedBy: ChangePerson | null;
  readonly decidedAt: Date | null;
  readonly appliedAt: Date | null;
}

export interface ChangeSummary {
  readonly tabs: readonly { readonly tab: ChangeTab; readonly count: number; readonly open: number }[];
  readonly hidden: number;
  readonly counts: Readonly<Record<string, number>>;
  readonly open: number;
  readonly applying: boolean;
}

interface ReimportRow {
  id: string;
  organization_id: string;
  importer_id: string;
  state: string;
  phase: string | null;
  target_space_id: string | null;
  counts: Record<string, number>;
  [key: string]: unknown;
}

interface ChangeRowData {
  id: string;
  kind: string;
  change: ChangeType;
  item_id: string | null;
  target_id: string | null;
  title: string | null;
  item_title: string | null;
  space_key: string | null;
  details: Record<string, unknown>;
  decision: ChangeDecision | null;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: Date | string | null;
  applied_at: Date | string | null;
  updated_by: string | null;
  updated_by_name: string | null;
  updated_at: Date | string | null;
  [key: string]: unknown;
}

function date(value: Date | string | null): Date | null {
  return value === null ? null : new Date(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export class ReimportService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #audit: AuditLog;
  readonly #jobs: JobQueue | undefined;
  readonly #spacePermissions: SpacePermissionService;
  readonly #pageAccess: PageAccessService;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    audit: AuditLog;
    jobs: JobQueue | undefined;
    spacePermissions: SpacePermissionService;
    pageAccess: PageAccessService;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#audit = options.audit;
    this.#jobs = options.jobs;
    this.#spacePermissions = options.spacePermissions;
    this.#pageAccess = options.pageAccess;
  }

  async #row(executor: Database | Transaction, importId: string, lock = false): Promise<ReimportRow> {
    const result = await executor.execute<ReimportRow>(sql`
      select id, organization_id, importer_id, state::text as state, phase, target_space_id, counts from imports
      where id = ${importId} ${lock ? sql`for update` : sql``}`);
    const row = result.rows[0];
    if (!row?.target_space_id) throw new ImportError("importNotFound", "The import does not exist.");
    return row;
  }

  async #readable(viewer: Principal, importId: string): Promise<ReimportRow> {
    await this.#authorization.require(viewer, "import.view", { type: "import", id: importId });
    const row = await this.#row(this.#database, importId);
    if (!["review", "running", "accepted", "superseded"].includes(row.state) || row.phase === "compare") {
      throw new ImportError(
        "changesUnavailable",
        "The changes are listed once Pagehall has compared the export.",
      );
    }
    return row;
  }

  async #resolvable(tx: Transaction, actor: Principal, importId: string): Promise<ReimportRow> {
    await this.#authorization.require(
      actor,
      "import.resolve",
      { type: "import", id: importId },
      { executor: tx },
    );
    const row = await this.#row(tx, importId, true);
    await this.#authorization.require(
      actor,
      "space.manage",
      { type: "space", id: row.target_space_id ?? "" },
      { executor: tx },
    );
    return row;
  }

  #visible(viewer: Principal, options: { counted?: boolean } = {}) {
    return sql`(case
      when c.item_id is not null then exists (select 1 from tree_items t join spaces s on s.id = t.space_id
        where t.id = c.item_id and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)})
      when c.kind = 'page' then ${options.counted === true}
      else exists (select 1 from imports i join spaces s on s.id = i.target_space_id
        where i.id = c.import_id and ${this.#authorization.spaceFilter(viewer, sql`s`)}) end)`;
  }

  static async createDraft(
    tx: Transaction,
    input: { id: string; organizationId: string; importerId: string; source: ImportSource; spaceId: string },
  ): Promise<void> {
    const space = await tx.execute<{
      key: string;
      name: string;
      quarantined: boolean;
      organization_id: string;
      gone: boolean;
      imported: boolean;
      known: boolean;
    }>(sql`
      select s.key, s.name, s.quarantined, s.organization_id,
        exists (select 1 from trash_entries e where e.space_id = s.id and e.kind = 'space') as gone,
        exists (select 1 from imported_spaces i where i.space_id = s.id) as imported,
        exists (select 1 from imports i where i.quarantine_space_id = s.id and i.state = 'accepted') as known
      from spaces s where s.id = ${input.spaceId}`);
    const row = space.rows[0];
    if (!row || row.organization_id !== input.organizationId || row.gone) {
      throw new ImportError(
        "spaceNotImported",
        "Choose a space of this organization that was created by an import.",
      );
    }
    if (row.quarantined) {
      throw new ImportError(
        "importNotAccepted",
        "Accept or discard the first import before importing again.",
      );
    }
    if (!row.imported) {
      throw new ImportError(
        row.known ? "importedBeforeReimports" : "spaceNotImported",
        row.known
          ? "This space was imported before re-imports were possible. Import the export into a new space instead."
          : "Choose a space of this organization that was created by an import.",
      );
    }
    await tx.execute(sql`
      insert into imports (id, organization_id, importer_id, source, target_space_id, space_name, space_key)
      values (${input.id}, ${input.organizationId}, ${input.importerId}, ${input.source}, ${input.spaceId},
        ${row.name}, ${row.key})`);
  }

  static async start(
    tx: Transaction,
    audit: AuditLog,
    actor: Principal,
    row: {
      id: string;
      organization_id: string;
      source: string;
      file_kind: string | null;
      target_space_id: string;
    },
  ): Promise<void> {
    const imported = await tx.execute<{ id: string }>(
      sql`select space_id as id from imported_spaces where space_id = ${row.target_space_id} for update`,
    );
    if (!imported.rows[0]) throw new ImportError("spaceNotImported", "The space no longer exists.");
    const active = await tx.execute<{ id: string; state: string }>(sql`
      select id, state::text as state from imports
      where target_space_id = ${row.target_space_id} and id <> ${row.id} and state in ('running', 'held', 'review')
      for update`);
    const blocking = active.rows.find((entry) => entry.state !== "review");
    if (blocking) {
      throw new ImportError(
        "reimportRunning",
        "Another re-import of this space is running. Start this one when it is finished.",
      );
    }
    const replaced = active.rows[0]?.id ?? null;
    if (replaced) {
      await tx.execute(sql`
        update imports set state = 'superseded', decided_at = now(), updated_at = now(),
          file_expires_at = now() + make_interval(days => ${FILE_RETENTION_DAYS})
        where id = ${replaced}`);
      await tx.execute(sql`delete from import_records where import_id = ${replaced}`);
      await deleteCredentials(tx, audit, {
        importId: replaced,
        organizationId: row.organization_id,
        reason: "replaced",
      });
      await signalImportChange(tx, { importId: replaced, organizationId: row.organization_id });
    }
    await tx.execute(sql`
      update imports set state = 'running', phase = 'compare', checkpoint = '{}'::jsonb, progress_done = 0,
        progress_total = 0, started_at = now(), heartbeat_at = null, error_code = null, updated_at = now()
      where id = ${row.id}`);
    await audit.record(tx, {
      name: "import.reimportStarted",
      actor,
      targetId: row.id,
      fields: {
        source: row.source,
        spaceId: row.target_space_id,
        file: row.file_kind === "folder" ? "folder" : "upload",
        replaced,
      },
      scope: { type: "organization", id: row.organization_id },
    });
  }

  async summary(viewer: Principal, importId: string): Promise<ChangeSummary> {
    const row = await this.#readable(viewer, importId);
    const result = await this.#database.execute<{
      change: ChangeType;
      visible: boolean;
      open: boolean;
      count: number;
    }>(
      sql`
      select c.change, ${this.#visible(viewer, { counted: true })} as visible,
        (c.applied_at is null and c.change in ('conflict', 'deleted') ) as open, count(*)::int as count
      from import_changes c where c.import_id = ${importId}
      group by 1, 2, 3`,
    );
    const tabs = changeTabs.map((tab) => {
      const rows = result.rows.filter((entry) => entry.visible && TAB_CHANGES[tab].includes(entry.change));
      return {
        tab,
        count: rows.reduce((sum, entry) => sum + entry.count, 0),
        open: rows.filter((entry) => entry.open).reduce((sum, entry) => sum + entry.count, 0),
      };
    });
    return {
      tabs,
      hidden: result.rows.filter((entry) => !entry.visible).reduce((sum, entry) => sum + entry.count, 0),
      counts: row.counts ?? {},
      open: result.rows.filter((entry) => entry.open).reduce((sum, entry) => sum + entry.count, 0),
      applying: row.state === "running",
    };
  }

  async changes(
    viewer: Principal,
    importId: string,
    filter: { tab: ChangeTab; after?: string | undefined; limit: number },
  ): Promise<{ entries: ChangeEntryView[]; next: string | null }> {
    await this.#readable(viewer, importId);
    const result = await this.#database.execute<ChangeRowData>(sql`
      select c.id, c.kind, c.change, c.item_id, c.target_id, c.title, t.title as item_title, s.key as space_key,
        c.details, c.decision, c.decided_by, da.name as decided_by_name, c.decided_at, c.applied_at,
        d.updated_by, ua.name as updated_by_name, d.updated_at
      from import_changes c
      left join tree_items t on t.id = c.item_id
      left join spaces s on s.id = t.space_id
      left join page_documents d on d.item_id = c.item_id
      left join accounts ua on ua.id = d.updated_by
      left join accounts da on da.id = c.decided_by
      where c.import_id = ${importId}
        and c.change = any(${sql.param([...TAB_CHANGES[filter.tab]])}::text[])
        and ${this.#visible(viewer)}
        ${filter.after ? sql`and c.id > ${filter.after}` : sql``}
      order by c.id limit ${filter.limit + 1}`);
    const rows = result.rows.slice(0, filter.limit);
    const places = await this.#places(viewer, importId, rows);
    const holders = await this.#holders(rows);
    const entries = rows.map((row) => this.#entry(row, places, holders));
    return { entries, next: result.rows.length > filter.limit ? (rows.at(-1)?.id ?? null) : null };
  }

  async #places(
    viewer: Principal,
    importId: string,
    rows: readonly ChangeRowData[],
  ): Promise<Map<string, { id: string; title: string }>> {
    const sourceIds = rows.flatMap((row) =>
      row.change === "moved" || row.change === "movedHere"
        ? [text(row.details.from), text(row.details.to)].filter((id): id is string => id !== null)
        : [],
    );
    if (sourceIds.length === 0) return new Map();
    const result = await this.#database.execute<{ source_id: string; id: string; title: string }>(sql`
      select distinct on (i.source_id) i.source_id, t.id, t.title from import_items i
      join imports m on m.id = i.import_id
      join imports own on own.id = ${importId}
      join tree_items t on t.id = i.target_id
      join spaces s on s.id = t.space_id
      where i.kind = 'page' and i.source_id = any(${sql.param(sourceIds)}::text[])
        and (m.quarantine_space_id = own.target_space_id or m.target_space_id = own.target_space_id)
        and t.space_id = own.target_space_id
        and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}`);
    return new Map(result.rows.map((row) => [row.source_id, { id: row.id, title: row.title }]));
  }

  async #holders(rows: readonly ChangeRowData[]): Promise<Map<string, string>> {
    const accounts: string[] = [];
    const groups: string[] = [];
    for (const row of rows) {
      const principal = row.details.principal as PrincipalRef | null | undefined;
      if (principal?.kind === "account") accounts.push(principal.id);
      if (principal?.kind === "group") groups.push(principal.id);
    }
    if (accounts.length === 0 && groups.length === 0) return new Map();
    const result = await this.#database.execute<{ id: string; name: string }>(sql`
      select id, name from accounts where id = any(${sql.param(accounts)}::uuid[])
      union all select id, name from groups where id = any(${sql.param(groups)}::uuid[])`);
    return new Map(result.rows.map((row) => [row.id, row.name]));
  }

  #entry(
    row: ChangeRowData,
    places: ReadonlyMap<string, { id: string; title: string }>,
    holders: ReadonlyMap<string, string>,
  ): ChangeEntryView {
    const details = row.details;
    const principal = details.principal as PrincipalRef | null | undefined;
    const holderKind = text(details.holderKind) as ChangeHolder["kind"] | null;
    const permission =
      row.change === "permission"
        ? {
            scope: (details.scope === "page" ? "page" : "space") as "space" | "page",
            action: text(details.action) ?? "",
            holder: holderKind
              ? {
                  kind: holderKind,
                  id: principal?.id ?? null,
                  name: principal?.id ? (holders.get(principal.id) ?? null) : null,
                  sourceName: text(details.sourceName),
                }
              : null,
            role: text(details.role),
            currentRole: text(details.currentRole),
            restriction: text(details.restriction),
            applicable: row.applied_at === null && (holderKind === null || principal !== null),
          }
        : null;
    const reason =
      details.reason === "both" || details.reason === "editing" || details.reason === "restricted"
        ? details.reason
        : null;
    return {
      id: row.id,
      kind: row.kind,
      change: row.change,
      item:
        row.item_id && row.item_title !== null
          ? { id: row.item_id, title: row.item_title, spaceKey: row.space_key ?? "" }
          : null,
      title: row.item_title ?? row.title,
      sourceTitle: text(details.sourceTitle),
      reason: row.change === "conflict" ? reason : null,
      editing: details.editing === true || reason === "editing",
      changedHere:
        row.change === "conflict" && row.updated_at !== null
          ? {
              by: row.updated_by ? { id: row.updated_by, name: row.updated_by_name } : null,
              at: new Date(row.updated_at),
            }
          : null,
      changedAtSource: text(details.sourceModifiedAt)
        ? new Date(text(details.sourceModifiedAt) as string)
        : null,
      from: text(details.from) ? (places.get(text(details.from) as string) ?? null) : null,
      to: text(details.to) ? (places.get(text(details.to) as string) ?? null) : null,
      labels:
        row.change === "labels"
          ? {
              added: (details.added as string[] | undefined) ?? [],
              removed: (details.removed as string[] | undefined) ?? [],
            }
          : null,
      permission,
      decision: row.decision,
      decidedBy: row.decided_by ? { id: row.decided_by, name: row.decided_by_name } : null,
      decidedAt: date(row.decided_at),
      appliedAt: date(row.applied_at),
    };
  }

  async decide(
    actor: Principal,
    importId: string,
    input: { ids: readonly string[]; decision: ChangeDecision | null },
  ): Promise<{ decided: number }> {
    const ids = [...new Set(input.ids)];
    let decided = 0;
    await this.#database.transaction(async (tx) => {
      const row = await this.#resolvable(tx, actor, importId);
      if (!["review", "running"].includes(row.state) || row.phase === "compare") {
        throw new ImportError(
          "reimportNotInReview",
          "Decisions can be made while the changes wait to be applied. Start a new re-import for a newer export.",
        );
      }
      const found = await tx.execute<{ id: string; change: ChangeType; kind: string; applied: boolean }>(sql`
        select c.id, c.change, c.kind, c.applied_at is not null as applied from import_changes c
        where c.import_id = ${importId} and c.id = any(${sql.param(ids)}::uuid[]) and ${this.#visible(actor)}
        order by c.id for update of c`);
      if (found.rows.length !== ids.length) {
        throw new ImportError("changeNotFound", "Some of the chosen changes do not exist. Reload the list.");
      }
      for (const entry of found.rows) {
        if (entry.applied) {
          throw new ImportError(
            "changeApplied",
            "Some of the chosen changes were applied already. Reload the list.",
          );
        }
        const allowed = DECISIONS[entry.change] ?? [];
        if (allowed.length === 0 || (input.decision !== null && !allowed.includes(input.decision))) {
          throw new ImportError("invalidDecision", "This decision does not fit every chosen change.");
        }
      }
      const actorId = actorIdOf(actor);
      await tx.execute(sql`
        update import_changes set decision = ${input.decision},
          decided_by = ${input.decision === null ? null : actorId},
          decided_at = ${input.decision === null ? null : sql`now()`},
          details = details - 'editing'
        where id = any(${sql.param(ids)}::uuid[])`);
      decided = ids.length;
      await this.#audit.record(tx, {
        name: "import.conflictsDecided",
        actor,
        targetId: importId,
        fields: {
          decision: input.decision ?? "undecided",
          conflicts: found.rows.filter((entry) => entry.change === "conflict").length,
          deletions: found.rows.filter((entry) => entry.change === "deleted").length,
          bulk: ids.length > 1,
        },
        scope: { type: "organization", id: row.organization_id },
      });
      await signalImportChange(tx, { importId, organizationId: row.organization_id });
    });
    return { decided };
  }

  async apply(actor: Principal, importId: string): Promise<void> {
    let started = false;
    await this.#database.transaction(async (tx) => {
      const row = await this.#resolvable(tx, actor, importId);
      if (row.state === "running" && row.phase !== "compare") return;
      if (row.state !== "review") {
        throw new ImportError(
          "reimportNotInReview",
          "Only changes that wait to be applied can be applied. Start a new re-import for a newer export.",
        );
      }
      await tx.execute(sql`
        update imports set state = 'running', phase = 'lineage', decided_by = ${actorIdOf(actor)},
          decided_at = now(), checkpoint = jsonb_build_object('applyStartedAt', now()), progress_done = 0,
          progress_total = 0, heartbeat_at = null, updated_at = now()
        where id = ${importId}`);
      await signalImportChange(tx, { importId, organizationId: row.organization_id });
      started = true;
    });
    if (started) {
      await this.#jobs?.enqueue(importWorkJob, { importId }, { idempotencyKey: `${importId}:${uuidv7()}` });
    }
  }

  async #difference(
    tx: Transaction,
    actor: Principal,
    importId: string,
    changeId: string,
  ): Promise<{
    row: ReimportRow;
    spaceId: string;
    itemId: string | null;
    sourceId: string;
    details: Record<string, unknown>;
    applied: boolean;
  }> {
    const row = await this.#resolvable(tx, actor, importId);
    if (!["review", "running", "accepted"].includes(row.state) || row.phase === "compare") {
      throw new ImportError(
        "reimportNotInReview",
        "Permission differences of a replaced re-import are listed again by the newer one.",
      );
    }
    const found = await tx.execute<{
      item_id: string | null;
      source_id: string;
      details: Record<string, unknown>;
      applied: boolean;
    }>(sql`
      select c.item_id, c.source_id, c.details, c.applied_at is not null as applied from import_changes c
      where c.import_id = ${importId} and c.id = ${changeId} and c.change = 'permission' and ${this.#visible(actor)}
      for update of c`);
    const change = found.rows[0];
    if (!change || !row.target_space_id) {
      throw new ImportError("changeNotFound", "The difference does not exist. Reload the list.");
    }
    return {
      row,
      spaceId: row.target_space_id,
      itemId: change.item_id,
      sourceId: change.source_id,
      details: change.details,
      applied: change.applied,
    };
  }

  async #spaceChange(
    tx: Transaction,
    spaceId: string,
    details: Record<string, unknown>,
  ): Promise<PermissionChange> {
    const principal = details.principal as PrincipalRef | null | undefined;
    if (!principal) {
      throw new ImportError(
        "holderNotInPagehall",
        "This person or group is not in Pagehall yet. Map them in the report of the import first.",
      );
    }
    const existing = await tx.execute<{ id: string }>(sql`
      select id from space_permissions where space_id = ${spaceId} and principal_kind = ${principal.kind}
        and principal_id is not distinct from ${principal.id}`);
    const permissionId = existing.rows[0]?.id;
    const role = text(details.role) as SpaceRole | null;
    if (role === null) {
      if (!permissionId) throw new ImportError("differenceResolved", "The difference no longer exists.");
      return { action: "remove", permissionId };
    }
    return permissionId
      ? { action: "change", permissionId, role }
      : { action: "grant", principalKind: principal.kind, principalId: principal.id, role };
  }

  #pageChange(details: Record<string, unknown>) {
    const kind = details.restriction === "edit" ? ("edit" as const) : ("view" as const);
    const action = text(details.action);
    if (action === "restrict" || action === "unrestrict") return { action, kind } as const;
    const principal = details.principal as PrincipalRef | null | undefined;
    if (!principal || principal.kind === "organizationMembers") {
      throw new ImportError(
        "holderNotInPagehall",
        "This person or group is not in Pagehall yet. Map them in the report of the import first.",
      );
    }
    return {
      action: action === "unlistHolder" ? ("unlistHolder" as const) : ("listHolder" as const),
      kind,
      holderKind: principal.kind,
      holderId: principal.id,
    };
  }

  async preview(
    actor: Principal,
    importId: string,
    changeId: string,
  ): Promise<{ space: AccessImpact | null; page: PageAccessImpact | null }> {
    const target = await this.#database.transaction(async (tx) => {
      const found = await this.#difference(tx, actor, importId, changeId);
      if (found.applied) throw new ImportError("changeApplied", "The difference was applied already.");
      return found.details.scope === "page"
        ? { scope: "page" as const, itemId: found.itemId, change: this.#pageChange(found.details) }
        : {
            scope: "space" as const,
            spaceId: found.spaceId,
            change: await this.#spaceChange(tx, found.spaceId, found.details),
          };
    });
    if (target.scope === "page") {
      if (!target.itemId)
        throw new ImportError("changeNotFound", "The difference does not exist. Reload the list.");
      return { space: null, page: await this.#pageAccess.preview(actor, target.itemId, [target.change]) };
    }
    await this.#authorization.require(actor, "space.manage", { type: "space", id: target.spaceId });
    return { space: await this.#spacePermissions.preview(actor, target.spaceId, target.change), page: null };
  }

  async applyDifference(actor: Principal, importId: string, changeId: string): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const found = await this.#difference(tx, actor, importId, changeId);
      if (found.applied) return;
      const principal = found.details.principal as PrincipalRef | null | undefined;
      if (found.details.scope === "page") {
        if (!found.itemId)
          throw new ImportError("changeNotFound", "The difference does not exist. Reload the list.");
        await this.#pageAccess.changeWithin(tx, actor, found.itemId, [this.#pageChange(found.details)]);
      } else {
        await this.#authorization.require(
          actor,
          "space.manage",
          { type: "space", id: found.spaceId },
          { executor: tx },
        );
        await this.#spacePermissions.apply(
          actor,
          found.spaceId,
          await this.#spaceChange(tx, found.spaceId, found.details),
          {
            tx,
          },
        );
      }
      await tx.execute(sql`
        update import_changes set applied_at = now(), applied_by = ${actorIdOf(actor)} where id = ${changeId}`);
      if (found.details.scope === "space" && typeof found.details.checksum === "string") {
        await tx.execute(sql`
          insert into import_baselines (space_id, kind, source_id, import_id, checksum, data)
          values (${found.spaceId}, 'spacePermission', ${found.sourceId}, ${importId}, ${found.details.checksum},
            ${JSON.stringify({ permissions: found.details.permissions ?? [] })}::jsonb)
          on conflict (space_id, kind, source_id) do update set checksum = excluded.checksum, data = excluded.data,
            import_id = excluded.import_id, recorded_at = now()`);
      }
      if (found.details.scope === "space" && found.details.role === null) {
        await tx.execute(sql`
          delete from import_baselines where space_id = ${found.spaceId} and kind = 'spacePermission'
            and source_id = ${found.sourceId}`);
      }
      if (found.details.scope === "page" && found.details.restrictions) {
        const pageId = found.sourceId.slice(0, found.sourceId.indexOf(":"));
        await tx.execute(sql`
          update import_baselines set data = data || jsonb_build_object('restrictions',
            ${JSON.stringify(found.details.restrictions)}::jsonb)
          where space_id = ${found.spaceId} and kind = 'page' and source_id = ${pageId}
            and not exists (select 1 from import_changes c where c.import_id = ${importId} and c.kind = 'restriction'
              and c.applied_at is null and c.source_id like ${`${pageId}:%`})`);
      }
      await this.#audit.record(tx, {
        name: "import.permissionDifferenceApplied",
        actor,
        targetId: importId,
        fields: {
          spaceId: found.spaceId,
          scope: found.details.scope === "page" ? "page" : "space",
          action: (text(found.details.action) ?? "grant") as
            | "grant"
            | "change"
            | "remove"
            | "restrict"
            | "unrestrict"
            | "listHolder"
            | "unlistHolder",
          itemId: found.itemId,
          principalKind: principal?.kind ?? null,
          principalId: principal?.id ?? null,
          role: text(found.details.role),
        },
        scope: { type: "organization", id: found.row.organization_id },
      });
      await signalImportChange(tx, { importId, organizationId: found.row.organization_id });
    });
  }
}
