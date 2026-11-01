import { sql } from "drizzle-orm";
import type { Executor } from "../database/database.js";
import { currentRequestContext } from "../observability/request-context.js";
import type { ScopeChain } from "../settings/service.js";
import type { AccountState, AccountType } from "./schema.js";

export interface RequestAccount {
  id: string;
  type: AccountType;
  state: AccountState;
  homeOrganizationId: string | null;
  name: string;
  email: string | null;
}

function accountKey(accountId: string): string {
  return `account:${accountId}`;
}

export function primeRequestAccount(account: RequestAccount): void {
  currentRequestContext()?.cache?.set(accountKey(account.id), Promise.resolve(account));
}

async function loadAccount(executor: Executor, accountId: string): Promise<RequestAccount | null> {
  const result = await executor.execute<{
    id: string;
    type: AccountType;
    state: AccountState;
    home_organization_id: string | null;
    name: string;
    email: string | null;
  }>(sql`select id, type, state, home_organization_id, name, email from accounts where id = ${accountId}`);
  const row = result.rows[0];
  return row
    ? {
        id: row.id,
        type: row.type,
        state: row.state,
        homeOrganizationId: row.home_organization_id,
        name: row.name,
        email: row.email,
      }
    : null;
}

export function requestAccount(
  executor: Executor,
  accountId: string,
  options: { fresh?: boolean } = {},
): Promise<RequestAccount | null> {
  const cache = options.fresh ? undefined : currentRequestContext()?.cache;
  if (!cache) return loadAccount(executor, accountId);
  const key = accountKey(accountId);
  const existing = cache.get(key) as Promise<RequestAccount | null> | undefined;
  if (existing) return existing;
  const loading = loadAccount(executor, accountId);
  cache.set(key, loading);
  loading.catch(() => cache.delete(key));
  return loading;
}

export function scopeChainOf(account: Pick<RequestAccount, "homeOrganizationId"> | null): ScopeChain {
  const home = account?.homeOrganizationId;
  return home ? { organization: home } : {};
}

export async function accountScopeChain(executor: Executor, accountId: string): Promise<ScopeChain> {
  return scopeChainOf(await requestAccount(executor, accountId));
}
