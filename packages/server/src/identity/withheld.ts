import { type SQL, sql } from "drizzle-orm";
import type { Executor } from "../database/database.js";

const STALE_IDENTITY = sql`
  select 1 from identities i join identity_providers p on p.id = i.provider_id
  where i.account_id = pg.account_id and i.groups_read_failed_at is not null
    and coalesce(i.groups_read_at, i.created_at)
      < now() - make_interval(mins => 2 * coalesce((p.config->'sync'->>'intervalMinutes')::int, 60))`;

export function withheldAssignmentIds(accountId: string): SQL {
  return sql`
    select pg.role_assignment_id from provider_grants pg
    join role_assignments r on r.id = pg.role_assignment_id
    where pg.account_id = ${accountId} and pg.kind = 'role'
      and (r.scope = 'instance' or r.built_in_role in ('owner', 'administrator'))
      and exists (${STALE_IDENTITY})`;
}

export interface WithheldRole {
  assignmentId: string;
  scope: "instance" | "organization";
  organizationId: string | null;
  organizationName: string | null;
  builtInRole: string | null;
  roleName: string | null;
  providerName: string;
  groupsReadAt: Date | null;
}

export async function withheldRoles(executor: Executor, accountId: string): Promise<WithheldRole[]> {
  const result = await executor.execute<{
    assignment_id: string;
    scope: "instance" | "organization";
    organization_id: string | null;
    organization_name: string | null;
    built_in_role: string | null;
    role_name: string | null;
    provider_name: string;
    groups_read_at: Date | string | null;
  }>(sql`
    select r.id as assignment_id, r.scope, r.organization_id, o.name as organization_name,
      r.built_in_role, cr.name as role_name, stale.provider_name, stale.groups_read_at
    from role_assignments r
    left join organizations o on o.id = r.organization_id
    left join custom_roles cr on cr.id = r.custom_role_id
    cross join lateral (
      select p.name as provider_name, i.groups_read_at from identities i
      join identity_providers p on p.id = i.provider_id
      where i.account_id = ${accountId} and i.groups_read_failed_at is not null
        and coalesce(i.groups_read_at, i.created_at)
          < now() - make_interval(mins => 2 * coalesce((p.config->'sync'->>'intervalMinutes')::int, 60))
      order by i.groups_read_at nulls first limit 1
    ) stale
    where r.id in (${withheldAssignmentIds(accountId)})
    order by r.scope, o.name`);
  return result.rows.map((row) => ({
    assignmentId: row.assignment_id,
    scope: row.scope,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    builtInRole: row.built_in_role,
    roleName: row.role_name,
    providerName: row.provider_name,
    groupsReadAt: row.groups_read_at === null ? null : new Date(row.groups_read_at),
  }));
}
