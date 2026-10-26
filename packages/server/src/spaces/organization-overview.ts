import { type SQL, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database } from "../database/database.js";
import { afterKey, FIRST_PAGE, type Page, type PageRequest, pageLimit, toPage } from "../database/keyset.js";

export interface OrganizationSpaceAdministrator {
  kind: "account" | "group";
  id: string;
  name: string;
}

export interface OrganizationSpaceRow {
  id: string;
  key: string;
  name: string | null;
  type: string;
  visibility: string;
  confidential: boolean;
  archived: boolean;
  administrators: OrganizationSpaceAdministrator[];
  pages: number;
  storageBytes: number;
  lastActivityAt: Date;
  canManage: boolean;
  canDelete: boolean;
}

export interface OrganizationSpaceFilter {
  type?: "standard" | "knowledgeBase" | undefined;
  state?: "active" | "archived" | undefined;
}

interface Row extends Record<string, unknown> {
  id: string;
  key: string;
  name: string;
  type: string;
  visibility: string;
  confidential: boolean;
  archived: boolean;
  pages: string;
  storage: string;
  last_activity_at: Date | string;
  sort_name: string;
}

function sortName(): SQL {
  return sql`lower(case when s.confidential then s.key else s.name end)`;
}

export async function listOrganizationSpaces(
  database: Database,
  authorization: AuthorizationService,
  actor: Principal,
  organizationId: string,
  page: PageRequest = FIRST_PAGE,
  filter: OrganizationSpaceFilter = {},
): Promise<Page<OrganizationSpaceRow>> {
  const search = page.search?.trim().toLowerCase();
  const pattern = search ? `%${search.replace(/[\\%_]/g, (match) => `\\${match}`)}%` : null;
  const result = await database.execute<Row>(sql`
    select s.id, s.key, s.name, s.type::text as type, s.visibility::text as visibility, s.confidential,
      s.archived_at is not null as archived,
      (select count(*) from tree_items t where t.space_id = s.id and t.trash_entry_id is null
        and t.kind in ('page', 'blogPost')) as pages,
      (select coalesce(sum(f.size), 0) from stored_files f where f.id in (
        select av.file_id from attachment_versions av
        join attachments at on at.id = av.attachment_id
        join tree_items t on t.id = at.item_id
        where t.space_id = s.id)) as storage,
      greatest(s.updated_at, coalesce((select max(t.content_updated_at) from tree_items t where t.space_id = s.id),
        s.updated_at)) as last_activity_at,
      ${sortName()} as sort_name
    from spaces s
    where s.organization_id = ${organizationId} and s.deleted_at is null and s.personal_of is null
      and not s.one_on_one
      ${filter.type ? sql`and s.type = ${filter.type}` : sql``}
      ${filter.state === "active" ? sql`and s.archived_at is null` : sql``}
      ${filter.state === "archived" ? sql`and s.archived_at is not null` : sql``}
      ${pattern ? sql`and (lower(s.key) like ${pattern} or (not s.confidential and lower(s.name) like ${pattern}))` : sql``}
      ${page.after ? sql`and ${afterKey([sortName(), sql`s.id`], page.after)}` : sql``}
    order by ${sortName()}, s.id
    limit ${pageLimit(page)}`);
  const paged = toPage(
    result.rows,
    page,
    (row) => [row.sort_name, row.id],
    (row) => row,
  );
  const visible = paged.items.filter((row) => !row.confidential).map((row) => row.id);
  const administrators = new Map<string, OrganizationSpaceAdministrator[]>();
  if (visible.length > 0) {
    const holders = await database.execute<{
      space_id: string;
      kind: "account" | "group";
      id: string;
      name: string;
    }>(sql`
      select sp.space_id, sp.principal_kind::text as kind, sp.principal_id as id,
        coalesce(a.name, g.name) as name
      from space_permissions sp
      left join accounts a on sp.principal_kind = 'account' and a.id = sp.principal_id and a.state = 'active'
      left join groups g on sp.principal_kind = 'group' and g.id = sp.principal_id
      where sp.space_id = any(${sql.param(visible)}::uuid[]) and sp.role = 'admin'
        and coalesce(a.name, g.name) is not null
      order by lower(coalesce(a.name, g.name)), sp.principal_id`);
    for (const holder of holders.rows) {
      administrators.set(holder.space_id, [
        ...(administrators.get(holder.space_id) ?? []),
        { kind: holder.kind, id: holder.id, name: holder.name },
      ]);
    }
  }
  const items: OrganizationSpaceRow[] = [];
  for (const row of paged.items) {
    const resource = { type: "space", id: row.id };
    items.push({
      id: row.id,
      key: row.key,
      name: row.confidential ? null : row.name,
      type: row.type,
      visibility: row.visibility,
      confidential: row.confidential,
      archived: row.archived,
      administrators: administrators.get(row.id) ?? [],
      pages: Number(row.pages),
      storageBytes: Number(row.storage),
      lastActivityAt: new Date(row.last_activity_at),
      canManage: (await authorization.explain(actor, "space.manage", resource)).allowed,
      canDelete: (await authorization.explain(actor, "space.delete", resource)).allowed,
    });
  }
  return { items, next: paged.next };
}
