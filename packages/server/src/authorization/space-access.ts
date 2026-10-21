import { type SQL, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { Executor } from "../database/database.js";
import type { PrincipalKind } from "../organizations/access-schema.js";
import { spaceRoleRank } from "../spaces/roles.js";
import { type SpaceRole, type SpaceVisibility, spaceRoles } from "../spaces/schema.js";
import { grantsLevel } from "./areas.js";

export interface SpaceGrantRow {
  principalKind: PrincipalKind;
  principalId: string | null;
  role: SpaceRole;
}

export interface SpaceAccessState {
  organizationId: string | null;
  visibility: SpaceVisibility;
  grants: SpaceGrantRow[];
}

export interface RoleChange {
  accountId: string;
  name: string;
  before: SpaceRole | null;
  after: SpaceRole | null;
}

export interface AccessImpact {
  gaining: number;
  losing: number;
  raised: number;
  lowered: number;
  changes: RoleChange[];
  unlisted: number;
  truncated: boolean;
}

const IMPACT_LIST_LIMIT = 100;

function activeMembership(organization: SQL, account: SQL): SQL {
  return sql`exists (select 1 from memberships m
    where m.organization_id = ${organization} and m.account_id = ${account} and m.kind = 'member'
      and (m.expires_at is null or m.expires_at > now()))`;
}

export function organizationMembership(organization: SQL, account: SQL): SQL {
  return sql`(${organization} is null or exists (select 1 from memberships om
    where om.organization_id = ${organization} and om.account_id = ${account}
      and (om.expires_at is null or om.expires_at > now())))`;
}

function groupMembership(group: SQL, account: SQL): SQL {
  return sql`exists (select 1 from group_members gm
    where gm.group_id = ${group} and gm.account_id = ${account}
      and (gm.expires_at is null or gm.expires_at > now()))`;
}

export function spaceRoleCondition(accountId: string, space: SQL, minimum: SpaceRole): SQL {
  return spaceRoleConditionFor(sql`${accountId}::uuid`, space, minimum);
}

export function spaceRoleConditionFor(account: SQL, space: SQL, minimum: SpaceRole): SQL {
  const roles = spaceRoles.filter((role) => spaceRoleRank(role) >= spaceRoleRank(minimum));
  const internal = sql`exists (select 1 from accounts ia where ia.id = ${account} and ia.type = 'standard')`;
  const member = activeMembership(sql`${space}.organization_id`, account);
  const floors =
    minimum === "reader"
      ? sql` or (${space}.visibility = 'organization' and ${member})
          or (${space}.visibility = 'instance' and ${internal})`
      : sql``;
  const portal = minimum === "reader" ? sql`${space}.type = 'knowledgeBase'` : sql`false`;
  return sql`(exists (select 1 from accounts aa where aa.id = ${account} and aa.state = 'active'
    and (aa.type <> 'portal' or ${portal})) and (
    exists (select 1 from space_permissions sp
      where sp.space_id = ${space}.id and sp.role = any(${sql.param(roles)}::space_role[]) and (
        (sp.principal_kind = 'account' and sp.principal_id = ${account}
          and ${organizationMembership(sql`${space}.organization_id`, account)})
        or (sp.principal_kind = 'group' and ${groupMembership(sql`sp.principal_id`, account)})
        or (sp.principal_kind = 'organizationMembers' and ${member})
        or (sp.principal_kind = 'instanceUsers' and ${internal})))
    ${floors}))`;
}

export function tokenSpaceCondition(principal: Principal, space: SQL, minimum: SpaceRole): SQL {
  if (principal.type !== "account" || !principal.token) return sql`true`;
  const { token } = principal;
  const writing = spaceRoleRank(minimum) >= spaceRoleRank("editor");
  if (!grantsLevel(token.scopes.organization?.spaces, writing ? "manage" : "view")) return sql`false`;
  if (writing && token.contentLevel === "read") return sql`false`;
  const conditions = [
    token.organizationId ? sql`${space}.organization_id = ${token.organizationId}::uuid` : sql`true`,
    token.knowledgeBaseIds
      ? sql`${space}.id = any(${sql.param([...token.knowledgeBaseIds])}::uuid[])`
      : sql`true`,
  ];
  return sql`(${sql.join(conditions, sql` and `)})`;
}

function grantsTable(grants: SpaceGrantRow[]): SQL {
  const rows = grants.map((grant) => ({
    principal_kind: grant.principalKind,
    principal_id: grant.principalId,
    role: grant.role,
  }));
  return sql`(select * from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
    as g(principal_kind text, principal_id uuid, role text))`;
}

function rankOf(state: SpaceAccessState, member: SQL, inOrganization: SQL): SQL {
  const { grants, visibility } = state;
  const visibilityRank =
    visibility === "organization"
      ? sql`case when ${member} then 1 else 0 end`
      : visibility === "instance"
        ? sql`case when c.type = 'standard' then 1 else 0 end`
        : sql`0`;
  return sql`greatest(coalesce((select max(array_position(${sql.param([...spaceRoles])}::text[], g.role))
    from ${grantsTable(grants)} g
    where (g.principal_kind = 'account' and g.principal_id = c.id and ${inOrganization})
      or (g.principal_kind = 'group' and ${groupMembership(sql`g.principal_id`, sql`c.id`)})
      or (g.principal_kind = 'organizationMembers' and ${member})
      or (g.principal_kind = 'instanceUsers' and c.type = 'standard')), 0), ${visibilityRank})`;
}

function holderKey(grant: Pick<SpaceGrantRow, "principalKind" | "principalId">): string {
  return `${grant.principalKind}:${grant.principalId ?? ""}`;
}

function candidates(before: SpaceAccessState, after: SpaceAccessState): SQL {
  const sameOrganization = before.organizationId === after.organizationId;
  const beforeRoles = new Map(before.grants.map((grant) => [holderKey(grant), grant.role]));
  const afterRoles = new Map(after.grants.map((grant) => [holderKey(grant), grant.role]));
  const changed = [...before.grants, ...after.grants].filter(
    (grant) => !sameOrganization || beforeRoles.get(holderKey(grant)) !== afterRoles.get(holderKey(grant)),
  );
  const accounts = changed
    .filter((grant) => grant.principalKind === "account")
    .map((grant) => grant.principalId);
  const groups = changed.filter((grant) => grant.principalKind === "group").map((grant) => grant.principalId);
  const visibilities =
    sameOrganization && before.visibility === after.visibility ? [] : [before.visibility, after.visibility];
  const organizations = [before.organizationId, after.organizationId].filter(
    (organizationId): organizationId is string =>
      organizationId !== null &&
      (changed.some((grant) => grant.principalKind === "organizationMembers") ||
        visibilities.includes("organization")),
  );
  const instance =
    changed.some((grant) => grant.principalKind === "instanceUsers") || visibilities.includes("instance");
  const parts: SQL[] = [sql`select id from accounts where id = any(${sql.param(accounts)}::uuid[])`];
  parts.push(sql`select account_id from group_members where group_id = any(${sql.param(groups)}::uuid[])`);
  if (organizations.length > 0) {
    parts.push(
      sql`select account_id from memberships where organization_id = any(${sql.param(organizations)}::uuid[])`,
    );
  }
  if (instance) parts.push(sql`select id from accounts where type = 'standard'`);
  return sql.join(parts, sql` union `);
}

export async function accessImpact(
  executor: Executor,
  before: SpaceAccessState,
  after: SpaceAccessState,
  listable: (account: SQL) => SQL = () => sql`true`,
): Promise<AccessImpact> {
  const memberOf = (organizationId: string | null) =>
    organizationId === null ? sql`false` : activeMembership(sql`${organizationId}::uuid`, sql`a.id`);
  const inOrganization = (organizationId: string | null) =>
    organizationMembership(sql`${organizationId}::uuid`, sql`a.id`);
  const result = await executor.execute<{
    id: string;
    name: string;
    before_rank: number;
    after_rank: number;
    gaining: string;
    losing: string;
    raised: string;
    lowered: string;
    unlisted: string;
    listable: boolean;
  }>(sql`
    with cand as (
      select a.id, a.name, a.type, ${memberOf(before.organizationId)} as member_before,
        ${memberOf(after.organizationId)} as member_after, ${inOrganization(before.organizationId)} as in_before,
        ${inOrganization(after.organizationId)} as in_after, ${listable(sql`a.id`)} as listable
      from accounts a
      where a.state = 'active' and a.id in (${candidates(before, after)})
    ), ranks as (
      select c.id, c.name, c.listable, ${rankOf(before, sql`c.member_before`, sql`c.in_before`)} as before_rank,
        ${rankOf(after, sql`c.member_after`, sql`c.in_after`)} as after_rank
      from cand c
    ), changed as (select * from ranks where before_rank <> after_rank),
    counted as (
      select id, name, listable, before_rank, after_rank,
        count(*) filter (where before_rank = 0) over () as gaining,
        count(*) filter (where after_rank = 0) over () as losing,
        count(*) filter (where before_rank > 0 and after_rank > before_rank) over () as raised,
        count(*) filter (where after_rank > 0 and after_rank < before_rank) over () as lowered,
        count(*) filter (where not listable) over () as unlisted
      from changed
    )
    select * from counted order by listable desc, lower(name), id limit ${IMPACT_LIST_LIMIT + 1}`);
  const first = result.rows[0];
  const rows = result.rows.filter((row) => row.listable);
  const role = (rank: number): SpaceRole | null => (rank > 0 ? (spaceRoles[rank - 1] ?? null) : null);
  return {
    gaining: Number(first?.gaining ?? 0),
    losing: Number(first?.losing ?? 0),
    raised: Number(first?.raised ?? 0),
    lowered: Number(first?.lowered ?? 0),
    unlisted: Number(first?.unlisted ?? 0),
    truncated: rows.length > IMPACT_LIST_LIMIT,
    changes: rows.slice(0, IMPACT_LIST_LIMIT).map((row) => ({
      accountId: row.id,
      name: row.name,
      before: role(Number(row.before_rank)),
      after: role(Number(row.after_rank)),
    })),
  };
}

export function activeAdministratorCondition(grants: SQL, organization: SQL): SQL {
  return sql`exists (select 1 from ${grants} g where g.role = 'admin' and (
    (g.principal_kind = 'account' and exists (
      select 1 from accounts a where a.id = g.principal_id and a.state = 'active'
        and ${organizationMembership(organization, sql`a.id`)}))
    or (g.principal_kind = 'group' and exists (
      select 1 from group_members gm join accounts a on a.id = gm.account_id
      where gm.group_id = g.principal_id and a.state = 'active'
        and (gm.expires_at is null or gm.expires_at > now())))
    or (g.principal_kind = 'organizationMembers' and exists (
      select 1 from memberships m join accounts a on a.id = m.account_id
      where m.organization_id = ${organization} and m.kind = 'member' and a.state = 'active'
        and (m.expires_at is null or m.expires_at > now())))
    or (g.principal_kind = 'instanceUsers' and exists (
      select 1 from accounts a where a.type = 'standard' and a.state = 'active'))))`;
}

export function storedGrants(space: SQL): SQL {
  return sql`(select principal_kind::text, principal_id, role::text from space_permissions
    where space_id = ${space})`;
}

export function proposedGrants(grants: SpaceGrantRow[]): SQL {
  return grantsTable(grants);
}

export async function accountRoleUnder(
  executor: Executor,
  accountId: string,
  state: SpaceAccessState,
): Promise<SpaceRole | null> {
  const member =
    state.organizationId === null
      ? sql`false`
      : activeMembership(sql`${state.organizationId}::uuid`, sql`a.id`);
  const result = await executor.execute<{ rank: number }>(sql`
    select ${rankOf(state, sql`c.is_member`, sql`c.in_organization`)} as rank
    from (select a.id, a.type, ${member} as is_member,
      ${organizationMembership(sql`${state.organizationId}::uuid`, sql`a.id`)} as in_organization from accounts a
      where a.id = ${accountId} and a.state = 'active') c`);
  const rank = Number(result.rows[0]?.rank ?? 0);
  return rank > 0 ? (spaceRoles[rank - 1] ?? null) : null;
}
