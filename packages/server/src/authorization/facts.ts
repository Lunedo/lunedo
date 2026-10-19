import { sql } from "drizzle-orm";
import type { AccountState, AccountType } from "../accounts/schema.js";
import type { Executor } from "../database/database.js";
import { withheldAssignmentIds } from "../identity/withheld.js";
import { currentRequestContext } from "../observability/request-context.js";
import type {
  BuiltInRoleKey,
  MembershipKind,
  PrincipalKind,
  RoleScope,
} from "../organizations/access-schema.js";
import { highestSpaceRole } from "../spaces/roles.js";
import type { SpaceRole, SpaceVisibility } from "../spaces/schema.js";
import { type Areas, builtInRoleAreas, grantsLevel } from "./areas.js";

export type RoleReference = { builtIn: BuiltInRoleKey } | { customRoleId: string; name: string };

export type Via =
  | { type: "account" }
  | { type: "group"; groupId: string; name: string }
  | { type: "organizationMembers" }
  | { type: "instanceUsers" }
  | { type: "membership" }
  | { type: "instanceOwner" }
  | { type: "breakGlass"; accessId: string };

export interface HeldRole {
  role: RoleReference;
  areas: Areas;
  via: Via;
  assignmentId: string | null;
  expiresAt: Date | null;
}

export interface AccountFacts {
  id: string;
  type: AccountType;
  state: AccountState;
  homeOrganizationId: string | null;
}

export interface InstanceFacts {
  account: AccountFacts | null;
  owner: boolean;
  roles: HeldRole[];
}

export interface OrganizationFacts {
  account: AccountFacts | null;
  organizationId: string;
  membership: { kind: MembershipKind; expiresAt: Date | null } | null;
  groups: { id: string; name: string; manager: boolean }[];
  managedGroups: string[];
  roles: HeldRole[];
}

interface AssignmentRow {
  id: string;
  principal_kind: PrincipalKind;
  principal_id: string | null;
  built_in_role: BuiltInRoleKey | null;
  custom_role_id: string | null;
  custom_role_name: string | null;
  custom_role_areas: Areas | null;
  expires_at: Date | string | null;
  [key: string]: unknown;
}

function toDate(value: Date | string | null): Date | null {
  return value === null ? null : new Date(value);
}

