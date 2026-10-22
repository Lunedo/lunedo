import { chmod, mkdir, readdir, rm, stat, statfs } from "node:fs/promises";
import path from "node:path";
import { Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { sql } from "drizzle-orm";
import { type EncryptedColumn, encryptedColumns } from "../crypto/encrypted-column.js";
import type { EncryptedStreamOwner } from "../crypto/encrypted-stream.js";
import { type KeyRing, keyFingerprint } from "../crypto/key-ring.js";
import { masterKeyVersionsInUse } from "../crypto/key-usage.js";
import type { Database } from "../database/database.js";
import type { DatabasePool } from "../database/pool.js";
import type { FileStore } from "../files/store.js";
import type { Logger } from "../logging/logger.js";
import { formatBytes } from "../storage/format.js";
import {
  type BackupDestination,
  BackupError,
  type BackupHeader,
  type BackupManifest,
  type BackupScope,
  createBackup,
  STAGED_DUMP,
} from "./archive.js";
import { describeFailure } from "./errors.js";
import { type BackupClass, type BackupName, backupName, parseBackupName } from "./naming.js";
import type { DatabaseArchiver } from "./postgres.js";
import { expiredBackups, type RetentionPolicy } from "./retention.js";
import type { BackupTarget } from "./targets.js";

const BACKUP_LOCK = "pagehall.backup";
const ROTATION_LOCK = "pagehall.key-rotation";
const TEST_RESTORE_LOCK = "pagehall.backup-test-restore";
const PROGRESS_INTERVAL_MS = 30_000;

export interface BackupSources {
  pool: DatabasePool;
  database: Database;
  archiver: DatabaseArchiver;
  filesDir: string;
  objectStore: FileStore | undefined;
  streamOwners: readonly EncryptedStreamOwner[];
  columns?: readonly EncryptedColumn[];
  backupKeys: KeyRing;
  masterKeys: () => Promise<KeyRing | null>;
  workDir: string;
  diskSpace?: ((dir: string) => Promise<DiskSpace>) | undefined;
  configuration: Record<string, string>;
  pagehallVersion: string;
  schemaVersion: string;
  logger: Logger;
}

export interface DiskSpace {
  free: number;
  total: number;
  device: number;
}

export async function diskSpace(dir: string): Promise<DiskSpace> {
  const [stats, info] = await Promise.all([statfs(dir), stat(dir)]);
  return { free: stats.bavail * stats.bsize, total: stats.blocks * stats.bsize, device: info.dev };
}

export class NotEnoughSpaceError extends BackupError {
  override name = "NotEnoughSpaceError";
}

const SPACE_MARGIN = 1.2;
const DEFAULT_CRITICAL_PERCENT = 95;

export async function criticalPercent(pool: Pick<DatabasePool, "query">): Promise<number> {
  try {
    const result = await pool.query<{ value: unknown }>(
      "select value from setting_values where level = 'instance' and key = 'storage.criticalPercent' and value is not null limit 1",
    );
    const value = result.rows[0]?.value;
    return typeof value === "number" && value > 0 && value <= 100 ? value : DEFAULT_CRITICAL_PERCENT;
  } catch {
    return DEFAULT_CRITICAL_PERCENT;
  }
}

export async function databaseSize(database: Database): Promise<number> {
  const result = await database.execute<{ size: string }>(
    sql`select pg_database_size(current_database()) as size`,
  );
  return Number(result.rows[0]?.size ?? 0);
}

async function previousBackupSize(database: Database): Promise<number> {
  try {
    const result = await database.execute<{ size: string | null }>(sql`
      select size_bytes as size from backup_runs where state = 'succeeded' and size_bytes is not null
      order by finished_at desc nulls last limit 1`);
    return Number(result.rows[0]?.size ?? 0);
  } catch {
    return 0;
  }
}

function formatGb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export interface SpaceNeed {
  dir: string;
  bytes: number;
  label: string;
}

export async function checkSpace(
  needs: readonly SpaceNeed[],
  options: { critical: number; measure?: (dir: string) => Promise<DiskSpace>; advice: string },
): Promise<void> {
  const measure = options.measure ?? diskSpace;
  const disks = new Map<number, { space: DiskSpace; bytes: number; labels: string[] }>();
  for (const need of needs) {
    const space = await measure(need.dir);
    const disk = disks.get(space.device) ?? { space, bytes: 0, labels: [] };
    disk.bytes += need.bytes;
    disk.labels.push(need.label);
    disks.set(space.device, disk);
  }
  for (const { space, bytes, labels } of disks.values()) {
    if (space.total <= 0) continue;
    const projected = ((space.total - space.free + bytes) / space.total) * 100;
    if (bytes > space.free || projected >= options.critical) {
      throw new NotEnoughSpaceError(
        `Not enough free space for ${labels.join(" and ")}: about ${formatGb(bytes)} are needed, ${formatGb(space.free)} are free, and the disk must stay below ${options.critical} %. ${options.advice}`,
      );
    }
  }
}

async function checkBackupSpace(
  sources: BackupSources,
  stagingDir: string,
  outputDir: string | null,
): Promise<void> {
  const database = await databaseSize(sources.database);
  const needs: SpaceNeed[] = [
    {
      dir: stagingDir,
      bytes: Math.ceil(database * SPACE_MARGIN),
      label: "the database dump in the work directory",
    },
  ];
  if (outputDir !== null) {
    const archive = Math.max(await previousBackupSize(sources.database), database);
    needs.push({
      dir: outputDir,
      bytes: Math.ceil(archive * SPACE_MARGIN),
      label: "the backup in the target",
    });
  }
  await checkSpace(needs, {
    critical: await criticalPercent(sources.pool),
    ...(sources.diskSpace ? { measure: sources.diskSpace } : {}),
    advice: "Free up space, lower the number of kept backups, or choose another target or work directory.",
  });
}

export interface Lock {
  release(): Promise<void>;
}

async function advisoryLock(
  pool: DatabasePool,
  name: string,
  mode: { shared: boolean; wait: boolean },
): Promise<Lock | null> {
  const client = await pool.connect();
  try {
    const fn = `pg_${mode.wait ? "" : "try_"}advisory_lock${mode.shared ? "_shared" : ""}`;
    const result = await client.query<{ locked: boolean | string }>(`select ${fn}(hashtext($1)) as locked`, [
      name,
    ]);
    if (!mode.wait && result.rows[0]?.locked !== true) {
      client.release();
      return null;
    }
  } catch (error) {
    client.release(error as Error);
    throw error;
  }
  let released = false;
  return {
    release: async () => {
      if (released) return;
      released = true;
      try {
        await client.query(`select pg_advisory_unlock${mode.shared ? "_shared" : ""}(hashtext($1))`, [name]);
        client.release();
      } catch (error) {
        client.release(error as Error);
      }
    },
  };
}

export function tryBackupLock(pool: DatabasePool): Promise<Lock | null> {
  return advisoryLock(pool, BACKUP_LOCK, { shared: false, wait: false });
}

export async function waitForBackupLock(pool: DatabasePool): Promise<Lock> {
  return (await advisoryLock(pool, BACKUP_LOCK, { shared: false, wait: true })) as Lock;
}

async function lockHeld(pool: DatabasePool, name: string): Promise<boolean> {
  const result = await pool.query<{ held: boolean }>(
    `select exists (
      select 1 from pg_locks where locktype = 'advisory' and granted and objsubid = 1
        and database = (select oid from pg_database where datname = current_database())
        and ((classid::bigint << 32) | objid::bigint) = hashtext($1)::bigint
    ) as held`,
    [name],
  );
  return result.rows[0]?.held === true;
}

export function isBackupRunning(pool: DatabasePool): Promise<boolean> {
  return lockHeld(pool, BACKUP_LOCK);
}

export function tryTestRestoreLock(pool: DatabasePool): Promise<Lock | null> {
  return advisoryLock(pool, TEST_RESTORE_LOCK, { shared: false, wait: false });
}

export function isTestRestoreRunning(pool: DatabasePool): Promise<boolean> {
  return lockHeld(pool, TEST_RESTORE_LOCK);
}

async function existingColumns(
  database: Database,
  columns: readonly EncryptedColumn[],
): Promise<EncryptedColumn[]> {
  const result = await database.execute<{ table_name: string; column_name: string }>(sql`
    select table_name, column_name from information_schema.columns where table_schema = current_schema()`);
  const present = new Set(result.rows.map((row) => `${row.table_name}.${row.column_name}`));
  return columns.filter((column) => present.has(`${column.table}.${column.column}`));
}

async function runningRotationTargets(database: Database): Promise<number[]> {
  try {
    const result = await database.execute<{ target_version: number }>(
      sql`select distinct target_version from key_rotations where status = 'running'`,
    );
    return result.rows.map((row) => Number(row.target_version));
  } catch {
    return [];
  }
}

export async function masterKeysForBackup(sources: BackupSources): Promise<BackupHeader["masterKeys"]> {
  const inUse = Object.keys(
    await masterKeyVersionsInUse({
      database: sources.database,
      columns: await existingColumns(sources.database, sources.columns ?? encryptedColumns),
      streams: {
        owners: () => sources.streamOwners,
        context: { database: sources.database, filesDir: sources.filesDir },
      },
    }),
  ).map(Number);
  const versions = [...new Set([...inUse, ...(await runningRotationTargets(sources.database))])].sort(
    (a, b) => a - b,
  );
  if (versions.length === 0) return [];
  const ring = await sources.masterKeys();
  return versions.map((version) => {
    if (!ring?.has(version)) {
      throw new BackupError(
        `Encrypted data uses master key version ${version}, which is not in the master key ring of this instance, so a backup could not be restored. Restore that key version first.`,
      );
    }
    return { version, fingerprint: keyFingerprint("master", ring.get(version)) };
  });
}

function counted(
  destination: BackupDestination,
  onBytes: (bytes: number) => void,
): BackupDestination & { bytes(): number } {
  let bytes = 0;
  let inner: Promise<void> | undefined;
  return {
    bytes: () => bytes,
    open() {
      const output = destination.open();
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback: TransformCallback) {
          bytes += chunk.length;
          onBytes(bytes);
          callback(null, chunk);
        },
      });
      inner = pipeline(counter, output);
      inner.catch((error: unknown) => counter.destroy(error as Error));
      return counter;
    },
    async commit() {
      await inner;
      await destination.commit();
    },
    async abort() {
      await inner?.catch(() => undefined);
      await destination.abort();
    },
  };
}

