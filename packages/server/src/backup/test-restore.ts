import { randomBytes } from "node:crypto";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import type { KeyRing } from "../crypto/key-ring.js";
import type { DatabasePool } from "../database/pool.js";
import { ATTACHMENTS_DIRECTORY, assertObjectKey } from "../files/store.js";
import type { Logger } from "../logging/logger.js";
import { restoreBackup, verifyBackup } from "./archive.js";
import { describeFailure } from "./errors.js";
import { type DatabaseArchiver, PostgresArchiver } from "./postgres.js";
import type { TestRestoreCheck } from "./schema.js";
import type { BackupTarget } from "./targets.js";

export const MAIN_TABLES = [
  "instance",
  "accounts",
  "organizations",
  "spaces",
  "tree_items",
  "page_versions",
  "stored_files",
  "audit_events",
] as const;

export type TestRestoreStage = "verify" | "restore" | "checks" | "done";

export interface TestRestoreOutcome {
  state: "passed" | "verified" | "failed";
  stage: TestRestoreStage;
  checks: TestRestoreCheck[];
  error: string | null;
}

export interface TestRestoreSources {
  pool: DatabasePool;
  databaseUrl: string;
  backupKeys: KeyRing;
  masterKeys: () => Promise<KeyRing | null>;
  knownSchemaVersions: readonly string[];
  migrationTimes: ReadonlyMap<string, number>;
  workDir: string;
  logger: Logger;
  archiver?: (databaseUrl: string) => DatabaseArchiver;
}

