import { eq, inArray, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import { accounts } from "../accounts/schema.js";
import type { AuditEvents, AuditLog } from "../audit/audit-log.js";
import { ManagedAccountError } from "../auth/errors.js";
import {
  accountTokens,
  authChallenges,
  recoveryCodes,
  sessions,
  totpCredentials,
  webauthnCredentials,
} from "../auth/schema.js";
import { hasSecondFactor, secondFactorsOf } from "../auth/two-factor.js";
import type { Executor, Transaction } from "../database/database.js";
import type { MailService } from "../mail/mail-service.js";
import { identityProviderDomains, identityProviders, type ManagedSource, managedAccounts } from "./schema.js";

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

function selectManagedStates(executor: Executor) {
  return executor
    .select({
      accountId: managedAccounts.accountId,
      providerId: managedAccounts.providerId,
      providerName: identityProviders.name,
      providerType: identityProviders.type,
      source: managedAccounts.source,
      since: managedAccounts.since,
    })
    .from(managedAccounts)
    .innerJoin(identityProviders, eq(identityProviders.id, managedAccounts.providerId));
}

export async function managedStateOf(executor: Executor, accountId: string): Promise<ManagedState | null> {
  const [row] = await selectManagedStates(executor).where(eq(managedAccounts.accountId, accountId));
  if (!row) return null;
  const { accountId: _accountId, ...state } = row;
  return state;
}

export async function managedStatesOf(
  executor: Executor,
  accountIds: readonly string[],
): Promise<Map<string, ManagedState>> {
  if (accountIds.length === 0) return new Map();
  const rows = await selectManagedStates(executor).where(
    inArray(managedAccounts.accountId, [...new Set(accountIds)]),
  );
  return new Map(rows.map(({ accountId, ...state }) => [accountId, state]));
}

export type DomainProvider = {
  id: string;
  name: string;
  type: ManagingProviderType;
};

export async function providerOfEmailDomain(
  executor: Executor,
  email: string,
): Promise<DomainProvider | null> {
  const result = await executor.execute<DomainProvider>(sql`
    select p.id, p.name, p.type from identity_provider_domains d
    join identity_providers p on p.id = d.provider_id
    where d.domain = lower(substring(${email} from '@([^@]+)$')) and p.setup_completed_at is not null`);
  return result.rows[0] ?? null;
}

export async function confirmsLinks(executor: Executor, accountId: string): Promise<boolean> {
  const result = await executor.execute<{ confirms: boolean }>(sql`
    select exists (select 1 from instance where owner_account_id = ${accountId}::uuid)
      or exists (
        select 1 from role_assignments ra
        where (ra.expires_at is null or ra.expires_at > now())
          and (ra.built_in_role is null or ra.built_in_role <> 'member')
          and ((ra.principal_kind = 'account' and ra.principal_id = ${accountId}::uuid)
            or (ra.principal_kind = 'group' and ra.principal_id in (
              select group_id from group_members where account_id = ${accountId}::uuid))
            or (ra.principal_kind = 'organizationMembers' and ra.organization_id in (
              select organization_id from memberships where account_id = ${accountId}::uuid and kind = 'member'))
            or ra.principal_kind = 'instanceUsers')) as confirms`);
  return result.rows[0]?.confirms === true;
}

export async function refuseManaged(
  executor: Executor,
  accountId: string,
  which: "any" | "providerOnly",
): Promise<void> {
  const state = await managedStateOf(executor, accountId);
  if (!state || (which === "providerOnly" && !signsInOnlyThroughProvider(state))) return;
  throw new ManagedAccountError(state.providerId, state.providerName);
}

export async function takeOverLocalCredentials(
  tx: Transaction,
  services: { audit: AuditLog; mail: MailService | undefined },
  accountId: string,
  actor: Principal,
  linkedBy: "signIn" | "administrator",
): Promise<string | null> {
  const state = await managedStateOf(tx, accountId);
  if (state?.source !== "identity") return null;
  const [account] = await tx
    .select({
      id: accounts.id,
      email: accounts.email,
      home: accounts.homeOrganizationId,
      passwordHash: accounts.passwordHash,
    })
    .from(accounts)
    .where(eq(accounts.id, accountId));
  if (!account) return null;
  const directory = state.providerType === "ldap";
  const factors = directory ? null : await secondFactorsOf(tx, account.id);
  if (account.passwordHash === null && (factors === null || !hasSecondFactor(factors))) return null;
  await tx
    .update(accounts)
    .set({ passwordHash: null, passwordChangedAt: null, updatedAt: new Date() })
    .where(eq(accounts.id, account.id));
  if (!directory) {
    await tx.delete(totpCredentials).where(eq(totpCredentials.accountId, account.id));
    await tx.delete(webauthnCredentials).where(eq(webauthnCredentials.accountId, account.id));
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.accountId, account.id));
  }
  const ended = await tx
    .delete(sessions)
    .where(eq(sessions.accountId, account.id))
    .returning({ id: sessions.id });
  await tx.delete(authChallenges).where(eq(authChallenges.accountId, account.id));
  await tx.delete(accountTokens).where(eq(accountTokens.accountId, account.id));
  await services.audit.record(tx, {
    name: "account.localCredentialsRemoved",
    actor,
    targetId: account.id,
    fields: {
      providerId: state.providerId,
      localSignIn: account.passwordHash !== null,
      authenticatorApp: factors?.totp ?? false,
      passkeys: factors?.passkeys ?? 0,
      recoveryLeft: factors?.recoveryCodes ?? 0,
      endedSessions: ended.length,
    },
    ...(account.home ? { scope: { type: "organization" as const, id: account.home } } : {}),
  });
  if (!services.mail || !account.email) return null;
  return services.mail.queue(tx, {
    to: account.email,
    template: "accountManaged",
    security: true,
    language: await services.mail.languageOf(account.id),
    params: { providerName: state.providerName, directory, linkedBy },
    organizationId: account.home,
  });
}

