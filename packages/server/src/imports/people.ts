import { uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import { SYSTEM } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { Database } from "../database/database.js";
import type { SourcePerson } from "./source.js";

export const ATLASSIAN_ACCOUNT = "atlassian";
export const CONFLUENCE_USER_KEY = "confluenceUserKey";

export function externalIdOf(person: Pick<SourcePerson, "accountId" | "userKey">): {
  source: string;
  id: string;
} | null {
  if (person.accountId) return { source: ATLASSIAN_ACCOUNT, id: person.accountId.slice(0, 255) };
  if (person.userKey) return { source: CONFLUENCE_USER_KEY, id: person.userKey.slice(0, 255) };
  return null;
}

export async function ensurePlaceholders(
  database: Database,
  audit: AuditLog,
  input: { organizationId: string; importId: string },
  people: readonly Pick<SourcePerson, "sourceId" | "accountId" | "userKey">[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (people.length === 0) return result;
  const ordered = [...people].sort((a, b) => {
    const left = externalIdOf(a);
    const right = externalIdOf(b);
    return `${left?.source}:${left?.id}`.localeCompare(`${right?.source}:${right?.id}`);
  });
  await database.transaction(async (tx) => {
    for (const person of ordered) {
      const external = externalIdOf(person);
      if (!external || result.has(person.sourceId)) continue;
      await tx.execute(sql`
        select pg_advisory_xact_lock(hashtextextended(${`placeholder:${input.organizationId}:${external.source}:${external.id}`}, 0))`);
      const existing = await tx.execute<{ account_id: string }>(sql`
        select account_id from account_external_ids
        where organization_id = ${input.organizationId} and source = ${external.source} and external_id = ${external.id}`);
      let accountId = existing.rows[0]?.account_id;
      if (!accountId) {
        accountId = uuidv7();
        await tx.execute(sql`
          insert into accounts (id, type, state, name, home_organization_id)
          values (${accountId}, 'standard', 'placeholder', ${external.id}, ${input.organizationId})`);
        await tx.execute(sql`
          insert into account_external_ids (organization_id, source, external_id, account_id)
          values (${input.organizationId}, ${external.source}, ${external.id}, ${accountId})`);
        await audit.record(tx, {
          name: "import.placeholderCreated",
          actor: SYSTEM,
          targetId: accountId,
          fields: { importId: input.importId },
          scope: { type: "organization", id: input.organizationId },
        });
      }
      await tx.execute(sql`
        insert into import_items (import_id, kind, source_id, target_id)
        values (${input.importId}, 'person', ${person.sourceId}, ${accountId})
        on conflict do nothing`);
      result.set(person.sourceId, accountId);
    }
  });
  return result;
}
