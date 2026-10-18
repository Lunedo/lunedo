import { sql } from "drizzle-orm";
import type { Database } from "../../../database/database.js";

export interface SnapshotNode {
  readonly type: string;
  readonly attrs?: Record<string, unknown>;
  readonly marks?: { readonly type: string }[];
  readonly content?: SnapshotNode[];
  readonly text?: string;
}

export interface ItemSnapshot {
  readonly path: string;
  readonly kind: string;
  readonly archived: boolean;
  readonly linkUrl: string | null;
  readonly status: string | null;
  readonly owner: string | null;
  readonly labels: string[];
  readonly restrictions: Record<string, string[]>;
  readonly versions: { number: number; title: string; author: string | null }[];
  readonly document: unknown;
  readonly properties: { key: string; text: string }[];
  readonly comments: {
    author: string | null;
    parent: number | null;
    inline: boolean;
    quote: string | null;
    detached: boolean;
    resolved: boolean;
    body: string;
  }[];
  readonly attachments: {
    name: string;
    versions: { size: number; digest: string; author: string | null }[];
  }[];
}

export interface ImportSnapshot {
  readonly description: string;
  readonly items: ItemSnapshot[];
  readonly templates: string[];
  readonly problems: {
    category: string;
    code: string;
    page: string | null;
    details: Record<string, unknown>;
  }[];
  readonly roles: { holder: string; role: string }[];
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

function text(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const value = node as SnapshotNode;
  return (value.text ?? "") + (value.content ?? []).map(text).join("");
}

export function documentNodes(document: unknown): SnapshotNode[] {
  const result: SnapshotNode[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const value = node as SnapshotNode;
    result.push(value);
    for (const child of value.content ?? []) walk(child);
  };
  walk(document);
  return result;
}

export async function importSnapshot(database: Database, importId: string): Promise<ImportSnapshot> {
  const rows = async <T>(query: ReturnType<typeof sql>) =>
    (await database.execute<T & Record<string, unknown>>(query)).rows as T[];
  const [space] = await rows<{
    space_id: string;
    overview_item_id: string;
    key: string;
    description: string;
  }>(sql`
    select s.id as space_id, s.overview_item_id, s.key, s.description from imports i join spaces s on s.id = i.quarantine_space_id
    where i.id = ${importId}`);
  if (!space) throw new Error("The import has no space");
  const people = new Map(
    (
      await rows<{ source_id: string; target_id: string }>(sql`
        select source_id, target_id from import_items where import_id = ${importId} and kind = 'person'`)
    ).map((row) => [row.target_id, row.source_id]),
  );
  const person = (id: string | null) => (id ? (people.get(id) ?? "account:other") : null);
  const items = await rows<{
    id: string;
    parent_id: string | null;
    kind: string;
    title: string;
    archived: boolean;
    link_url: string | null;
    status: string | null;
    owner_id: string | null;
    document: unknown;
  }>(sql`
    select t.id, t.parent_id, t.kind, t.title, t.archived_at is not null as archived, t.link_url, s.name as status,
      t.owner_id, d.snapshot as document
    from tree_items t left join page_documents d on d.item_id = t.id left join page_status_values s on s.id = t.status_id
    where t.space_id = ${space.space_id} and t.trash_entry_id is null`);
  const byId = new Map(items.map((item) => [item.id, item]));
  const pathOf = (id: string): string => {
    const names: string[] = [];
    for (
      let current = byId.get(id);
      current;
      current = current.parent_id ? byId.get(current.parent_id) : undefined
    ) {
      names.unshift(current.id === space.overview_item_id ? "(home)" : current.title);
    }
    return names.join(" › ");
  };
  const grouped = async <T extends { item_id: string }>(query: ReturnType<typeof sql>) => {
    const map = new Map<string, T[]>();
    for (const row of await rows<T>(query)) map.set(row.item_id, [...(map.get(row.item_id) ?? []), row]);
    return map;
  };
  const scope = sql`(select id from tree_items where space_id = ${space.space_id})`;
  const labels = await grouped<{ item_id: string; label: string }>(
    sql`select item_id, label from page_labels where item_id in ${scope} order by label`,
  );
  const restrictions = await grouped<{ item_id: string; kind: string; holder: string | null }>(sql`
    select r.item_id, r.kind, coalesce(h.principal_kind || ':' || h.principal_id::text, '') as holder
    from page_restrictions r left join page_restriction_holders h on h.item_id = r.item_id and h.kind = r.kind
    where r.item_id in ${scope}`);
  const versions = await grouped<{
    item_id: string;
    number: number;
    title: string;
    created_by: string | null;
  }>(sql`
    select item_id, number, title, created_by from page_versions where item_id in ${scope} order by number`);
  const properties = await grouped<{ item_id: string; key: string; text: string }>(sql`
    select item_id, key, text from page_properties where item_id in ${scope} order by block, position`);
  const comments = await grouped<{
    item_id: string;
    id: string;
    parent_id: string | null;
    author_id: string | null;
    quote: string | null;
    detached: boolean;
    resolved: boolean;
    body: unknown;
  }>(sql`
    select item_id, id, parent_id, author_id, quote, detached_at is not null as detached, resolved_at is not null as resolved, body
    from comments where item_id in ${scope} and deleted_at is null order by created_at, id`);
  const attachments = await grouped<{
    item_id: string;
    name: string;
    number: number;
    size: number;
    digest: string;
    uploaded_by: string | null;
  }>(sql`
    select a.item_id, a.name, v.number, f.size, encode(f.content_digest, 'hex') as digest, v.uploaded_by
    from attachments a join attachment_versions v on v.attachment_id = a.id join stored_files f on f.id = v.file_id
    where a.item_id in ${scope} order by a.name, v.number`);
  const holderName = async (holder: string) => {
    const [kind, id] = holder.split(":");
    if (kind === "account") return person(id ?? null) ?? holder;
    if (kind === "group") {
      const [group] = await rows<{ name: string }>(sql`select name from groups where id = ${id}`);
      return `group:${group?.name ?? id}`;
    }
    return holder;
  };
  const result: ItemSnapshot[] = [];
  for (const item of items) {
    const restrictionMap: Record<string, string[]> = {};
    for (const row of restrictions.get(item.id) ?? []) {
      restrictionMap[row.kind] = [...(restrictionMap[row.kind] ?? [])];
      if (row.holder) restrictionMap[row.kind]?.push(await holderName(row.holder));
    }
    for (const kind of Object.keys(restrictionMap)) restrictionMap[kind]?.sort();
    const itemComments = comments.get(item.id) ?? [];
    const commentIndex = new Map(itemComments.map((comment, index) => [comment.id, index]));
    const files = new Map<string, ItemSnapshot["attachments"][number]>();
    for (const row of attachments.get(item.id) ?? []) {
      const entry = files.get(row.name) ?? { name: row.name, versions: [] };
      entry.versions.push({ size: Number(row.size), digest: row.digest, author: person(row.uploaded_by) });
      files.set(row.name, entry);
    }
    result.push({
      path: pathOf(item.id),
      kind: item.kind,
      archived: item.archived,
      linkUrl: item.link_url,
      status: item.status,
      owner: person(item.owner_id),
      labels: (labels.get(item.id) ?? []).map((row) => row.label),
      restrictions: restrictionMap,
      versions: (versions.get(item.id) ?? []).map((row) => ({
        number: row.number,
        title: row.title,
        author: person(row.created_by),
      })),
      document: normalize(item.document, people, space.key),
      properties: (properties.get(item.id) ?? []).map((row) => ({ key: row.key, text: row.text })),
      comments: itemComments.map((comment) => ({
        author: person(comment.author_id),
        parent: comment.parent_id ? (commentIndex.get(comment.parent_id) ?? -1) : null,
        inline: comment.quote !== null,
        quote: comment.quote,
        detached: comment.detached,
        resolved: comment.resolved,
        body: text(comment.body),
      })),
      attachments: [...files.values()],
    });
  }
  result.sort(
    (left, right) => left.path.localeCompare(right.path, "en") || left.kind.localeCompare(right.kind),
  );
  const templates = (
    await rows<{ name: string }>(
      sql`select name from page_templates where space_id = ${space.space_id} order by name`,
    )
  ).map((row) => row.name);
  const problems = (
    await rows<{
      category: string;
      code: string;
      item_id: string | null;
      details: Record<string, unknown>;
    }>(sql`
      select category, code, item_id, details from import_problems where import_id = ${importId}
      order by category, code, key`)
  ).map((row) => ({
    category: row.category,
    code: row.code,
    page: row.item_id && byId.has(row.item_id) ? pathOf(row.item_id) : null,
    details: normalize(row.details, people, space.key) as Record<string, unknown>,
  }));
  const roles = (
    await rows<{
      holder_kind: string;
      account_id: string | null;
      group_key: string | null;
      role: string;
    }>(sql`
      select holder_kind, account_id, group_key, role from import_grants
      where import_id = ${importId} and item_id is null order by holder_kind, group_key, role`)
  ).map((row) => ({
    holder:
      row.holder_kind === "group" ? `group:${row.group_key}` : (person(row.account_id) ?? row.holder_kind),
    role: row.role,
  }));
  roles.sort((left, right) => `${left.holder} ${left.role}`.localeCompare(`${right.holder} ${right.role}`));
  return { description: space.description, items: result, templates, problems, roles };
}

function normalize(value: unknown, people: ReadonlyMap<string, string>, spaceKey: string): unknown {
  if (value === null || value === undefined) return value;
  return JSON.parse(
    JSON.stringify(value)
      .replace(UUID, (id) => (people.has(id) ? `person:${people.get(id)}` : "uuid"))
      .replaceAll(`/spaces/${encodeURIComponent(spaceKey)}/`, "/spaces/(space)/"),
  ) as unknown;
}

export interface Difference {
  readonly page: string;
  readonly field: string;
  readonly left: unknown;
  readonly right: unknown;
}

export function differences(left: ImportSnapshot, right: ImportSnapshot): Difference[] {
  const result: Difference[] = [];
  const rightItems = new Map(right.items.map((item) => [`${item.kind}:${item.path}`, item]));
  const leftItems = new Map(left.items.map((item) => [`${item.kind}:${item.path}`, item]));
  for (const [key, item] of leftItems) {
    const other = rightItems.get(key);
    if (!other) {
      result.push({ page: key, field: "item", left: "present", right: "missing" });
      continue;
    }
    for (const field of Object.keys(item) as (keyof ItemSnapshot)[]) {
      if (JSON.stringify(item[field]) !== JSON.stringify(other[field])) {
        result.push({ page: key, field, left: item[field], right: other[field] });
      }
    }
  }
  for (const key of rightItems.keys()) {
    if (!leftItems.has(key)) result.push({ page: key, field: "item", left: "missing", right: "present" });
  }
  for (const field of ["description", "templates", "problems", "roles"] as const) {
    if (JSON.stringify(left[field]) !== JSON.stringify(right[field])) {
      result.push({ page: "(space)", field, left: left[field], right: right[field] });
    }
  }
  return result;
}