const setUpProvider = sql`p.setup_completed_at is not null`;
const WRITE_BATCH = 5000;

function domainLock(domain: string) {
  return sql`hashtextextended(${`managed-domain:${domain.toLowerCase()}`}, 0)`;
}

export async function holdEmailDomain(tx: Transaction, email: string | null): Promise<void> {
  const domain = email?.split("@")[1];
  if (!domain) return;
  await tx.execute(sql`select pg_advisory_xact_lock_shared(${domainLock(domain)})`);
}

export async function lockProviderDomains(
  tx: Transaction,
  providerId: string,
  extra: readonly string[] = [],
): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('managed-providers', 0))`);
  const current = await tx
    .select({ domain: identityProviderDomains.domain })
    .from(identityProviderDomains)
    .where(eq(identityProviderDomains.providerId, providerId));
  const domains = [
    ...new Set([...current.map((row) => row.domain), ...extra].map((d) => d.toLowerCase())),
  ].sort();
  for (const domain of domains) {
    await tx.execute(sql`select pg_advisory_xact_lock(${domainLock(domain)})`);
  }
}

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
  const byProvider = "providerId" in target;
  if (byProvider) await lockProviderDomains(tx, target.providerId);
  const lock = byProvider ? sql`for key share of a` : sql`for update of a`;
  const locked = await tx.execute<{ id: string }>(
    sql`select a.id from accounts a where a.id in (${candidates(target)}) order by a.id ${lock}`,
  );
  if (locked.rows.length === 0) return [];
  const lockedIds = locked.rows.map((row) => row.id);
  const result = await tx.execute<{
    id: string;
    home: string | null;
    current_provider: string | null;
    current_source: ManagedSource | null;
    provider: string | null;
    source: ManagedSource | null;
  }>(sql`
    with locked as (
      select a.id, a.type, a.email, a.home_organization_id from accounts a
      where a.id = any(${sql.param(lockedIds)}::uuid[]))
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
        and l.id is distinct from (select owner_account_id from instance)
    order by l.id`);

  const changes: ManagedChange[] = [];
  const managed: { accountId: string; providerId: string; source: ManagedSource }[] = [];
  const released: string[] = [];
  const events: AuditEvents = [];
  for (const row of result.rows) {
    const before =
      row.current_provider && row.current_source
        ? { providerId: row.current_provider, source: row.current_source }
        : null;
    const after = row.provider && row.source ? { providerId: row.provider, source: row.source } : null;
    if (before?.providerId === after?.providerId && before?.source === after?.source) continue;
    const scope = row.home ? { scope: { type: "organization" as const, id: row.home } } : {};
    if (after) {
      managed.push({ accountId: row.id, providerId: after.providerId, source: after.source });
      events.push({
        name: "account.managed",
        actor,
        targetId: row.id,
        fields: { providerId: after.providerId, source: after.source },
        ...scope,
      });
    } else if (before) {
      released.push(row.id);
      events.push({
        name: "account.unmanaged",
        actor,
        targetId: row.id,
        fields: { providerId: before.providerId },
        ...scope,
      });
    }
    changes.push({ accountId: row.id, before, after });
  }
  for (let start = 0; start < managed.length; start += WRITE_BATCH) {
    await tx
      .insert(managedAccounts)
      .values(managed.slice(start, start + WRITE_BATCH))
      .onConflictDoUpdate({
        target: managedAccounts.accountId,
        set: { providerId: sql`excluded.provider_id`, source: sql`excluded.source`, since: sql`now()` },
      });
  }
  for (let start = 0; start < released.length; start += WRITE_BATCH) {
    await tx
      .delete(managedAccounts)
      .where(inArray(managedAccounts.accountId, released.slice(start, start + WRITE_BATCH)));
  }
  await audit.recordMany(tx, events);
  return changes;
}

export async function managedAccountCounts(
  executor: Executor,
  providerIds?: readonly string[],
): Promise<Map<string, number>> {
  const rows = await executor
    .select({ providerId: managedAccounts.providerId, count: sql<number>`count(*)::int` })
    .from(managedAccounts)
    .where(providerIds ? inArray(managedAccounts.providerId, [...providerIds]) : undefined)
    .groupBy(managedAccounts.providerId);
  return new Map(rows.map((row) => [row.providerId, row.count]));
}
