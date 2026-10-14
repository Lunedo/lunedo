import { type SQL, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import { grantsLevel } from "../authorization/areas.js";
import {
  restrictionListedCondition,
  shareCondition,
  viewRestrictionCondition,
} from "../authorization/item-access.js";
import { spaceRoleConditionFor } from "../authorization/space-access.js";
import type { Executor } from "../database/database.js";
import { spaceRoleRank } from "../spaces/roles.js";
import { type SpaceRole, spaceRoles } from "../spaces/schema.js";

export type ReadLevel = Extract<SpaceRole, "reader" | "editor">;

export interface SearchViewer {
  accountId: string;
  organizationId: string;
  portal: boolean;
  tokens: string[];
  listedRestrictions: string[];
}

function rolesFrom(minimum: ReadLevel): SpaceRole[] {
  return spaceRoles.filter((role) => spaceRoleRank(role) >= spaceRoleRank(minimum));
}

export function readerTokens(item: SQL, space: SQL, minimum: ReadLevel): SQL {
  const roles = sql.param(rolesFrom(minimum));
  const floors =
    minimum === "reader"
      ? sql`union all select 'members:' || ${space}.organization_id where ${space}.visibility = 'organization'
        union all select 'internal' where ${space}.visibility = 'instance'`
      : sql``;
  return sql`array(select distinct token from (
      select case sp.principal_kind
          when 'account' then 'account:' || sp.principal_id
          when 'group' then 'group:' || sp.principal_id
          when 'organizationMembers' then 'members:' || ${space}.organization_id
          else 'internal' end as token
        from space_permissions sp
        where sp.space_id = ${space}.id and sp.role = any(${roles}::space_role[])
      ${floors}
      union all select case ps.principal_kind when 'account' then 'share-account:' else 'share-group:' end || ps.principal_id
        from page_shares ps
        where ps.item_id = any(${item}.path) and (ps.item_id = ${item}.id or ps.include_descendants)
          and ps.role = any(${roles}::space_role[])
    ) granted where token is not null order by token)`;
}

export function restrictionIds(item: SQL): SQL {
  return sql`array(select r.item_id from page_restrictions r
    where r.kind = 'view' and r.item_id = any(${item}.path) order by r.item_id)`;
}

export async function loadViewer(
  executor: Executor,
  principal: Principal,
  organizationId: string,
): Promise<SearchViewer | null> {
  if (principal.type !== "account") return null;
  const { token } = principal;
  if (token) {
    if (!grantsLevel(token.scopes.organization?.spaces, "view")) return null;
    if (token.organizationId && token.organizationId !== organizationId) return null;
  }
  const organization = sql`${organizationId}::uuid`;
  const membership = (kind: SQL) => sql`exists (select 1 from memberships m
    where m.organization_id = ${organization} and m.account_id = a.id ${kind}
      and (m.expires_at is null or m.expires_at > now()))`;
  const result = await executor.execute<{
    type: string;
    in_organization: boolean;
    member: boolean;
    groups: string[];
    listed: string[];
  }>(sql`
    select a.type, ${membership(sql``)} as in_organization, ${membership(sql`and m.kind = 'member'`)} as member,
      array(select gm.group_id::text from group_members gm
        where gm.account_id = a.id and (gm.expires_at is null or gm.expires_at > now())
        order by gm.group_id) as groups,
      array(select r.item_id::text from page_restrictions r
        join tree_items t on t.id = r.item_id join spaces s on s.id = t.space_id
        where r.kind = 'view' and s.organization_id = ${organization}
          and ${restrictionListedCondition(sql`r`, sql`a.id`, organization)}
        order by r.item_id) as listed
    from accounts a where a.id = ${principal.id} and a.state = 'active'`);
  const row = result.rows[0];
  if (!row) return null;
  const portal = row.type === "portal";
  const tokens: string[] = [];
  if (row.in_organization) {
    tokens.push(`account:${principal.id}`);
    if (!portal) tokens.push(`share-account:${principal.id}`);
  }
  for (const group of row.groups) {
    tokens.push(`group:${group}`);
    if (!portal) tokens.push(`share-group:${group}`);
  }
  if (row.member) tokens.push(`members:${organizationId}`);
  if (row.type === "standard") tokens.push("internal");
  return { accountId: principal.id, organizationId, portal, tokens, listedRestrictions: row.listed };
}

export function storedAccessCondition(viewer: SearchViewer, chunk: SQL): SQL {
  return sql`(${chunk}.readers && ${sql.param(viewer.tokens)}::text[]
    and ${chunk}.restrictions <@ ${sql.param(viewer.listedRestrictions)}::uuid[])`;
}

export function liveAccessCondition(viewer: SearchViewer, chunk: SQL, item: SQL, space: SQL): SQL {
  const account = sql`${viewer.accountId}::uuid`;
  const granted = (minimum: ReadLevel) => {
    const sources = [spaceRoleConditionFor(account, space, minimum)];
    if (!viewer.portal) sources.push(shareCondition(account, item, space, minimum));
    return sql`((${sql.join(sources, sql` or `)}) and ${viewRestrictionCondition(account, item, space)})`;
  };
  const commentVisible = sql`(${chunk}.source <> 'comment' or exists (select 1 from comments cm
    join comments cr on cr.id = coalesce(cm.parent_id, cm.id)
    where cm.id = ${chunk}.source_id and cm.item_id = ${item}.id and cm.deleted_at is null
      and (cr.quote is null or cr.quote_public)))`;
  return sql`(${commentVisible} and ((${item}.reader_visible and ${granted("reader")}) or ${granted("editor")}))`;
}
