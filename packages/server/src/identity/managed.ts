import { eq, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { Executor, Transaction } from "../database/database.js";
import { identityProviders, type ManagedSource, managedAccounts } from "./schema.js";

export type ManagingProviderType = "oidc" | "saml" | "ldap";

export interface ManagedState {
  providerId: string;
  providerName: string;
  providerType: ManagingProviderType;
  source: ManagedSource;
  since: Date;
}

export interface ManagedChange {
  accountId: string;
  before: { providerId: string; source: ManagedSource } | null;
  after: { providerId: string; source: ManagedSource } | null;
}

export type ManagedTarget = { accountIds: readonly string[] } | { providerId: string };

export function signsInOnlyThroughProvider(state: Pick<ManagedState, "providerType"> | null): boolean {
  return state !== null && state.providerType !== "ldap";
}

export async function managedStateOf(executor: Executor, accountId: string): Promise<ManagedState | null> {
  const [row] = await executor
    .select({
      providerId: managedAccounts.providerId,
      providerName: identityProviders.name,
      providerType: identityProviders.type,
      source: managedAccounts.source,
      since: managedAccounts.since,
    })
    .from(managedAccounts)
    .innerJoin(identityProviders, eq(identityProviders.id, managedAccounts.providerId))
    .where(eq(managedAccounts.accountId, accountId));
  return row ?? null;
}

const setUpProvider = sql`p.setup_completed_at is not null`;

function candidates(target: ManagedTarget) {
  if ("providerId" in target) {
    return sql`
      select account_id as id from managed_accounts where provider_id = ${target.providerId}::uuid
      union select account_id from identities where provider_id = ${target.providerId}::uuid
      union select a.id from accounts a join identity_provider_domains d
        on d.domain = lower(substring(a.email from '@([^@]+)$'))
        where d.provider_id = ${target.providerId}::uuid`;
  }
  const ids = sql.join(
    [...new Set(target.accountIds)].map((id) => sql`(${id}::uuid)`),
    sql`, `,
  );
  return sql`select id from (values ${ids}) as given(id)`;
}

export async function refreshManagedAccounts(
  tx: Transaction,
  audit: AuditLog,
  target: ManagedTarget,
  actor: Principal,
): Promise<ManagedChange[]> {
  if ("accountIds" in target && target.accountIds.length === 0) return [];
  const locked = await tx.execute<{ id: string }>(sql`
    select a.id from accounts a where a.id in (${candidates(target)}) order by a.id for update of a`);
  if (locked.rows.length === 0) return [];
  const lockedIds = sql.join(
    locked.rows.map((row) => sql`${row.id}::uuid`),
    sql`, `,
  );
  const result = await tx.execute<{
    id: string;
    home: string | null;
    current_provider: string | null;
    current_source: ManagedSource | null;
    provider: string | null;
    source: ManagedSource | null;
  }>(sql`
    with locked as (
      select a.id, a.type, a.email, a.home_organization_id from accounts a where a.id in (${lockedIds}))
    select l.id, l.home_organization_id as home,
      m.provider_id as current_provider, m.source as current_source,
      coalesce(own.provider_id, dom.provider_id) as provider,
      case when own.provider_id is not null then 'identity'
        when dom.provider_id is not null then 'domain' end as source
    from locked l
    left join managed_accounts m on m.account_id = l.id
    left join lateral (
      select i.provider_id from identities i join identity_providers p on p.id = i.provider_id
      where i.account_id = l.id and ${setUpProvider}
      order by i.created_at desc, i.id desc limit 1) own
      on l.type in ('standard', 'guest')
        and l.id is distinct from (select owner_account_id from instance)
    left join lateral (
      select d.provider_id from identity_provider_domains d join identity_providers p on p.id = d.provider_id
      where d.domain = lower(substring(l.email from '@([^@]+)$')) and ${setUpProvider}) dom
      on l.type in ('standard', 'guest')
        and l.id is distinct from (select owner_account_id from instance)`);

  const changes: ManagedChange[] = [];
  for (const row of result.rows) {
    const before =
      row.current_provider && row.current_source
        ? { providerId: row.current_provider, source: row.current_source }
        : null;
    const after = row.provider && row.source ? { providerId: row.provider, source: row.source } : null;
    if (before?.providerId === after?.providerId && before?.source === after?.source) continue;
    const scope = row.home ? { scope: { type: "organization" as const, id: row.home } } : {};
    if (after) {
      await tx
        .insert(managedAccounts)
        .values({ accountId: row.id, providerId: after.providerId, source: after.source })
        .onConflictDoUpdate({
          target: managedAccounts.accountId,
          set: { providerId: after.providerId, source: after.source, since: sql`now()` },
        });
      await audit.record(tx, {
        name: "account.managed",
        actor,
        targetId: row.id,
        fields: { providerId: after.providerId, source: after.source },
        ...scope,
      });
    } else if (before) {
      await tx.delete(managedAccounts).where(eq(managedAccounts.accountId, row.id));
      await audit.record(tx, {
        name: "account.unmanaged",
        actor,
        targetId: row.id,
        fields: { providerId: before.providerId },
        ...scope,
      });
    }
    changes.push({ accountId: row.id, before, after });
  }
  return changes;
}

export async function managedAccountCounts(executor: Executor): Promise<Map<string, number>> {
  const rows = await executor
    .select({ providerId: managedAccounts.providerId, count: sql<number>`count(*)::int` })
    .from(managedAccounts)
    .groupBy(managedAccounts.providerId);
  return new Map(rows.map((row) => [row.providerId, row.count]));
}
