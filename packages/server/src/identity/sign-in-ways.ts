import { sql } from "drizzle-orm";
import type { Executor } from "../database/database.js";

export interface IgnoredSignInWay {
  identityId?: string;
  providerId?: string;
}

export async function accountsWithoutOtherSignIn(
  executor: Executor,
  accountIds: readonly string[],
  ignored: IgnoredSignInWay,
): Promise<string[]> {
  if (accountIds.length === 0) return [];
  const ids = sql.join(
    [...new Set(accountIds)].map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const result = await executor.execute<{ id: string }>(sql`
    select a.id from accounts a
    where a.id in (${ids})
      and not exists (
        select 1 from identities i join identity_providers p on p.id = i.provider_id
        where i.account_id = a.id and p.deactivated_at is null
          and i.id is distinct from ${ignored.identityId ?? null}::uuid
          and i.provider_id is distinct from ${ignored.providerId ?? null}::uuid)
      and not exists (select 1 from webauthn_credentials w where w.account_id = a.id)
      and a.password_hash is null`);
  return result.rows.map((row) => row.id);
}
