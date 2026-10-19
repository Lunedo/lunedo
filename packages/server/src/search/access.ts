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
  accountId: string | null;
  organizationId: string;
  portal: boolean;
  knowledgeBaseOnly: boolean;
  tokens: string[];
  personalTokens: string[];
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
        union all select 'internal' where ${space}.visibility = 'instance'
        union all select '${sql.raw(PUBLIC_TOKEN)}' where ${space}.type = 'knowledgeBase' and ${space}.audience = 'public'
        union all select 'portal:' || ${space}.organization_id
          where ${space}.type = 'knowledgeBase' and ${space}.audience = 'portal'`
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

export const PUBLIC_TOKEN = "public";

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
        where r.kind = 'view' and (s.organization_id = ${organization} or s.personal_of is not null)
          and ${restrictionListedCondition(sql`r`, sql`a.id`, sql`s.organization_id`)}
        order by r.item_id) as listed
    from accounts a where a.id = ${principal.id} and a.state = 'active'`);
  const row = result.rows[0];
  if (!row) return null;
  const portal = row.type === "portal";
  const own = [`account:${principal.id}`, ...(portal ? [] : [`share-account:${principal.id}`])];
  const shared: string[] = [];
  for (const group of row.groups) {
    shared.push(`group:${group}`);
    if (!portal) shared.push(`share-group:${group}`);
  }
  if (row.type === "standard") shared.push("internal");
  const tokens = [...(row.in_organization ? own : []), ...shared];
  if (row.member) tokens.push(`members:${organizationId}`);
  const personalTokens = token?.organizationId ? [] : [...own, ...shared];
  return {
    accountId: principal.id,
    organizationId,
    portal,
    knowledgeBaseOnly: portal,
    tokens,
    personalTokens,
    listedRestrictions: row.listed,
  };
}

export async function loadPortalViewer(
  executor: Executor,
  principal: Principal,
  organizationId: string,
): Promise<SearchViewer | null> {
  if (principal.type === "anonymous") {
    return {
      accountId: null,
      organizationId,
      portal: false,
      knowledgeBaseOnly: true,
      tokens: [PUBLIC_TOKEN],
      personalTokens: [],
      listedRestrictions: [],
    };
  }
  if (principal.type !== "account" || principal.token) return null;
  const viewer = await loadViewer(executor, principal, organizationId);
  if (!viewer) return null;
  const tokens = [...viewer.tokens, PUBLIC_TOKEN];
  if (viewer.portal && viewer.tokens.includes(`account:${principal.id}`))
    tokens.push(`portal:${organizationId}`);
  return { ...viewer, knowledgeBaseOnly: true, tokens, personalTokens: [] };
}

function audienceFloor(viewer: SearchViewer, target: SQL, targetSpace: SQL): SQL {
  const audiences = [sql`${targetSpace}.audience = 'public'`];
  if (viewer.tokens.includes(`portal:${viewer.organizationId}`))
    audiences.push(sql`${targetSpace}.audience = 'portal'`);
  if (!viewer.tokens.includes(PUBLIC_TOKEN)) return sql`false`;
  const unrestricted =
    viewer.accountId === null
      ? sql`not exists (select 1 from page_restrictions r where r.item_id = any(${target}.path) and r.kind = 'view')`
      : viewRestrictionCondition(sql`${viewer.accountId}::uuid`, target, targetSpace);
  return sql`(${target}.reader_visible and ${targetSpace}.type = 'knowledgeBase'
    and (${sql.join(audiences, sql` or `)}) and ${unrestricted})`;
}

export function storedAccessCondition(viewer: SearchViewer, chunk: SQL): SQL {
  const granted = (
    readers: SQL,
  ) => sql`((${chunk}.organization_id is not null and ${readers} && ${sql.param(viewer.tokens)}::text[])
      or (${chunk}.organization_id is null and ${readers} && ${sql.param(viewer.personalTokens)}::text[]))`;
  const listed = sql`${sql.param(viewer.listedRestrictions)}::uuid[]`;
  return sql`(${granted(sql`${chunk}.readers`)} and ${chunk}.restrictions <@ ${listed}
    and (${chunk}.context_item_id is null or (${granted(sql`${chunk}.context_readers`)}
      and ${chunk}.context_restrictions <@ ${listed})))`;
}

export function liveAccessCondition(viewer: SearchViewer, chunk: SQL, item: SQL, space: SQL): SQL {
  const { accountId } = viewer;
  const account = sql`${accountId}::uuid`;
  const readable = (target: SQL, targetSpace: SQL) => {
    if (accountId === null) return audienceFloor(viewer, target, targetSpace);
    const granted = (minimum: ReadLevel) => {
      const sources = [spaceRoleConditionFor(account, targetSpace, minimum)];
      if (!viewer.portal) sources.push(shareCondition(account, target, targetSpace, minimum));
      return sql`((${sql.join(sources, sql` or `)}) and ${viewRestrictionCondition(account, target, targetSpace)})`;
    };
    return sql`((${target}.reader_visible and ${granted("reader")}) or ${granted("editor")}
      or ${audienceFloor(viewer, target, targetSpace)})`;
  };
  const commentVisible = sql`(${chunk}.source <> 'comment' or exists (select 1 from comments cm
    join comments cr on cr.id = coalesce(cm.parent_id, cm.id)
    where cm.id = ${chunk}.source_id and cm.item_id = ${item}.id and cm.deleted_at is null
      and (cr.quote is null or cr.quote_public)))`;
  const contextVisible = sql`(${chunk}.context_item_id is null or exists (select 1 from tree_items ct
    join spaces cs on cs.id = ct.space_id
    where ct.id = ${chunk}.context_item_id and ct.trash_entry_id is null and cs.deleted_at is null
      and (ct.mode = 'live' or ct.published_version_id is not null)
      and not exists (select 1 from meetings cm where cm.item_id = ct.id and cm.state = 'skipped')
      and ${readable(sql`ct`, sql`cs`)}))`;
  return sql`(${commentVisible} and ${contextVisible} and ${readable(item, space)})`;
}
