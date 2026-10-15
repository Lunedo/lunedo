import { sql } from "drizzle-orm";
import type { Executor } from "../database/database.js";

export async function organizationAdministrators(
  executor: Executor,
  organizationId: string,
): Promise<string[]> {
  const result = await executor.execute<{ id: string }>(sql`
    select distinct a.id from role_assignments ra
    join accounts a on a.id = ra.principal_id
    join memberships m on m.account_id = a.id and m.organization_id = ra.organization_id
    where ra.organization_id = ${organizationId} and ra.principal_kind = 'account'
      and ra.built_in_role in ('owner', 'administrator') and a.state = 'active' and m.kind = 'member'
    limit 200`);
  return result.rows.map((row) => row.id);
}
