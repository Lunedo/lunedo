import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Logger } from "../logging/logger.js";
import type { DatabasePool } from "./pool.js";

export const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";
const LOCK_NAME = "pagehall.migrations";

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

function readJournal(folder: string): JournalEntry[] {
  const journal = JSON.parse(readFileSync(`${folder}/meta/_journal.json`, "utf8")) as {
    entries: JournalEntry[];
  };
  return journal.entries;
}

/** All migrations this version ships, oldest first. */
export function knownSchemaVersions(folder = migrationsFolder): string[] {
  return readJournal(folder).map((entry) => entry.tag);
}

export function schemaVersionTimes(folder = migrationsFolder): Map<string, number> {
  return new Map(readJournal(folder).map((entry) => [entry.tag, entry.when]));
}

/** The newest migration this version ships, e.g. `0003_settings`. */
export function currentSchemaVersion(folder = migrationsFolder): string {
  const entries = readJournal(folder);
  return entries.at(-1)?.tag ?? "none";
}

/**
 * Applies pending migrations. Migrations are forward-only. A session-level advisory lock
 * serializes nodes that start at the same time: the first one migrates, the others wait
 * and then find nothing left to do.
 */
export async function runMigrations(
  pool: DatabasePool,
  options: {
    logger: Logger;
    folder?: string;
    beforeMigrate?: (pending: { applied: number; expected: number }) => Promise<void>;
  },
): Promise<void> {
  const folder = options.folder ?? migrationsFolder;
  const client = await pool.connect();
  const notice = (message: { message?: string }) =>
    options.logger.warn({ notice: message.message ?? "" }, "A migration changed existing data");
  client.on("notice", notice);
  try {
    await client.query("select pg_advisory_lock(hashtext($1))", [LOCK_NAME]);
    try {
      const before = await appliedMigrationCount(client);
      const expected = readJournal(folder).length;
      if (options.beforeMigrate && before < expected)
        await options.beforeMigrate({ applied: before, expected });
      await migrate(drizzle({ client }), {
        migrationsFolder: folder,
        migrationsSchema: MIGRATIONS_SCHEMA,
        migrationsTable: MIGRATIONS_TABLE,
      });
      const applied = (await appliedMigrationCount(client)) - before;
      if (applied > 0)
        options.logger.info({ applied, version: currentSchemaVersion(folder) }, "Migrations applied");
    } finally {
      await client.query("select pg_advisory_unlock(hashtext($1))", [LOCK_NAME]);
    }
  } finally {
    client.off("notice", notice);
    client.release();
  }
}

async function appliedMigrationCount(client: { query: DatabasePool["query"] }): Promise<number> {
  const exists = await client.query<{ exists: boolean }>("select to_regclass($1) is not null as exists", [
    `${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`,
  ]);
  if (!exists.rows[0]?.exists) return 0;
  const result = await client.query<{ count: string }>(
    `select count(*) as count from "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

export interface MigrationStatus {
  applied: number;
  expected: number;
  upToDate: boolean;
}

/** Compares the applied migrations with the ones this version ships; used by readiness checks. */
export async function migrationStatus(
  pool: DatabasePool,
  folder = migrationsFolder,
): Promise<MigrationStatus> {
  const entries = readJournal(folder);
  const latest = entries.at(-1)?.when ?? 0;
  const exists = await pool.query<{ exists: boolean }>("select to_regclass($1) is not null as exists", [
    `${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`,
  ]);
  if (!exists.rows[0]?.exists)
    return { applied: 0, expected: entries.length, upToDate: entries.length === 0 };
  const result = await pool.query<{ count: string; newest: string | null }>(
    `select count(*) as count, max(created_at) as newest from "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`,
  );
  const applied = Number(result.rows[0]?.count ?? 0);
  const newest = Number(result.rows[0]?.newest ?? 0);
  return { applied, expected: entries.length, upToDate: newest >= latest };
}
