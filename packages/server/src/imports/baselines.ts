import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { decodeHTML } from "entities/decode";
import type { Executor } from "../database/database.js";
import { MAX_LABELS_PER_PAGE, normalizeLabel } from "../spaces/documents.js";
import { titleKey } from "./confluence/staged.js";
import { groupKey } from "./permissions.js";
import type { ImportReader, ReadContext, SourceContentType, SourcePage, SourceTemplate } from "./source.js";

const PAGE_BATCH = 50;

export interface PageRestrictionState {
  readonly kinds: readonly ("view" | "edit")[];
  readonly holders: readonly string[];
}

export interface SourcePageState {
  readonly sourceId: string;
  readonly type: SourceContentType;
  readonly parentId: string | null;
  readonly title: string;
  readonly version: number;
  readonly checksum: string;
  readonly labels: readonly string[];
  readonly restrictions: PageRestrictionState;
  readonly modifierId: string | null;
  readonly modifiedAt: string | null;
}

export interface SourceTemplateState {
  readonly sourceId: string;
  readonly name: string;
  readonly checksum: string;
}

export interface SourceHolderState {
  readonly key: string;
  readonly kind: "account" | "group" | "organizationMembers" | "anonymous";
  readonly personId: string | null;
  readonly group: string | null;
  readonly permissions: readonly string[];
  readonly checksum: string;
}

export interface PageBaseline {
  readonly sourceId: string;
  readonly targetId: string | null;
  readonly sourceVersion: number | null;
  readonly checksum: string;
  readonly data: {
    readonly type?: SourceContentType;
    readonly parentId?: string | null;
    readonly title?: string;
    readonly labels?: readonly string[];
    readonly restrictions?: PageRestrictionState;
    readonly labelsAt?: string;
  };
  readonly local: {
    readonly revision?: number;
    readonly title?: string;
    readonly parentId?: string | null;
  };
  readonly kept: boolean;
}

const MARKUP_ENTITIES = new Set(["&amp;", "&lt;", "&gt;", "&quot;", "&#38;", "&#60;", "&#62;", "&#34;"]);