export interface WrittenBackup {
  name: string;
  location: string;
  sizeBytes: number;
  manifest: BackupManifest;
}

const STAGING = "backup-staging";

export class StagingInsideTargetError extends BackupError {
  override name = "StagingInsideTargetError";
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function stagingDirectory(workDir: string): string {
  return path.join(workDir, STAGING);
}

async function privateStaging(sources: BackupSources, target?: BackupTarget): Promise<string> {
  const staging = stagingDirectory(sources.workDir);
  if (target?.kind === "local" && isInside(target.description, staging)) {
    throw new StagingInsideTargetError(
      `The work directory ${sources.workDir} lies inside the backup target ${target.description}, so the staged database dump would be written into the target. Choose a target outside ${sources.workDir}, or move PAGEHALL_WORK_DIR.`,
    );
  }
  await mkdir(sources.workDir, { recursive: true, mode: 0o700 });
  await chmod(sources.workDir, 0o700);
  await mkdir(staging, { recursive: true, mode: 0o700 });
  await chmod(staging, 0o700);
  return staging;
}

async function removeStagedDumps(workDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(stagingDirectory(workDir));
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const entry of entries) {
    if (!STAGED_DUMP.test(entry)) continue;
    await rm(path.join(stagingDirectory(workDir), entry), { force: true });
    removed.push(entry);
  }
  return removed;
}

