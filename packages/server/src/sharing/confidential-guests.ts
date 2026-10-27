import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Executor } from "../database/database.js";
import { SpaceError } from "../spaces/common.js";

export async function guestAccounts(
  executor: Executor,
  accountIds: readonly string[],
  organizationId: string | null,
): Promise<Set<string>> {
  if (accountIds.length === 0) return new Set();
  const result = await executor.execute<{ id: string }>(sql`
    select a.id from accounts a
    where a.id = any(${sql.param([...accountIds])}::uuid[]) and (
      a.type = 'guest' or exists (
        select 1 from memberships m
        where m.account_id = a.id and m.organization_id = ${organizationId} and m.kind = 'guest'
          and (m.expires_at is null or m.expires_at > now())))`);
  return new Set(result.rows.map((row) => row.id));
}

export async function requireConfidentialGuestInviter(
  authorization: AuthorizationService,
  executor: Executor,
  actor: Principal,
  spaceId: string,
): Promise<void> {
  const space = await executor.execute<{ confidential: boolean }>(
    sql`select confidential from spaces where id = ${spaceId}`,
  );
  if (!space.rows[0]?.confidential || actor.type === "system") return;
  const role =
    actor.type === "account"
      ? (await authorization.spaceRole(actor.id, spaceId, { executor, fresh: true })).role
      : null;
  if (role !== "admin") {
    throw new SpaceError(
      "confidentialGuestsBySpaceAdmins",
      "Only space administrators give guests access to a confidential space",
    );
  }
}
