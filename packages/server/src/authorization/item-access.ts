import { type SQL, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { Executor } from "../database/database.js";
import { currentRequestContext } from "../observability/request-context.js";
import { spaceRoleRank } from "../spaces/roles.js";
import { type SpaceRole, spaceRoles } from "../spaces/schema.js";
import { spaceRoleConditionFor, tokenSpaceCondition } from "./space-access.js";

export interface ItemAccessOptions {
  editRestriction?: boolean;
}

function rolesFrom(minimum: SpaceRole): SpaceRole[] {
  return spaceRoles.filter((role) => spaceRoleRank(role) >= spaceRoleRank(minimum));
}

export function holderCovers(kind: SQL, id: SQL, account: SQL): SQL {
  return sql`((${kind} = 'account' and ${id} = ${account})
    or (${kind} = 'group' and exists (select 1 from group_members gm
      where gm.group_id = ${id} and gm.account_id = ${account}
        and (gm.expires_at is null or gm.expires_at > now()))))`;
}

function shareCondition(account: SQL, item: SQL, minimum: SpaceRole): SQL {
  return sql`exists (select 1 from page_shares ps
    where ps.item_id = any(${item}.path) and (ps.item_id = ${item}.id or ps.include_descendants)
      and ps.role = any(${sql.param(rolesFrom(minimum))}::space_role[])
      and ${holderCovers(sql`ps.principal_kind`, sql`ps.principal_id`, account)})`;
}

export function linkScopeCondition(link: SQL, account: SQL, space: SQL): SQL {
  return sql`(organization_flag(${space}.organization_id, 'sharing.shareLinks', true) and (
    (${link}.scope = 'anyone' and organization_flag(${space}.organization_id, 'sharing.anyoneLinks', false))
    or (${link}.scope = 'instance' and exists (select 1 from accounts la where la.id = ${account} and la.type = 'standard'))
    or (${link}.scope = 'organization' and exists (select 1 from memberships lm
      where lm.organization_id = ${space}.organization_id and lm.account_id = ${account} and lm.kind = 'member'
        and (lm.expires_at is null or lm.expires_at > now())))
    or (${link}.scope = 'people' and exists (select 1 from share_link_people lp
      where lp.link_id = ${link}.id and ${holderCovers(sql`lp.principal_kind`, sql`lp.principal_id`, account)}))))`;
}

export function activeLinkCondition(link: SQL): SQL {
  return sql`(${link}.revoked_at is null and (${link}.expires_at is null or ${link}.expires_at > now()))`;
}

function linkCondition(account: SQL, item: SQL, space: SQL): SQL {
  return sql`exists (select 1 from share_link_accesses la join share_links l on l.id = la.link_id
    where l.item_id = ${item}.id and la.account_id = ${account} and ${activeLinkCondition(sql`l`)}
      and ${linkScopeCondition(sql`l`, account, space)})`;
}

export function viewRestrictionCondition(account: SQL, item: SQL): SQL {
  return sql`not exists (select 1 from page_restrictions r
    where r.item_id = any(${item}.path) and r.kind = 'view'
      and not exists (select 1 from page_shares rs where rs.item_id = r.item_id
        and ${holderCovers(sql`rs.principal_kind`, sql`rs.principal_id`, account)}))`;
}

function editRestrictionCondition(account: SQL, item: SQL): SQL {
  return sql`not exists (select 1 from page_restrictions r
    where r.item_id = ${item}.id and r.kind = 'edit'
      and not exists (select 1 from page_shares rs where rs.item_id = r.item_id and rs.role = 'editor'
        and ${holderCovers(sql`rs.principal_kind`, sql`rs.principal_id`, account)}))`;
}

export function itemRoleCondition(
  principal: Principal,
  item: SQL,
  space: SQL,
  minimum: SpaceRole,
  options: ItemAccessOptions = {},
): SQL {
  if (principal.type === "system") return sql`true`;
  if (principal.type === "anonymous") return sql`false`;
  const token = tokenSpaceCondition(principal, space, minimum);
  return sql`(${token} and ${accountItemCondition(sql`${principal.id}::uuid`, item, space, minimum, options)})`;
}

export function accountItemCondition(
  account: SQL,
  item: SQL,
  space: SQL,
  minimum: SpaceRole,
  options: ItemAccessOptions = {},
): SQL {
  const active = sql`exists (select 1 from accounts ia where ia.id = ${account} and ia.state = 'active' and ia.type <> 'portal')`;
  const sources = [spaceRoleConditionFor(account, space, minimum), shareCondition(account, item, minimum)];
  if (minimum === "reader") sources.push(linkCondition(account, item, space));
  const restrictions = [viewRestrictionCondition(account, item)];
  if (options.editRestriction) restrictions.push(editRestrictionCondition(account, item));
  return sql`(${space}.deleted_at is null and ${active}
    and (${sql.join(sources, sql` or `)}) and ${sql.join(restrictions, sql` and `)})`;
}

export type ItemGrantSource =
  | { type: "share"; role: SpaceRole; itemId: string; inherited: boolean; via: ShareVia; shareId: string }
  | { type: "link"; linkId: string; scope: string };

export type ShareVia = { type: "account" } | { type: "group"; groupId: string; name: string };

export interface ViewRestriction {
  itemId: string;
  listed: boolean;
}

export interface ItemFacts {
  itemId: string;
  path: string[];
  sources: ItemGrantSource[];
  viewRestrictions: ViewRestriction[];
  editRestriction: { listed: boolean } | null;
}

function cached<T>(key: string, load: () => Promise<T>, fresh: boolean): Promise<T> {
  const cache = fresh ? undefined : currentRequestContext()?.cache;
  if (!cache) return load();
  const existing = cache.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const loading = load();
  cache.set(key, loading);
  loading.catch(() => cache.delete(key));
  return loading;
}

export async function itemFacts(
  executor: Executor,
  accountId: string,
  itemId: string,
  options: { fresh?: boolean } = {},
): Promise<ItemFacts | null> {
  return cached(
    `authorization:item:${accountId}:${itemId}`,
    async () => {
      const account = sql`${accountId}::uuid`;
      const item = await executor.execute<{ path: string[]; space_id: string }>(
        sql`select path, space_id from tree_items where id = ${itemId}`,
      );
      const row = item.rows[0];
      if (!row) return null;
      const path = row.path.length > 0 ? row.path : [itemId];
      const shares = await executor.execute<{
        id: string;
        item_id: string;
        role: SpaceRole;
        principal_kind: "account" | "group";
        principal_id: string;
        group_name: string | null;
      }>(sql`
        select ps.id, ps.item_id, ps.role, ps.principal_kind, ps.principal_id, g.name as group_name
        from page_shares ps left join groups g on ps.principal_kind = 'group' and g.id = ps.principal_id
        where ps.item_id = any(${sql.param(path)}::uuid[])
          and (ps.item_id = ${itemId} or ps.include_descendants)
          and ${holderCovers(sql`ps.principal_kind`, sql`ps.principal_id`, account)}
        order by ps.id`);
      const links = await executor.execute<{ id: string; scope: string }>(sql`
        select l.id, l.scope from share_link_accesses la join share_links l on l.id = la.link_id
        join tree_items t on t.id = l.item_id join spaces s on s.id = t.space_id
        where l.item_id = ${itemId} and la.account_id = ${account} and ${activeLinkCondition(sql`l`)}
          and ${linkScopeCondition(sql`l`, account, sql`s`)}
        order by l.id`);
      const restrictions = await executor.execute<{
        item_id: string;
        kind: "view" | "edit";
        listed: boolean;
      }>(sql`
        select r.item_id, r.kind, exists (select 1 from page_shares rs where rs.item_id = r.item_id
          and (r.kind = 'view' or rs.role = 'editor')
          and ${holderCovers(sql`rs.principal_kind`, sql`rs.principal_id`, account)}) as listed
        from page_restrictions r
        where (r.kind = 'view' and r.item_id = any(${sql.param(path)}::uuid[])) or (r.kind = 'edit' and r.item_id = ${itemId})
        order by array_position(${sql.param(path)}::uuid[], r.item_id)`);
      const edit = restrictions.rows.find((restriction) => restriction.kind === "edit");
      return {
        itemId,
        path,
        sources: [
          ...shares.rows.map(
            (share): ItemGrantSource => ({
              type: "share",
              role: share.role,
              itemId: share.item_id,
              inherited: share.item_id !== itemId,
              shareId: share.id,
              via:
                share.principal_kind === "group"
                  ? { type: "group", groupId: share.principal_id, name: share.group_name ?? "" }
                  : { type: "account" },
            }),
          ),
          ...links.rows.map(
            (link): ItemGrantSource => ({ type: "link", linkId: link.id, scope: link.scope }),
          ),
        ],
        viewRestrictions: restrictions.rows
          .filter((restriction) => restriction.kind === "view")
          .map((restriction) => ({ itemId: restriction.item_id, listed: restriction.listed })),
        editRestriction: edit ? { listed: edit.listed } : null,
      };
    },
    options.fresh ?? false,
  );
}
