import { type SQL, sql } from "drizzle-orm";
import type { Executor } from "../database/database.js";

export function formerAdministratorCondition(entry: SQL, account: SQL): SQL {
  return sql`exists (select 1 from deleted_space_administrators d
    join trash_entries fe on fe.id = d.trash_entry_id join spaces fs on fs.id = fe.space_id
    join accounts fa on fa.id = d.account_id
    where d.trash_entry_id = ${entry} and d.account_id = ${account} and fe.kind = 'space' and not fe.purging
      and fa.state = 'active'
      and (fs.organization_id is null or exists (select 1 from memberships m
        where m.organization_id = fs.organization_id and m.account_id = fa.id and m.kind = 'member'
          and (m.expires_at is null or m.expires_at > now()))))`;
}

export async function isFormerSpaceAdministrator(
  executor: Executor,
  entryId: string,
  accountId: string,
): Promise<boolean> {
  const result = await executor.execute<{ former: boolean }>(
    sql`select ${formerAdministratorCondition(sql`${entryId}::uuid`, sql`${accountId}::uuid`)} as former`,
  );
  return result.rows[0]?.former === true;
}