export async function removeStaleStaging(pool: DatabasePool, workDir: string, logger: Logger): Promise<void> {
  const lock = await tryBackupLock(pool);
  if (!lock) return;
  try {
    const removed = await removeStagedDumps(workDir);
    if (removed.length > 0)
      logger.info({ removed: removed.length }, "Staged files of interrupted backups removed");
  } finally {
    await lock.release();
  }
}

export async function recordedBackupNames(
  database: Database,
  which: "succeeded" | "incomplete",
): Promise<Set<string>> {
  try {
    const result = await database.execute<{ name: string }>(
      which === "succeeded"
        ? sql`select name from backup_runs where name is not null and state = 'succeeded'`
        : sql`select name from backup_runs where name is not null and state in ('running', 'failed')`,
    );
    return new Set(result.rows.map((row) => row.name));
  } catch {
    return new Set();
  }
}

export async function writeBackup(
  sources: BackupSources,
  options: { target: BackupTarget; backupClass: BackupClass; scope: BackupScope; name?: string; now?: Date },
): Promise<WrittenBackup> {
  const rotation = await advisoryLock(sources.pool, ROTATION_LOCK, { shared: true, wait: true });
  try {
    const masterKeys = await masterKeysForBackup(sources);
    const name = options.name ?? backupName(options.backupClass, options.now ?? new Date());
    let reported = Date.now();
    const destination = counted(options.target.destination(name), (bytes) => {
      if (Date.now() - reported < PROGRESS_INTERVAL_MS) return;
      reported = Date.now();
      sources.logger.info({ backup: name, written: formatBytes(bytes) }, "Backup in progress");
    });
    const stagingDir = await privateStaging(sources, options.target);
    if (options.target.kind === "local") await options.target.capacity();
    await checkBackupSpace(
      sources,
      stagingDir,
      options.target.kind === "local" ? options.target.description : null,
    );
    await options.target.removeIncomplete(await recordedBackupNames(sources.database, "incomplete"));
    await removeStagedDumps(sources.workDir);
    const manifest = await createBackup({
      output: destination,
      stagingDir,
      backupKeys: sources.backupKeys,
      masterKeys,
      database: sources.archiver,
      filesDir: sources.filesDir,
      objectStore: sources.objectStore,
      scope: options.scope,
      config: sources.configuration,
      pagehallVersion: sources.pagehallVersion,
      schemaVersion: sources.schemaVersion,
      logger: sources.logger,
    });
    return { name, location: options.target.location(name), sizeBytes: destination.bytes(), manifest };
  } finally {
    await rotation?.release();
  }
}

