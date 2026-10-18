import { uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import { type Principal, SYSTEM } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { Database, Transaction } from "../database/database.js";
import { holdsAccessElsewhere, mapPlaceholder, memberByEmail } from "./mapping.js";
import type { SourcePerson } from "./source.js";

export const ATLASSIAN_ACCOUNT = "atlassian";
export const CONFLUENCE_USER_KEY = "confluenceUserKey";
const NAME_MAX_LENGTH = 200;

export interface DirectoryEntry {
  readonly name: string | null;
  readonly email: string | null;
  readonly app?: boolean;
}

export type Directory = (
  people: readonly Pick<SourcePerson, "sourceId" | "accountId" | "userKey">[],
) => Promise<ReadonlyMap<string, DirectoryEntry>>;

export const NO_DIRECTORY: Directory = async () => new Map();

export function personOf(sourceId: string): Pick<SourcePerson, "sourceId" | "accountId" | "userKey"> {
  return sourceId.startsWith("key:")
    ? { sourceId, accountId: null, userKey: sourceId.slice(4) }
    : { sourceId, accountId: sourceId, userKey: null };
}

export function externalIdOf(person: Pick<SourcePerson, "accountId" | "userKey">): {
  source: string;
  id: string;
} | null {
  if (person.accountId) return { source: ATLASSIAN_ACCOUNT, id: person.accountId.slice(0, 255) };
  if (person.userKey) return { source: CONFLUENCE_USER_KEY, id: person.userKey.slice(0, 255) };
  return null;
}

async function emailIsFree(tx: Transaction, email: string): Promise<boolean> {
  const result = await tx.execute<{ taken: boolean }>(
    sql`select exists (select 1 from accounts where lower(email) = lower(${email})) as taken`,
  );
  return result.rows[0]?.taken !== true;
}

async function placeholderByEmail(
  tx: Transaction,
  organizationId: string,
  email: string,
): Promise<string | null> {
  const result = await tx.execute<{ id: string }>(sql`
    select id from accounts where lower(email) = lower(${email}) and state = 'placeholder'
      and merged_into_id is null and home_organization_id = ${organizationId}`);
  return result.rows[0]?.id ?? null;
}

function cleanName(name: string | null | undefined): string | null {
  const value = (name ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX_LENGTH);
  return value.length > 0 ? value : null;
}

async function improvePlaceholder(
  tx: Transaction,
  placeholderId: string,
  externalId: string,
  entry: DirectoryEntry,
  guarded: boolean,
): Promise<void> {
  const name = cleanName(entry.name);
  if (name) {
    await tx.execute(sql`
      update accounts set name = ${name}, updated_at = now()
      where id = ${placeholderId} and state = 'placeholder' and name = ${externalId}`);
  }
  if (!guarded && entry.email && (await emailIsFree(tx, entry.email))) {
    await tx.execute(sql`
      update accounts set email = ${entry.email}, updated_at = now()
      where id = ${placeholderId} and state = 'placeholder' and email is null`);
  }
}

export interface ResolveInput {
  readonly organizationId: string;
  readonly importId: string;
  readonly via?: "email" | "userList";
  readonly actor?: Principal;
}

export async function resolvePerson(
  tx: Transaction,
  audit: AuditLog,
  input: ResolveInput,
  person: Pick<SourcePerson, "accountId" | "userKey">,
  entry: DirectoryEntry | undefined,
): Promise<string | null> {
  const external = externalIdOf(person);
  if (!external) return null;
  await tx.execute(sql`
    select pg_advisory_xact_lock(hashtextextended(${`placeholder:${input.organizationId}:${external.source}:${external.id}`}, 0))`);
  const existing = await tx.execute<{ account_id: string; state: string; merged_into_id: string | null }>(sql`
    select x.account_id, a.state::text as state, a.merged_into_id from account_external_ids x
    join accounts a on a.id = x.account_id
    where x.organization_id = ${input.organizationId} and x.source = ${external.source}
      and x.external_id = ${external.id}`);
  const known = existing.rows[0];
  if (known) {
    const current = known.merged_into_id ?? known.account_id;
    if (known.state !== "placeholder" || known.merged_into_id !== null || !entry) return current;
    const guarded = await holdsAccessElsewhere(tx, known.account_id, input.importId);
    const member = entry.email ? await memberByEmail(tx, input.organizationId, entry.email) : null;
    if (member && !guarded) {
      await mapPlaceholder(tx, audit, input.actor ?? SYSTEM, {
        organizationId: input.organizationId,
        importId: input.importId,
        placeholderId: known.account_id,
        accountId: member,
        via: input.via ?? "email",
        bulk: true,
      });
      return member;
    }
    await improvePlaceholder(tx, known.account_id, external.id, entry, guarded);
    return known.account_id;
  }
  let accountId = entry?.email ? await memberByEmail(tx, input.organizationId, entry.email) : null;
  if (!accountId && entry?.email) accountId = await placeholderByEmail(tx, input.organizationId, entry.email);
  if (!accountId) {
    accountId = uuidv7();
    const email = entry?.email && (await emailIsFree(tx, entry.email)) ? entry.email : null;
    await tx.execute(sql`
      insert into accounts (id, type, state, name, email, home_organization_id)
      values (${accountId}, 'standard', 'placeholder', ${cleanName(entry?.name) ?? external.id}, ${email},
        ${input.organizationId})`);
    await audit.record(tx, {
      name: "import.placeholderCreated",
      actor: SYSTEM,
      targetId: accountId,
      fields: { importId: input.importId },
      scope: { type: "organization", id: input.organizationId },
    });
  }
  await tx.execute(sql`
    insert into account_external_ids (organization_id, source, external_id, account_id)
    values (${input.organizationId}, ${external.source}, ${external.id}, ${accountId})`);
  return accountId;
}

export async function ensurePeople(
  database: Database,
  audit: AuditLog,
  input: { organizationId: string; importId: string },
  people: readonly Pick<SourcePerson, "sourceId" | "accountId" | "userKey">[],
  directory: Directory = NO_DIRECTORY,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const unique = [...new Map(people.map((person) => [person.sourceId, person])).values()];
  if (unique.length === 0) return result;
  const mapped = await database.execute<{ source_id: string; target_id: string }>(sql`
    select source_id, target_id from import_items
    where import_id = ${input.importId} and kind = 'person'
      and source_id = any(${sql.param(unique.map((person) => person.sourceId))}::text[])`);
  for (const row of mapped.rows) result.set(row.source_id, row.target_id);
  const open = unique
    .filter((person) => !result.has(person.sourceId) && externalIdOf(person) !== null)
    .sort((a, b) => {
      const left = externalIdOf(a);
      const right = externalIdOf(b);
      return `${left?.source}:${left?.id}`.localeCompare(`${right?.source}:${right?.id}`);
    });
  if (open.length === 0) return result;
  const entries = await directory(open);
  await database.transaction(async (tx) => {
    for (const person of open) {
      const accountId = await resolvePerson(tx, audit, input, person, entries.get(person.sourceId));
      if (!accountId) continue;
      await tx.execute(sql`
        insert into import_items (import_id, kind, source_id, target_id)
        values (${input.importId}, 'person', ${person.sourceId}, ${accountId})
        on conflict do nothing`);
      result.set(person.sourceId, accountId);
    }
  });
  return result;
}
