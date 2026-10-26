import { type SQL, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { Executor } from "../database/database.js";
import { currentRequestContext } from "../observability/request-context.js";
import { spaceRoleRank } from "../spaces/roles.js";
import { type SpaceRole, spaceRoles } from "../spaces/schema.js";
import { organizationMembership, spaceRoleConditionFor, tokenSpaceCondition } from "./space-access.js";

export interface ItemAccessOptions {
  editRestriction?: boolean;
}

function rolesFrom(minimum: SpaceRole): SpaceRole[] {
  return spaceRoles.filter((role) => spaceRoleRank(role) >= spaceRoleRank(minimum));
}

export function holderMatches(kind: SQL, id: SQL, account: SQL): SQL {
  return sql`((${kind} = 'account' and ${id} = ${account})
    or (${kind} = 'group' and exists (select 1 from group_members gm
      where gm.group_id = ${id} and gm.account_id = ${account}
        and (gm.expires_at is null or gm.expires_at > now()))))`;
}

export function holderCovers(kind: SQL, id: SQL, account: SQL, organization: SQL): SQL {
  return sql`(${holderMatches(kind, id, account)}
    and (${kind} <> 'account' or ${organizationMembership(organization, account)}))`;
}

export function shareCondition(account: SQL, item: SQL, space: SQL, minimum: SpaceRole): SQL {
  return sql`exists (select 1 from page_shares pshare
    where pshare.item_id = any(${item}.path) and (pshare.item_id = ${item}.id or pshare.include_descendants)
      and pshare.role = any(${sql.param(rolesFrom(minimum))}::space_role[])
      and ${holderCovers(sql`pshare.principal_kind`, sql`pshare.principal_id`, account, sql`${space}.organization_id`)})`;
}

export function linkScopeCondition(link: SQL, account: SQL, space: SQL): SQL {
  return sql`(organization_flag(${space}.organization_id, 'sharing.shareLinks', true) and (
    (${link}.scope = 'anyone' and organization_flag(${space}.organization_id, 'sharing.anyoneLinks', false))
    or (${link}.scope = 'instance' and exists (select 1 from accounts la where la.id = ${account} and la.type = 'standard'))
    or (${link}.scope = 'organization' and exists (select 1 from memberships lm
      where lm.organization_id = ${space}.organization_id and lm.account_id = ${account} and lm.kind = 'member'
        and (lm.expires_at is null or lm.expires_at > now())))
    or (${link}.scope = 'people' and exists (select 1 from share_link_people lp
      where lp.link_id = ${link}.id
        and ${holderCovers(sql`lp.principal_kind`, sql`lp.principal_id`, account, sql`${space}.organization_id`)}))))`;
}

export function activeLinkCondition(link: SQL): SQL {
  return sql`(${link}.revoked_at is null and (${link}.expires_at is null or ${link}.expires_at > now()))`;
}

function linkCondition(account: SQL, item: SQL, space: SQL): SQL {
  return sql`exists (select 1 from share_link_accesses la join share_links l on l.id = la.link_id
    where l.item_id = ${item}.id and la.account_id = ${account} and ${activeLinkCondition(sql`l`)}
      and ${linkScopeCondition(sql`l`, account, space)})`;
}

export function restrictionListedBy(restriction: SQL, covers: (kind: SQL, id: SQL) => SQL): SQL {
  return sql`(exists (select 1 from page_shares rs where rs.item_id = ${restriction}.item_id
      and (${restriction}.kind = 'view' or rs.role = 'editor')
      and ${covers(sql`rs.principal_kind`, sql`rs.principal_id`)})
    or exists (select 1 from page_restriction_holders rh where rh.item_id = ${restriction}.item_id
      and rh.kind = ${restriction}.kind
      and ${covers(sql`rh.principal_kind`, sql`rh.principal_id`)}))`;
}

export function restrictionListedCondition(restriction: SQL, account: SQL, organization: SQL): SQL {
  return restrictionListedBy(restriction, (kind, id) => holderCovers(kind, id, account, organization));
}

export function restrictionHasActiveHolder(restriction: SQL, organization: SQL): SQL {
  const active = (kind: SQL, id: SQL) => sql`((${kind} = 'account' and exists (select 1 from accounts a
      where a.id = ${id} and a.state = 'active' and ${organizationMembership(organization, sql`a.id`)}))
    or (${kind} = 'group' and exists (select 1 from group_members gm join accounts a on a.id = gm.account_id
      where gm.group_id = ${id} and a.state = 'active'
        and (gm.expires_at is null or gm.expires_at > now()))))`;
  return sql`(exists (select 1 from page_shares ps where ps.item_id = ${restriction}.item_id
      and (${restriction}.kind = 'view' or ps.role = 'editor')
      and ${active(sql`ps.principal_kind`, sql`ps.principal_id`)})
    or exists (select 1 from page_restriction_holders rh where rh.item_id = ${restriction}.item_id
      and rh.kind = ${restriction}.kind and ${active(sql`rh.principal_kind`, sql`rh.principal_id`)}))`;
}

export function viewRestrictionCondition(account: SQL, item: SQL, space: SQL): SQL {
  return sql`not exists (select 1 from page_restrictions r
    where r.item_id = any(${item}.path) and r.kind = 'view'
      and not ${restrictionListedCondition(sql`r`, account, sql`${space}.organization_id`)})`;
}

export function editRestrictionCondition(account: SQL, item: SQL, space: SQL): SQL {
  return sql`not exists (select 1 from page_restrictions r
    where r.item_id = ${item}.id and r.kind = 'edit'
      and not ${restrictionListedCondition(sql`r`, account, sql`${space}.organization_id`)})`;
}

export function responsibilityCondition(account: SQL, item: SQL, space: SQL): SQL {
  return sql`(not exists (select 1 from category_responsibilities cr
      where cr.item_id = any(${item}.path)
        and not exists (select 1 from category_responsible_groups cg
          where cg.item_id = cr.item_id
            and ${holderMatches(sql`'group'`, sql`cg.group_id`, account)}))
    or ${spaceRoleConditionFor(account, space, "admin")})`;
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
  const portal = minimum === "reader" ? sql`${space}.type = 'knowledgeBase'` : sql`false`;
  const active = sql`exists (select 1 from accounts ia where ia.id = ${account} and ia.state = 'active'
    and (ia.type <> 'portal' or ${portal}))`;
  const internal = sql`exists (select 1 from accounts sa where sa.id = ${account} and sa.type <> 'portal')`;
  const itemSources = [shareCondition(account, item, space, minimum)];
  if (minimum === "reader") itemSources.push(linkCondition(account, item, space));
  const sources = [
    spaceRoleConditionFor(account, space, minimum),
    sql`(${internal} and (${sql.join(itemSources, sql` or `)}))`,
  ];
  const restrictions = [viewRestrictionCondition(account, item, space)];
  if (options.editRestriction) {
    restrictions.push(
      editRestrictionCondition(account, item, space),
      responsibilityCondition(account, item, space),
    );
  }
  return sql`(${space}.deleted_at is null and ${active}
    and (${sql.join(sources, sql` or `)}) and ${sql.join(restrictions, sql` and `)})`;
}

function unrestrictedCondition(item: SQL): SQL {
  return sql`not exists (select 1 from page_restrictions r where r.item_id = any(${item}.path) and r.kind = 'view')`;
}

export function portalAudienceCondition(principal: Principal, item: SQL, space: SQL): SQL {
  const knowledgeBase = sql`${space}.type = 'knowledgeBase' and ${space}.deleted_at is null`;
  if (principal.type === "system") return sql`true`;
  if (principal.type === "anonymous") {
    return sql`(${knowledgeBase} and ${space}.audience = 'public' and ${unrestrictedCondition(item)})`;
  }
  if (principal.token) return sql`false`;
  const account = sql`${principal.id}::uuid`;
  const portalReader = sql`exists (select 1 from accounts pa
    join portal_readers pr on pr.account_id = pa.id and pr.space_id = ${space}.id
    where pa.id = ${account} and pa.type = 'portal'
    and exists (select 1 from memberships pm where pm.organization_id = ${space}.organization_id
      and pm.account_id = pa.id and (pm.expires_at is null or pm.expires_at > now())))`;
  return sql`(${knowledgeBase}
    and exists (select 1 from accounts aa where aa.id = ${account} and aa.state = 'active')
    and (${space}.audience = 'public' or (${space}.audience = 'portal' and ${portalReader}))
    and ${viewRestrictionCondition(account, item, space)})`;
}

export function portalReadableCondition(principal: Principal, item: SQL, space: SQL): SQL {
  return sql`(${item}.trash_entry_id is null and ${item}.archived_root_id is null
    and (${portalAudienceCondition(principal, item, space)}
      or (${space}.type = 'knowledgeBase' and ${itemRoleCondition(principal, item, space, "reader")})))`;
}

export const LEVEL_ROLES: readonly (SpaceRole | null)[] = [null, "reader", "commenter", "editor"];

export function itemLevel(account: SQL, item: SQL, space: SQL): SQL {
  const readable = sql`(${accountItemCondition(account, item, space, "reader")}
    and (${item}.reader_visible or ${accountItemCondition(account, item, space, "editor")}))`;
  return sql`case
    when ${accountItemCondition(account, item, space, "editor", { editRestriction: true })} then 3
    when ${accountItemCondition(account, item, space, "commenter")} and ${readable} then 2
    when ${readable} then 1 else 0 end`;
}

export function permissionLevel(account: SQL, item: SQL, space: SQL): SQL {
  return sql`case
    when ${accountItemCondition(account, item, space, "editor", { editRestriction: true })} then 3
    when ${accountItemCondition(account, item, space, "commenter")} then 2
    when ${accountItemCondition(account, item, space, "reader")} then 1 else 0 end`;
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
  inactiveSources: ItemGrantSource[];
  viewRestrictions: ViewRestriction[];
  editRestriction: { listed: boolean } | null;
  responsibility: { listed: boolean } | null;
}

export async function itemFacts(
  executor: Executor,
  accountId: string,
  itemId: string,
  options: { fresh?: boolean } = {},
): Promise<ItemFacts | null> {
  return (await itemFactsMany(executor, accountId, [itemId], options)).get(itemId) ?? null;
}

export async function itemFactsMany(
  executor: Executor,
  accountId: string,
  itemIds: readonly string[],
  options: { fresh?: boolean } = {},
): Promise<Map<string, ItemFacts>> {
  const cache = options.fresh ? undefined : currentRequestContext()?.cache;
  const key = (itemId: string) => `authorization:item:${accountId}:${itemId}`;
  const found = new Map<string, ItemFacts>();
  const missing: string[] = [];
  const pending: Promise<void>[] = [];
  const keep = (itemId: string, facts: ItemFacts | null) => {
    if (facts) found.set(itemId, facts);
  };
  for (const itemId of new Set(itemIds)) {
    const existing = cache?.get(key(itemId)) as Promise<ItemFacts | null> | undefined;
    if (existing) pending.push(existing.then((facts) => keep(itemId, facts)));
    else missing.push(itemId);
  }
  if (missing.length > 0) {
    const loading = loadItemFacts(executor, accountId, missing);
    for (const itemId of missing) {
      const one = loading.then((loaded) => loaded.get(itemId) ?? null);
      if (cache) {
        cache.set(key(itemId), one);
        one.catch(() => cache.delete(key(itemId)));
      }
      pending.push(one.then((facts) => keep(itemId, facts)));
    }
  }
  await Promise.all(pending);
  return found;
}

function responsibilityOf(rows: { listed: boolean }[]): { listed: boolean } | null {
  return rows.length === 0 ? null : { listed: rows.every((row) => row.listed) };
}

async function loadItemFacts(
  executor: Executor,
  accountId: string,
  itemIds: readonly string[],
): Promise<Map<string, ItemFacts>> {
  const account = sql`${accountId}::uuid`;
  const ids = sql`${sql.param([...itemIds])}::uuid[]`;
  const targets = sql`targets as (
    select t.id as target, case when cardinality(t.path) > 0 then t.path else array[t.id] end as path,
      s.organization_id, ${organizationMembership(sql`s.organization_id`, account)} as in_organization
    from tree_items t join spaces s on s.id = t.space_id where t.id = any(${ids}))`;
  const items = await executor.execute<{ target: string; path: string[]; in_organization: boolean }>(
    sql`with ${targets} select target, path, in_organization from targets`,
  );
  if (items.rows.length === 0) return new Map();
  const shares = await executor.execute<{
    target: string;
    id: string;
    item_id: string;
    role: SpaceRole;
    principal_kind: "account" | "group";
    principal_id: string;
    group_name: string | null;
  }>(sql`
    with ${targets}
    select x.target, ps.id, ps.item_id, ps.role, ps.principal_kind, ps.principal_id, g.name as group_name
    from targets x join page_shares ps on ps.item_id = any(x.path)
      and (ps.item_id = x.target or ps.include_descendants)
    left join groups g on ps.principal_kind = 'group' and g.id = ps.principal_id
    where ${holderMatches(sql`ps.principal_kind`, sql`ps.principal_id`, account)}
    order by x.target, ps.id`);
  const links = await executor.execute<{ target: string; id: string; scope: string }>(sql`
    select l.item_id as target, l.id, l.scope from share_link_accesses la join share_links l on l.id = la.link_id
    join tree_items t on t.id = l.item_id join spaces s on s.id = t.space_id
    where l.item_id = any(${ids}) and la.account_id = ${account} and ${activeLinkCondition(sql`l`)}
      and ${linkScopeCondition(sql`l`, account, sql`s`)}
    order by l.item_id, l.id`);
  const restrictions = await executor.execute<{
    target: string;
    item_id: string;
    kind: "view" | "edit";
    listed: boolean;
  }>(sql`
    with ${targets}
    select x.target, r.item_id, r.kind,
      ${restrictionListedCondition(sql`r`, account, sql`x.organization_id`)} as listed
    from targets x join page_restrictions r
      on (r.kind = 'view' and r.item_id = any(x.path)) or (r.kind = 'edit' and r.item_id = x.target)
    order by x.target, array_position(x.path, r.item_id)`);
  const responsibilities = await executor.execute<{ target: string; listed: boolean }>(sql`
    with ${targets}
    select x.target, exists (select 1 from category_responsible_groups cg
      where cg.item_id = cr.item_id
        and ${holderMatches(sql`'group'`, sql`cg.group_id`, account)}) as listed
    from targets x join category_responsibilities cr on cr.item_id = any(x.path)`);
  const facts = new Map<string, ItemFacts>();
  for (const row of items.rows) {
    const itemId = row.target;
    const own = <T extends { target: string }>(rows: T[]) => rows.filter((entry) => entry.target === itemId);
    const itemShares = own(shares.rows);
    const itemRestrictions = own(restrictions.rows);
    const edit = itemRestrictions.find((restriction) => restriction.kind === "edit");
    const shareSource = (share: (typeof itemShares)[number]): ItemGrantSource => ({
      type: "share",
      role: share.role,
      itemId: share.item_id,
      inherited: share.item_id !== itemId,
      shareId: share.id,
      via:
        share.principal_kind === "group"
          ? { type: "group", groupId: share.principal_id, name: share.group_name ?? "" }
          : { type: "account" },
    });
    const inert = (share: (typeof itemShares)[number]) =>
      share.principal_kind === "account" && !row.in_organization;
    facts.set(itemId, {
      itemId,
      path: row.path,
      inactiveSources: itemShares.filter(inert).map(shareSource),
      sources: [
        ...itemShares.filter((share) => !inert(share)).map(shareSource),
        ...own(links.rows).map(
          (link): ItemGrantSource => ({ type: "link", linkId: link.id, scope: link.scope }),
        ),
      ],
      viewRestrictions: itemRestrictions
        .filter((restriction) => restriction.kind === "view")
        .map((restriction) => ({ itemId: restriction.item_id, listed: restriction.listed })),
      editRestriction: edit ? { listed: edit.listed } : null,
      responsibility: responsibilityOf(own(responsibilities.rows)),
    });
  }
  return facts;
}