export async function writeBackupFile(sources: BackupSources, output: string): Promise<BackupManifest> {
  let lock = await tryBackupLock(sources.pool);
  if (!lock) {
    sources.logger.warn("Waiting for a running backup to finish");
    lock = await waitForBackupLock(sources.pool);
  }
  try {
    const rotation = await advisoryLock(sources.pool, ROTATION_LOCK, { shared: true, wait: true });
    try {
      const stagingDir = await privateStaging(sources);
      await checkBackupSpace(sources, stagingDir, path.dirname(output));
      await removeStagedDumps(sources.workDir);
      return await createBackup({
        output,
        stagingDir,
        backupKeys: sources.backupKeys,
        masterKeys: await masterKeysForBackup(sources),
        database: sources.archiver,
        filesDir: sources.filesDir,
        objectStore: sources.objectStore,
        config: sources.configuration,
        pagehallVersion: sources.pagehallVersion,
        schemaVersion: sources.schemaVersion,
        logger: sources.logger,
      });
    } finally {
      await rotation?.release();
    }
  } finally {
    await lock.release();
  }
}

export interface ListedBackup extends BackupName {
  sizeBytes: number;
  header: BackupHeader | null;
}

export async function listBackups(target: BackupTarget): Promise<ListedBackup[]> {
  const stored = await target.list();
  const listed: ListedBackup[] = [];
  for (const object of stored) {
    const parsed = parseBackupName(object.name);
    if (!parsed) continue;
    let header: BackupHeader | null = null;
    try {
      header = await target.readHeader(object.name);
    } catch {
      header = null;
    }
    listed.push({ ...parsed, sizeBytes: object.size, header });
  }
  return listed.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function applyRetention(
  target: BackupTarget,
  policy: RetentionPolicy,
  options: { classes?: readonly BackupClass[]; logger: Logger },
): Promise<string[]> {
  const listed = (await listBackups(target)).filter(
    (backup) => backup.header !== null && (!options.classes || options.classes.includes(backup.backupClass)),
  );
  const deleted: string[] = [];
  for (const backup of expiredBackups(listed, policy)) {
    try {
      await target.delete(backup.name);
      deleted.push(backup.name);
    } catch (error) {
      options.logger.warn(
        { reason: describeFailure(error), backup: backup.name },
        "Deleting an expired backup failed",
      );
    }
  }
  if (deleted.length > 0) options.logger.info({ deleted }, "Expired backups deleted");
  return deleted;
}