export function normalizedBody(body: string): string {
  return body
    .replace(/\r\n?/g, "\n")
    .replace(/&(?:#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});/gi, (entity) =>
      MARKUP_ENTITIES.has(entity.toLowerCase()) ? entity : decodeHTML(entity),
    );
}

export function checksum(...parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("base64url");
}

function cleanLabels(names: readonly string[]): string[] {
  const labels = new Set<string>();
  for (const name of names) {
    try {
      labels.add(normalizeLabel(name));
    } catch {}
  }
  return [...labels].sort().slice(0, MAX_LABELS_PER_PAGE);
}

export function sourceParent(
  page: { readonly type: SourceContentType; readonly parentId: string | null },
  homePageId: string | null,
): string | null {
  return page.type !== "blogPost" && page.parentId && page.parentId !== homePageId ? page.parentId : null;
}

export async function pageStatesOf(
  reader: ImportReader,
  context: ReadContext,
  pages: readonly SourcePage[],
  homePageId: string | null,
): Promise<SourcePageState[]> {
  if (pages.length === 0) return [];
  const ids = pages.map((page) => page.sourceId);
  const bodies = await reader.bodies(context, ids);
  const labels = await reader.labels(context, ids);
  const restrictions = await reader.restrictions(context, ids);
  return pages.map((page) => {
    const own = restrictions.filter((restriction) => restriction.contentId === page.sourceId);
    const holders = new Set<string>();
    for (const restriction of own) {
      if (restriction.personId) holders.add(`${restriction.kind}:person:${restriction.personId}`);
      else if (restriction.group) holders.add(`${restriction.kind}:group:${groupKey(restriction.group)}`);
    }
    return {
      sourceId: page.sourceId,
      type: page.type,
      parentId: page.sourceId === homePageId ? null : sourceParent(page, homePageId),
      title: page.title,
      version: page.version,
      checksum: checksum(page.type, page.title, normalizedBody(bodies.get(page.sourceId)?.content ?? "")),
      labels: cleanLabels(
        labels.filter((label) => label.pageId === page.sourceId).map((label) => label.name),
      ),
      restrictions: {
        kinds: [...new Set(own.map((restriction) => restriction.kind))].sort(),
        holders: [...holders].sort(),
      },
      modifierId: page.modifierId,
      modifiedAt: page.modifiedAt,
    };
  });
}

export async function* sourcePageStates(
  reader: ImportReader,
  context: ReadContext,
): AsyncGenerator<SourcePageState[]> {
  const home = (await reader.space(context)).homePageId;
  let batch: SourcePage[] = [];
  for await (const page of reader.pages(context)) {
    batch.push(page);
    if (batch.length >= PAGE_BATCH) {
      yield await pageStatesOf(reader, context, batch, home);
      batch = [];
    }
  }
  if (batch.length > 0) yield await pageStatesOf(reader, context, batch, home);
}

export function templateState(template: SourceTemplate): SourceTemplateState {
  return {
    sourceId: template.sourceId,
    name: template.name,
    checksum: checksum(template.name, template.description, normalizedBody(template.body)),
  };
}

export async function sourceHolders(
  reader: ImportReader,
  context: ReadContext,
): Promise<SourceHolderState[]> {
  const holders = new Map<
    string,
    {
      kind: SourceHolderState["kind"];
      personId: string | null;
      group: string | null;
      permissions: Set<string>;
    }
  >();
  for await (const permission of reader.spacePermissions(context)) {
    const key = permission.personId
      ? `user:${permission.personId}`
      : permission.group
        ? `group:${groupKey(permission.group)}`
        : permission.allUsers
          ? "allUsers"
          : "anonymous";
    const holder = holders.get(key) ?? {
      kind: permission.personId
        ? ("account" as const)
        : permission.group
          ? ("group" as const)
          : permission.allUsers
            ? ("organizationMembers" as const)
            : ("anonymous" as const),
      personId: permission.personId,
      group: permission.group,
      permissions: new Set<string>(),
    };
    if (permission.type) holder.permissions.add(permission.type.slice(0, 50));
    holders.set(key, holder);
  }
  return [...holders.entries()].map(([key, holder]) => {
    const permissions = [...holder.permissions].sort();
    return {
      key,
      kind: holder.kind,
      personId: holder.personId,
      group: holder.group,
      permissions,
      checksum: checksum(...permissions),
    };
  });
}

export async function recordImportedSpace(
  executor: Executor,
  input: { spaceId: string; importId: string; source: string; sourceSpaceId: string; sourceSpaceKey: string },
): Promise<void> {
  await executor.execute(sql`
    insert into imported_spaces (space_id, import_id, source, source_space_id, source_space_key)
    values (${input.spaceId}, ${input.importId}, ${input.source}, ${input.sourceSpaceId},
      ${input.sourceSpaceKey.toLowerCase()})
    on conflict (space_id) do update set source_space_key = excluded.source_space_key`);
}

export async function recordTitles(
  executor: Executor,
  input: { spaceId: string; spaceKey: string; titles: readonly { sourceId: string; title: string }[] },
): Promise<void> {
  if (input.titles.length === 0) return;
  const rows = input.titles.map((entry) => ({ source_id: entry.sourceId, title_key: titleKey(entry.title) }));
  await executor.execute(sql`
    insert into import_titles (space_id, space_key, title_key, source_id)
    select ${input.spaceId}, ${input.spaceKey.toLowerCase()}, r.title_key, r.source_id
    from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as r(source_id text, title_key text)
    where r.title_key <> ''
    on conflict do nothing`);
}

export async function recordPageBaselines(
  executor: Executor,
  input: {
    spaceId: string;
    importId: string;
    pages: readonly { state: SourcePageState; targetId: string }[];
  },
): Promise<void> {
  if (input.pages.length === 0) return;
  const rows = input.pages.map(({ state, targetId }) => ({
    source_id: state.sourceId,
    target_id: targetId,
    version: state.version,
    checksum: state.checksum,
    data: {
      type: state.type,
      parentId: state.parentId,
      title: state.title,
      labels: state.labels,
      restrictions: state.restrictions,
    },
  }));
  await executor.execute(sql`
    insert into import_baselines (space_id, kind, source_id, target_id, import_id, source_version, checksum, data,
      local, kept, recorded_at)
    select ${input.spaceId}, 'page', r.source_id, r.target_id, ${input.importId}, r.version, r.checksum,
      r.data || jsonb_build_object('labelsAt', now()),
      coalesce((select jsonb_build_object('revision', d.revision, 'title', t.title, 'parentId', t.parent_id)
        from tree_items t join page_documents d on d.item_id = t.id where t.id = r.target_id), '{}'::jsonb),
      false, now()
    from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
      as r(source_id text, target_id uuid, version int, checksum text, data jsonb)
    on conflict (space_id, kind, source_id) do update set target_id = excluded.target_id,
      import_id = excluded.import_id, source_version = excluded.source_version, checksum = excluded.checksum,
      data = excluded.data, local = excluded.local, kept = false, recorded_at = now()`);
}

export async function updateSourceSide(
  executor: Executor,
  input: { spaceId: string; importId: string; state: SourcePageState },
): Promise<void> {
  await executor.execute(sql`
    update import_baselines set import_id = ${input.importId}, source_version = ${input.state.version},
      checksum = ${input.state.checksum},
      data = data || ${JSON.stringify({ title: input.state.title, type: input.state.type })}::jsonb,
      recorded_at = now()
    where space_id = ${input.spaceId} and kind = 'page' and source_id = ${input.state.sourceId}`);
}

export async function recordTemplateBaselines(
  executor: Executor,
  input: {
    spaceId: string;
    importId: string;
    templates: readonly { state: SourceTemplateState; targetId: string }[];
  },
): Promise<void> {
  if (input.templates.length === 0) return;
  const rows = input.templates.map(({ state, targetId }) => ({
    source_id: state.sourceId,
    target_id: targetId,
    checksum: state.checksum,
  }));
  await executor.execute(sql`
    insert into import_baselines (space_id, kind, source_id, target_id, import_id, checksum, local, recorded_at)
    select ${input.spaceId}, 'template', r.source_id, r.target_id, ${input.importId}, r.checksum,
      coalesce((select jsonb_build_object('updatedAt', p.updated_at) from page_templates p where p.id = r.target_id),
        '{}'::jsonb), now()
    from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as r(source_id text, target_id uuid, checksum text)
    on conflict (space_id, kind, source_id) do update set target_id = excluded.target_id,
      import_id = excluded.import_id, checksum = excluded.checksum, local = excluded.local, recorded_at = now()`);
}

export async function recordHolderBaselines(
  executor: Executor,
  input: { spaceId: string; importId: string; holders: readonly SourceHolderState[] },
): Promise<void> {
  if (input.holders.length === 0) return;
  const rows = input.holders.map((holder) => ({
    source_id: holder.key,
    checksum: holder.checksum,
    data: { permissions: holder.permissions },
  }));
  await executor.execute(sql`
    insert into import_baselines (space_id, kind, source_id, import_id, checksum, data, recorded_at)
    select ${input.spaceId}, 'spacePermission', r.source_id, ${input.importId}, r.checksum, r.data, now()
    from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as r(source_id text, checksum text, data jsonb)
    on conflict (space_id, kind, source_id) do update set import_id = excluded.import_id,
      checksum = excluded.checksum, data = excluded.data, recorded_at = now()`);
}

export async function pageBaselines(
  database: Executor,
  spaceId: string,
  sourceIds?: readonly string[],
): Promise<Map<string, PageBaseline>> {
  const rows = await database.execute<{
    source_id: string;
    target_id: string | null;
    source_version: number | null;
    checksum: string;
    data: PageBaseline["data"];
    local: PageBaseline["local"];
    kept: boolean;
  }>(sql`
    select source_id, target_id, source_version, checksum, data, local, kept from import_baselines
    where space_id = ${spaceId} and kind = 'page'
      ${sourceIds ? sql`and source_id = any(${sql.param([...sourceIds])}::text[])` : sql``}`);
  return new Map(
    rows.rows.map((row) => [
      row.source_id,
      {
        sourceId: row.source_id,
        targetId: row.target_id,
        sourceVersion: row.source_version,
        checksum: row.checksum,
        data: row.data,
        local: row.local,
        kept: row.kept,
      },
    ]),
  );
}