function heldRole(scope: RoleScope, row: AssignmentRow, via: Via): HeldRole {
  return {
    role: row.built_in_role
      ? { builtIn: row.built_in_role }
      : { customRoleId: row.custom_role_id ?? "", name: row.custom_role_name ?? "" },
    areas: row.built_in_role ? builtInRoleAreas(scope, row.built_in_role) : (row.custom_role_areas ?? {}),
    via,
    assignmentId: row.id,
    expiresAt: toDate(row.expires_at),
  };
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

async function loadAccount(executor: Executor, accountId: string): Promise<AccountFacts | null> {
  const result = await executor.execute<{
    id: string;
    type: AccountType;
    state: AccountState;
    home_organization_id: string | null;
  }>(sql`select id, type, state, home_organization_id from accounts where id = ${accountId}`);
  const row = result.rows[0];
  return row
    ? { id: row.id, type: row.type, state: row.state, homeOrganizationId: row.home_organization_id }
    : null;
}

const assignmentColumns = sql`ra.id, ra.principal_kind, ra.principal_id, ra.built_in_role, ra.custom_role_id,
  cr.name as custom_role_name, cr.areas as custom_role_areas, ra.expires_at`;

export async function instanceFacts(
  executor: Executor,
  accountId: string,
  options: { fresh?: boolean } = {},
): Promise<InstanceFacts> {
  return cached(
    `authorization:instance:${accountId}`,
    async () => {
      const account = await loadAccount(executor, accountId);
      if (!account) return { account: null, owner: false, roles: [] };
      const owner = await executor.execute<{ owner: boolean }>(
        sql`select owner_account_id = ${accountId} as owner from instance`,
      );
      const internal = account.type === "standard";
      const assignments = await executor.execute<AssignmentRow>(sql`
        select ${assignmentColumns}
        from role_assignments ra left join custom_roles cr on cr.id = ra.custom_role_id
        where ra.scope = 'instance' and (ra.expires_at is null or ra.expires_at > now())
          and ra.id not in (${withheldAssignmentIds(accountId)})
          and ((ra.principal_kind = 'account' and ra.principal_id = ${accountId})
            or (ra.principal_kind = 'instanceUsers' and ${internal}))`);
      const roles: HeldRole[] = assignments.rows.map((row) =>
        heldRole(
          "instance",
          row,
          row.principal_kind === "account" ? { type: "account" } : { type: "instanceUsers" },
        ),
      );
      const isOwner = owner.rows[0]?.owner === true;
      if (isOwner) {
        roles.unshift({
          role: { builtIn: "owner" },
          areas: builtInRoleAreas("instance", "owner"),
          via: { type: "instanceOwner" },
          assignmentId: null,
          expiresAt: null,
        });
      }
      return { account, owner: isOwner, roles };
    },
    options.fresh ?? false,
  );
}

export async function organizationFacts(
  executor: Executor,
  accountId: string,
  organizationId: string,
  options: { fresh?: boolean } = {},
): Promise<OrganizationFacts> {
  return cached(
    `authorization:organization:${accountId}:${organizationId}`,
    async () => {
      const account = await loadAccount(executor, accountId);
      const empty: OrganizationFacts = {
        account,
        organizationId,
        membership: null,
        groups: [],
        managedGroups: [],
        roles: [],
      };
      if (!account) return empty;

      const membershipRows = await executor.execute<{
        kind: MembershipKind;
        expires_at: Date | string | null;
      }>(sql`
        select kind, expires_at from memberships
        where organization_id = ${organizationId} and account_id = ${accountId}
          and (expires_at is null or expires_at > now())`);
      const membershipRow = membershipRows.rows[0];
      const membership = membershipRow
        ? { kind: membershipRow.kind, expiresAt: toDate(membershipRow.expires_at) }
        : null;

      const groupRows = await executor.execute<{ id: string; name: string; manager: boolean }>(sql`
        select g.id, g.name, exists (
          select 1 from group_managers m where m.group_id = g.id and m.account_id = ${accountId}
        ) as manager
        from groups g join group_members gm on gm.group_id = g.id
        where g.organization_id = ${organizationId} and gm.account_id = ${accountId}
          and (gm.expires_at is null or gm.expires_at > now())`);
      const managed = await executor.execute<{ group_id: string }>(sql`
        select m.group_id from group_managers m join groups g on g.id = m.group_id
        where g.organization_id = ${organizationId} and m.account_id = ${accountId}`);
      const groups = groupRows.rows;
      const roles: HeldRole[] = [];

      if (membership?.kind === "member") {
        roles.push({
          role: { builtIn: "member" },
          areas: builtInRoleAreas("organization", "member"),
          via: { type: "membership" },
          assignmentId: null,
          expiresAt: membership.expiresAt,
        });
        const groupIds = groups.map((group) => group.id);
        const assignments = await executor.execute<AssignmentRow>(sql`
          select ${assignmentColumns}
          from role_assignments ra left join custom_roles cr on cr.id = ra.custom_role_id
          where ra.scope = 'organization' and ra.organization_id = ${organizationId}
            and (ra.expires_at is null or ra.expires_at > now())
            and ra.id not in (${withheldAssignmentIds(accountId)})
            and ((ra.principal_kind = 'account' and ra.principal_id = ${accountId})
              or (ra.principal_kind = 'group' and ra.principal_id = any(${sql.param(groupIds)}::uuid[]))
              or ra.principal_kind = 'organizationMembers'
              or (ra.principal_kind = 'instanceUsers' and ${account.type === "standard"}))`);
        for (const row of assignments.rows) {
          const group = groups.find((candidate) => candidate.id === row.principal_id);
          const via: Via =
            row.principal_kind === "group" && group
              ? { type: "group", groupId: group.id, name: group.name }
              : row.principal_kind === "account"
                ? { type: "account" }
                : row.principal_kind === "organizationMembers"
                  ? { type: "organizationMembers" }
                  : { type: "instanceUsers" };
          roles.push(heldRole("organization", row, via));
        }
      }

      const breakGlass = await executor.execute<{ id: string; expires_at: Date | string }>(sql`
        select id, expires_at from break_glass_accesses
        where account_id = ${accountId} and organization_id = ${organizationId}
          and ended_at is null and expires_at > now()`);
      const mayUseBreakGlass =
        breakGlass.rows.length > 0 &&
        (await instanceFacts(executor, accountId, options)).roles.some((role) =>
          grantsLevel(role.areas.organizations, "manage"),
        );
      for (const access of mayUseBreakGlass ? breakGlass.rows : []) {
        roles.push({
          role: { builtIn: "administrator" },
          areas: builtInRoleAreas("organization", "administrator"),
          via: { type: "breakGlass", accessId: access.id },
          assignmentId: null,
          expiresAt: toDate(access.expires_at),
        });
      }
      return { ...empty, membership, groups, managedGroups: managed.rows.map((row) => row.group_id), roles };
    },
    options.fresh ?? false,
  );
}

export type SpaceVia =
  | { type: "account" }
  | { type: "group"; groupId: string; name: string }
  | { type: "organizationMembers" }
  | { type: "instanceUsers" }
  | { type: "visibility"; visibility: Exclude<SpaceVisibility, "private"> };

export interface SpaceRoleSource {
  role: SpaceRole;
  via: SpaceVia;
  permissionId: string | null;
}

export interface SpaceFacts {
  account: AccountFacts | null;
  space: {
    id: string;
    organizationId: string | null;
    visibility: SpaceVisibility;
    personalOf: string | null;
  } | null;
  membership: MembershipKind | null;
  sources: SpaceRoleSource[];
  inactiveSources: SpaceRoleSource[];
  role: SpaceRole | null;
}

export async function spaceFacts(
  executor: Executor,
  accountId: string,
  spaceId: string,
  options: { fresh?: boolean } = {},
): Promise<SpaceFacts> {
  return cached(
    `authorization:space:${accountId}:${spaceId}`,
    async () => {
      const account = await loadAccount(executor, accountId);
      const spaceRows = await executor.execute<{
        id: string;
        organization_id: string | null;
        visibility: SpaceVisibility;
        personal_of: string | null;
        type: string;
      }>(sql`select id, organization_id, visibility, personal_of, type from spaces where id = ${spaceId}`);
      const row = spaceRows.rows[0];
      const space = row
        ? {
            id: row.id,
            organizationId: row.organization_id,
            visibility: row.visibility,
            personalOf: row.personal_of,
          }
        : null;
      const empty: SpaceFacts = {
        account,
        space,
        membership: null,
        sources: [],
        inactiveSources: [],
        role: null,
      };
      if (!account || !space || account.state !== "active") return empty;
      if (account.type === "portal" && row?.type !== "knowledgeBase") return empty;

      let membership: MembershipKind | null = null;
      if (space.organizationId) {
        const memberships = await executor.execute<{ kind: MembershipKind }>(sql`
          select kind from memberships
          where organization_id = ${space.organizationId} and account_id = ${accountId}
            and (expires_at is null or expires_at > now())`);
        membership = memberships.rows[0]?.kind ?? null;
      }
      const member = membership === "member";
      const inOrganization = space.organizationId === null || membership !== null;
      const internal = account.type === "standard";
      const permissions = await executor.execute<{
        id: string;
        role: SpaceRole;
        principal_kind: PrincipalKind;
        principal_id: string | null;
        group_name: string | null;
      }>(sql`
        select sp.id, sp.role, sp.principal_kind, sp.principal_id, g.name as group_name
        from space_permissions sp
        left join groups g on sp.principal_kind = 'group' and g.id = sp.principal_id
        where sp.space_id = ${spaceId} and (
          (sp.principal_kind = 'account' and sp.principal_id = ${accountId})
          or (sp.principal_kind = 'group' and exists (
            select 1 from group_members gm
            where gm.group_id = sp.principal_id and gm.account_id = ${accountId}
              and (gm.expires_at is null or gm.expires_at > now())))
          or (sp.principal_kind = 'organizationMembers' and ${member})
          or (sp.principal_kind = 'instanceUsers' and ${internal}))`);
      const all: SpaceRoleSource[] = permissions.rows.map((permission) => ({
        role: permission.role,
        permissionId: permission.id,
        via:
          permission.principal_kind === "group"
            ? { type: "group", groupId: permission.principal_id ?? "", name: permission.group_name ?? "" }
            : permission.principal_kind === "account"
              ? { type: "account" }
              : permission.principal_kind === "organizationMembers"
                ? { type: "organizationMembers" }
                : { type: "instanceUsers" },
      }));
      const inert = (source: SpaceRoleSource) => source.via.type === "account" && !inOrganization;
      const sources = all.filter((source) => !inert(source));
      const inactiveSources = all.filter(inert);
      if (space.visibility === "organization" && member) {
        sources.push({
          role: "reader",
          via: { type: "visibility", visibility: "organization" },
          permissionId: null,
        });
      }
      if (space.visibility === "instance" && internal) {
        sources.push({
          role: "reader",
          via: { type: "visibility", visibility: "instance" },
          permissionId: null,
        });
      }
      return {
        ...empty,
        membership,
        sources,
        inactiveSources,
        role: highestSpaceRole(sources.map((source) => source.role)),
      };
    },
    options.fresh ?? false,
  );
}
