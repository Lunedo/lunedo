import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import type { KeyRing } from "../crypto/key-ring.js";
import type { DatabasePool } from "../database/pool.js";
import { ATTACHMENTS_DIRECTORY, assertObjectKey } from "../files/store.js";
import type { Logger } from "../logging/logger.js";
import { type BackupManifest, restoreBackup, verifyBackup } from "./archive.js";
import { describeFailure } from "./errors.js";
import { type DatabaseArchiver, PostgresArchiver } from "./postgres.js";
import { checkSpace, criticalPercent, type DiskSpace, NotEnoughSpaceError } from "./runner.js";
import type { TestRestoreCheck } from "./schema.js";
import type { BackupTarget } from "./targets.js";

const DATABASE_PREFIX = "lunedo_test_restore_";
const DIRECTORY_PREFIX = "test-restore-";
const LEFTOVER_DATABASE = /^lunedo_test_restore_([0-9a-f]{32})$/;
const LEFTOVER_DIRECTORY = /^test-restore-([0-9a-f]{32})$/;
const SPACE_MARGIN = 1.2;

function runKey(runId: string): string {
  return runId.replace(/-/g, "").toLowerCase();
}

export function testRestoreNames(workDir: string, runId: string): { database: string; directory: string } {
  const key = runKey(runId);
  return { database: `${DATABASE_PREFIX}${key}`, directory: path.join(workDir, `${DIRECTORY_PREFIX}${key}`) };
}

export async function removeTestRestoreLeftovers(
  sources: Pick<TestRestoreSources, "pool" | "workDir" | "logger">,
  keepFrom: string | null,
): Promise<number> {
  const keep = keepFrom === null ? null : runKey(keepFrom);
  const stale = (key: string) => keep === null || key < keep;
  let removed = 0;
  const databases = await sources.pool.query<{ datname: string }>(
    "select datname from pg_database where datname like 'lunedo_test_restore_%' and datdba = (select oid from pg_roles where rolname = current_user)",
  );
  for (const { datname } of databases.rows) {
    const key = LEFTOVER_DATABASE.exec(datname)?.[1];
    if (!key || !stale(key)) continue;
    await sources.pool.query(`drop database if exists ${quoteIdentifier(datname)} with (force)`);
    removed += 1;
  }
  let entries: string[] = [];
  try {
    entries = await readdir(sources.workDir);
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    const key = LEFTOVER_DIRECTORY.exec(entry)?.[1];
    if (!key || !stale(key)) continue;
    await rm(path.join(sources.workDir, entry), { recursive: true, force: true });
    removed += 1;
  }
  if (removed > 0) sources.logger.info({ removed }, "Leftovers of interrupted test restores removed");
  return removed;
}

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
  diskSpace?: ((dir: string) => Promise<DiskSpace>) | undefined;
}

async function createDatabasePrivilege(pool: DatabasePool): Promise<{ allowed: boolean; user: string }> {
  const result = await pool.query<{ allowed: boolean; user: string }>(
    "select (rolcreatedb or rolsuper) as allowed, current_user as user from pg_roles where rolname = current_user",
  );
  return { allowed: result.rows[0]?.allowed === true, user: result.rows[0]?.user ?? "lunedo" };
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
  const client = new pg.Client({ connectionString: databaseUrl, application_name: "lunedo-test-restore" });
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

const DISK_FULL = /could not extend file|no space left on device|disk full|\b53100\b/i;

function databaseFull(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 6; depth += 1) {
    if ((current as { code?: string }).code === "53100") return true;
    if (current instanceof Error && DISK_FULL.test(current.message)) return true;
    current = typeof current === "object" && "cause" in current ? current.cause : undefined;
  }
  return false;
}

const SPACE_ADVICE =
  "The backup itself was checked and is complete and readable. Free up space in the work directory and on the database server, or move LUNEDO_WORK_DIR to a larger disk, and start the test restore again.";

function formatGb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

async function liveDatabaseSize(pool: DatabasePool): Promise<number> {
  const result = await pool.query<{ size: string }>("select pg_database_size(current_database()) as size");
  return Number(result.rows[0]?.size ?? 0);
}

function filesSize(manifest: BackupManifest): number {
  return manifest.entries
    .filter((entry) => entry.path.startsWith("files/"))
    .reduce((sum, entry) => sum + entry.size, 0);
}

export async function runTestRestore(
  target: BackupTarget,
  name: string,
  runId: string,
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

  let manifest: BackupManifest;
  try {
    const source = await target.source(name);
    try {
      manifest = await verifyBackup({
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

  const filesBytes = Math.ceil(filesSize(manifest) * SPACE_MARGIN);
  const databaseBytes = Math.ceil((await liveDatabaseSize(sources.pool)) * SPACE_MARGIN);
  const neededBytes = filesBytes + databaseBytes;
  const shortOfSpace = (message: string): TestRestoreOutcome => {
    checks.push({ check: "space", passed: false, detail: { neededBytes, databaseBytes, filesBytes } });
    return { state: "verified", stage: "done", checks, error: message };
  };
  try {
    await mkdir(sources.workDir, { recursive: true, mode: 0o700 });
    await checkSpace(
      [
        { dir: sources.workDir, bytes: databaseBytes, label: "the copy of the database" },
        { dir: sources.workDir, bytes: filesBytes, label: "the copy of the file store" },
      ],
      {
        critical: await criticalPercent(sources.pool),
        ...(sources.diskSpace ? { measure: sources.diskSpace } : {}),
        advice: SPACE_ADVICE,
      },
    );
  } catch (error) {
    if (!(error instanceof NotEnoughSpaceError)) throw error;
    return shortOfSpace(error.message);
  }
  const databaseServerFull = () =>
    shortOfSpace(
      `The database server ran out of space for the copy of the database, which needs about ${formatGb(databaseBytes)}. ${SPACE_ADVICE}`,
    );

  stage = "restore";
  await onStage(stage, checks);
  const { database: databaseName, directory: filesDir } = testRestoreNames(sources.workDir, runId);
  const databaseUrl = databaseUrlFor(sources.databaseUrl, databaseName);
  let created = false;
  try {
    try {
      await sources.pool.query(`create database ${quoteIdentifier(databaseName)}`);
    } catch (error) {
      sources.logger.warn({ reason: describeFailure(error) }, "Creating the test restore database failed");
      return databaseServerFull();
    }
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
    if (databaseFull(error)) return databaseServerFull();
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