async function createDatabasePrivilege(pool: DatabasePool): Promise<{ allowed: boolean; user: string }> {
  const result = await pool.query<{ allowed: boolean; user: string }>(
    "select (rolcreatedb or rolsuper) as allowed, current_user as user from pg_roles where rolname = current_user",
  );
  return { allowed: result.rows[0]?.allowed === true, user: result.rows[0]?.user ?? "pagehall" };
}

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function databaseUrlFor(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function inspect(
  databaseUrl: string,
  filesDir: string,
  expected: { schemaVersion: string; withFiles: boolean },
  sources: TestRestoreSources,
): Promise<TestRestoreCheck[]> {
  const client = new pg.Client({ connectionString: databaseUrl, application_name: "pagehall-test-restore" });
  await client.connect();
  try {
    const checks: TestRestoreCheck[] = [];
    const migrations = await client.query<{ count: string; newest: string | null }>(
      'select count(*) as count, max(created_at) as newest from "drizzle"."__drizzle_migrations"',
    );
    const applied = Number(migrations.rows[0]?.count ?? 0);
    const position = sources.knownSchemaVersions.indexOf(expected.schemaVersion) + 1;
    const newest = Number(migrations.rows[0]?.newest ?? 0);
    checks.push({
      check: "schemaVersion",
      passed:
        position > 0 && applied === position && newest === sources.migrationTimes.get(expected.schemaVersion),
      detail: { expected: expected.schemaVersion, appliedMigrations: applied },
    });

    const counts: Record<string, number> = {};
    for (const table of MAIN_TABLES) {
      const exists = await client.query<{ present: boolean }>(
        "select to_regclass($1) is not null as present",
        [`public.${table}`],
      );
      if (!exists.rows[0]?.present) continue;
      const result = await client.query<{ count: string }>(
        `select count(*) as count from ${quoteIdentifier(table)}`,
      );
      counts[table] = Number(result.rows[0]?.count ?? 0);
    }
    checks.push({
      check: "rows",
      passed: counts.instance === 1 && (counts.accounts ?? 0) > 0,
      detail: counts,
    });

    if (!expected.withFiles) {
      checks.push({ check: "files", passed: true, detail: { included: false } });
      return checks;
    }
    const files = await client.query<{ storage_key: string }>(
      "select storage_key from stored_files where state in ('stored', 'ready') order by storage_key",
    );
    let missing = 0;
    let firstMissing: string | null = null;
    for (const row of files.rows) {
      let present = false;
      try {
        assertObjectKey(row.storage_key);
        present = (
          await stat(path.join(filesDir, ATTACHMENTS_DIRECTORY, ...row.storage_key.split("/")))
        ).isFile();
      } catch {
        present = false;
      }
      if (!present) {
        missing += 1;
        firstMissing ??= row.storage_key;
      }
    }
    checks.push({
      check: "files",
      passed: missing === 0,
      detail: { included: true, referenced: files.rows.length, missing, firstMissing },
    });
    return checks;
  } finally {
    await client.end();
  }
}

export async function runTestRestore(
  target: BackupTarget,
  name: string,
  sources: TestRestoreSources,
  onStage: (stage: TestRestoreStage, checks: TestRestoreCheck[]) => Promise<void>,
): Promise<TestRestoreOutcome> {
  const checks: TestRestoreCheck[] = [];
  let stage: TestRestoreStage = "verify";
  const fail = (error: unknown): TestRestoreOutcome => ({
    state: "failed",
    stage,
    checks,
    error: message(error),
  });

  try {
    const source = await target.source(name);
    try {
      const manifest = await verifyBackup({
        input: source,
        backupKeys: sources.backupKeys,
        knownSchemaVersions: sources.knownSchemaVersions,
      });
      checks.push({
        check: "verify",
        passed: true,
        detail: { entries: manifest.entries.length, schemaVersion: manifest.schemaVersion },
      });
    } finally {
      await source.close();
    }
  } catch (error) {
    checks.push({ check: "verify", passed: false, detail: {} });
    return fail(error);
  }

  const privilege = await createDatabasePrivilege(sources.pool);
  if (!privilege.allowed) {
    checks.push({
      check: "privilege",
      passed: false,
      detail: { grant: `ALTER ROLE ${quoteIdentifier(privilege.user)} CREATEDB;` },
    });
    return { state: "verified", stage: "done", checks, error: null };
  }

  stage = "restore";
  await onStage(stage, checks);
  const suffix = randomBytes(6).toString("hex");
  const databaseName = `pagehall_test_restore_${suffix}`;
  const filesDir = path.join(sources.workDir, `.pagehall-test-restore-${suffix}`);
  const databaseUrl = databaseUrlFor(sources.databaseUrl, databaseName);
  let created = false;
  try {
    await sources.pool.query(`create database ${quoteIdentifier(databaseName)}`);
    created = true;
    await mkdir(filesDir, { recursive: true, mode: 0o700 });
    const source = await target.source(name);
    let header: Awaited<ReturnType<typeof source.readHeader>>["header"];
    try {
      header = (await source.readHeader()).header;
      await restoreBackup({
        input: source,
        backupKeys: sources.backupKeys,
        knownSchemaVersions: sources.knownSchemaVersions,
        masterKeys: await sources.masterKeys(),
        database: (sources.archiver ?? ((url) => new PostgresArchiver({ databaseUrl: url })))(databaseUrl),
        filesDir,
        force: false,
        logger: sources.logger,
      });
    } finally {
      await source.close();
    }
    checks.push({ check: "restore", passed: true, detail: { database: databaseName } });

    stage = "checks";
    await onStage(stage, checks);
    checks.push(
      ...(await inspect(
        databaseUrl,
        filesDir,
        { schemaVersion: header.schemaVersion, withFiles: header.scope !== "database" },
        sources,
      )),
    );
    const passed = checks.every((check) => check.passed);
    return passed
      ? { state: "passed", stage: "done", checks, error: null }
      : { state: "failed", stage, checks, error: "A plausibility check of the restored backup failed" };
  } catch (error) {
    if (stage === "restore") checks.push({ check: "restore", passed: false, detail: {} });
    return fail(error);
  } finally {
    if (created) {
      await sources.pool
        .query(`drop database if exists ${quoteIdentifier(databaseName)} with (force)`)
        .catch((error: unknown) =>
          sources.logger.warn(
            { reason: describeFailure(error), database: databaseName },
            "Removing the test restore database failed",
          ),
        );
    }
    await rm(filesDir, { recursive: true, force: true });
  }
}
