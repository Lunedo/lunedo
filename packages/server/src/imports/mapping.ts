import { sql } from "drizzle-orm";
import { type MovedContent, movePlaceholderContent } from "../accounts/placeholder-content.js";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { Transaction } from "../database/database.js";
import { ImportError } from "./errors.js";

export type MappingVia = "manual" | "email" | "userList";

export async function memberByEmail(
  tx: Transaction,
  organizationId: string,
  email: string,
): Promise<string | null> {
  const result = await tx.execute<{ id: string }>(sql`
    select a.id from accounts a join memberships m on m.account_id = a.id
    where lower(a.email) = lower(${email.trim()}) and a.state = 'active' and a.type in ('standard', 'guest')
      and m.organization_id = ${organizationId} and (m.expires_at is null or m.expires_at > now())
    limit 1`);
  return result.rows[0]?.id ?? null;
}

export async function isMappableAccount(
  tx: Transaction,
  organizationId: string,
  accountId: string,
): Promise<boolean> {
  const result = await tx.execute<{ ok: boolean }>(sql`
    select exists (select 1 from accounts a join memberships m on m.account_id = a.id
      where a.id = ${accountId} and a.state = 'active' and a.type in ('standard', 'guest')
        and m.organization_id = ${organizationId} and (m.expires_at is null or m.expires_at > now())) as ok`);
  return result.rows[0]?.ok === true;
}

export async function holdsAccess(tx: Transaction, placeholderId: string): Promise<boolean> {
  const result = await tx.execute<{ held: boolean }>(sql`
    select exists (select 1 from page_shares where principal_kind = 'account' and principal_id = ${placeholderId})
      or exists (select 1 from space_permissions where principal_kind = 'account' and principal_id = ${placeholderId})
      or exists (select 1 from import_grants where account_id = ${placeholderId} and item_id is null
        and applied_at is null and role is not null and status <> 'notTaken') as held`);
  return result.rows[0]?.held === true;
}

export interface PlaceholderMapping {
  readonly organizationId: string;
  readonly importId: string;
  readonly placeholderId: string;
  readonly accountId: string;
  readonly via: MappingVia;
  readonly bulk: boolean;
}

export async function mapPlaceholder(
  tx: Transaction,
  audit: AuditLog,
  actor: Principal,
  input: PlaceholderMapping,
): Promise<MovedContent> {
  if (input.placeholderId === input.accountId) {
    throw new ImportError("invalidMapping", "A placeholder cannot be mapped to itself.");
  }
  const locked = await tx.execute<{ id: string; state: string; merged_into_id: string | null }>(sql`
    select id, state::text as state, merged_into_id from accounts
    where id = any(${sql.param([input.placeholderId, input.accountId].sort())}::uuid[])
    order by id for update`);
  const placeholder = locked.rows.find((row) => row.id === input.placeholderId);
  if (placeholder?.state !== "placeholder" || placeholder.merged_into_id !== null) {
    throw new ImportError("notPlaceholder", "The person is no placeholder anymore. Reload the list.");
  }
  const owned = await tx.execute<{ owned: boolean }>(sql`
    select exists (select 1 from import_items i join imports m on m.id = i.import_id
      where i.import_id = ${input.importId} and i.kind = 'person' and i.target_id = ${input.placeholderId}
        and m.organization_id = ${input.organizationId}) as owned`);
  if (input.via !== "email" && !owned.rows[0]?.owned) {
    throw new ImportError("notPlaceholder", "The person is no placeholder of this import.");
  }
  if (!(await isMappableAccount(tx, input.organizationId, input.accountId))) {
    throw new ImportError(
      "invalidMappingTarget",
      "Choose an active member of the organization. Invite the person first if they have no account yet.",
    );
  }
  if (
    actor.type === "account" &&
    actor.id === input.accountId &&
    (await holdsAccess(tx, input.placeholderId))
  ) {
    throw new ImportError(
      "selfExtension",
      "This placeholder holds access to pages or the space. Ask another administrator to map it to you.",
    );
  }
  const moved = await movePlaceholderContent(tx, input.placeholderId, input.accountId);
  await tx.execute(sql`
    update accounts set merged_into_id = ${input.accountId}, email = null, updated_at = now()
    where id = ${input.placeholderId}`);
  await audit.sealer?.linkSubject(tx, input.placeholderId, input.accountId);
  await audit.record(tx, {
    name: "import.placeholderMapped",
    actor,
    targetId: input.accountId,
    fields: {
      importId: input.importId,
      placeholderId: input.placeholderId,
      via: input.via,
      bulk: input.bulk,
      ...moved,
    },
    scope: { type: "organization", id: input.organizationId },
  });
  return moved;
}
