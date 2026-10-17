import { sql } from "drizzle-orm";
import { type Principal, SYSTEM } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { Encryption } from "../crypto/envelope.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import type { AtlassianCredentials, AtlassianDirectory } from "./atlassian.js";
import type { ConfluenceConnection, ConfluenceKind } from "./confluence/api-client.js";
import { ImportError, ImportFormatError } from "./errors.js";
import { type Directory, type DirectoryEntry, NO_DIRECTORY } from "./people.js";

export type TokenDeletion =
  | "accepted"
  | "discarded"
  | "stopped"
  | "failed"
  | "replaced"
  | "removed"
  | "permissionLost"
  | "abandoned";

export function tokenContext(importId: string): string {
  return `import_credentials.token:${importId}`;
}

export async function deleteCredentials(
  tx: Transaction,
  audit: AuditLog,
  input: { importId: string; organizationId: string; reason: TokenDeletion; actor?: Principal },
): Promise<void> {
  await tx.execute(sql`delete from import_directory where import_id = ${input.importId}`);
  const deleted = await tx.execute(sql`delete from import_credentials where import_id = ${input.importId}`);
  if ((deleted.rowCount ?? 0) === 0) return;
  await tx.execute(sql`update imports set token_deleted_at = now() where id = ${input.importId}`);
  await audit.record(tx, {
    name: "import.tokenDeleted",
    actor: input.actor ?? SYSTEM,
    targetId: input.importId,
    fields: { reason: input.reason },
    scope: { type: "organization", id: input.organizationId },
  });
}

export async function readCredentials(
  executor: Executor,
  encryption: Encryption,
  importId: string,
): Promise<AtlassianCredentials | null> {
  const connection = await readConnection(executor, encryption, importId);
  if (connection?.kind !== "cloud" || !connection.email) return null;
  return { site: connection.site, email: connection.email, token: connection.token };
}

export async function readConnection(
  executor: Executor,
  encryption: Encryption,
  importId: string,
): Promise<ConfluenceConnection | null> {
  const result = await executor.execute<{
    kind: ConfluenceKind;
    site: string;
    base_path: string;
    email: string | null;
    token: Buffer;
    ca_certificates: string | null;
  }>(sql`
    select kind, site, base_path, email, token, ca_certificates from import_credentials
    where import_id = ${importId}`);
  const row = result.rows[0];
  if (!row) return null;
  return {
    kind: row.kind,
    site: row.site,
    basePath: row.base_path,
    email: row.email,
    token: encryption.decryptString(row.token, tokenContext(importId)),
    caCertificates: row.ca_certificates,
  };
}

export function directoryFor(options: {
  database: Database;
  encryption: Encryption;
  atlassian: AtlassianDirectory;
  audit: AuditLog;
  importId: string;
  organizationId: string;
  peopleSource: string | null;
}): Directory {
  if (options.peopleSource === "list") {
    return async (people) => {
      const ids = people.flatMap((person) => (person.accountId ? [person.accountId] : []));
      const result = new Map<string, DirectoryEntry>();
      if (ids.length === 0) return result;
      const rows = await options.database.execute<{
        external_id: string;
        name: string | null;
        email: string | null;
      }>(
        sql`select external_id, name, email from import_directory
          where import_id = ${options.importId} and external_id = any(${sql.param(ids)}::text[])`,
      );
      const byId = new Map(rows.rows.map((row) => [row.external_id, row]));
      for (const person of people) {
        const row = person.accountId ? byId.get(person.accountId) : undefined;
        if (row) result.set(person.sourceId, { name: row.name, email: row.email });
      }
      return result;
    };
  }
  if (options.peopleSource === "source") {
    return async (people) => {
      const keys = people.flatMap((person) => (person.userKey ? [person.userKey] : []));
      const result = new Map<string, DirectoryEntry>();
      if (keys.length === 0) return result;
      const rows = await options.database.execute<{
        source_id: string;
        name: string | null;
        email: string | null;
      }>(
        sql`select source_id, data ->> 'name' as name, data ->> 'email' as email from import_records
          where import_id = ${options.importId} and kind = 'user' and source_id = any(${sql.param(keys)}::text[])`,
      );
      const byKey = new Map(rows.rows.map((row) => [row.source_id, row]));
      for (const person of people) {
        const row = person.userKey ? byKey.get(person.userKey) : undefined;
        if (row && (row.name || row.email)) {
          result.set(person.sourceId, {
            name: row.name?.trim().slice(0, 200) || null,
            email: row.email?.includes("@") ? row.email.trim() : null,
          });
        }
      }
      return result;
    };
  }
  if (options.peopleSource !== "token") return NO_DIRECTORY;
  return async (people) => {
    const result = new Map<string, DirectoryEntry>();
    const ids = people.flatMap((person) => (person.accountId ? [person.accountId] : []));
    if (ids.length === 0) return result;
    const credentials = await readCredentials(options.database, options.encryption, options.importId);
    if (!credentials) return result;
    await options.database.transaction(async (tx) => {
      const used = await tx.execute(sql`
        insert into import_items (import_id, kind, source_id, target_id)
        values (${options.importId}, 'tokenUsed', 'token', ${options.importId})
        on conflict do nothing`);
      if ((used.rowCount ?? 0) === 0) return;
      await options.audit.record(tx, {
        name: "import.tokenUsed",
        actor: SYSTEM,
        targetId: options.importId,
        fields: { site: credentials.site, purpose: "import" },
        scope: { type: "organization", id: options.organizationId },
      });
    });
    let found: Awaited<ReturnType<AtlassianDirectory["people"]>>;
    try {
      found = await options.atlassian.people(credentials, ids);
    } catch (error) {
      if (error instanceof ImportError && error.code === "atlassianUnauthorized") {
        throw new ImportFormatError(error.code, error.message);
      }
      throw error;
    }
    const byId = new Map(found.map((person) => [person.accountId, person]));
    for (const person of people) {
      const entry = person.accountId ? byId.get(person.accountId) : undefined;
      if (entry) result.set(person.sourceId, { name: entry.name, email: entry.email });
    }
    return result;
  };
}
