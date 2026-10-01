import { sql } from "drizzle-orm";
import type { Executor } from "../database/database.js";
import { currentRequestContext } from "../observability/request-context.js";
import type { ScopeChain } from "../settings/service.js";

export async function accountScopeChain(executor: Executor, accountId: string): Promise<ScopeChain> {
  const cache = currentRequestContext()?.cache;
  const key = `settings:account:${accountId}`;
  const cached = cache?.get(key) as ScopeChain | undefined;
  if (cached) return cached;
  const result = await executor.execute<{ home_organization_id: string | null }>(
    sql`select home_organization_id from accounts where id = ${accountId}`,
  );
  const home = result.rows[0]?.home_organization_id;
  const chain: ScopeChain = home ? { organization: home } : {};
  cache?.set(key, chain);
  return chain;
}
