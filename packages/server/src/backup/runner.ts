import { chmod, mkdir, readdir, rm } from "node:fs/promises";
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
  stagingDir: string;
  configuration: Record<string, string>;
  pagehallVersion: string;
  schemaVersion: string;
  logger: Logger;
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

const STAGING = ".pagehall-staging";
const STAGED_DUMP = /^\.pagehall-backup-[0-9a-f-]{36}\.dump$/;

async function privateStaging(sources: BackupSources): Promise<string> {
  const staging = path.join(sources.stagingDir, STAGING);
  await mkdir(staging, { recursive: true, mode: 0o700 });
  await chmod(staging, 0o700);
  return staging;
}

async function removeStaleDumps(sources: BackupSources): Promise<void> {
  const staging = path.join(sources.stagingDir, STAGING);
  let entries: string[];
  try {
    entries = await readdir(staging);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (STAGED_DUMP.test(entry)) await rm(path.join(staging, entry), { force: true });
  }
}

export async function writeBackup(
  sources: BackupSources,
  options: { target: BackupTarget; backupClass: BackupClass; scope: BackupScope; now?: Date },
): Promise<WrittenBackup> {
  const rotation = await advisoryLock(sources.pool, ROTATION_LOCK, { shared: true, wait: true });
  try {
    const masterKeys = await masterKeysForBackup(sources);
    const name = backupName(options.backupClass, options.now ?? new Date());
    let reported = Date.now();
    const destination = counted(options.target.destination(name), (bytes) => {
      if (Date.now() - reported < PROGRESS_INTERVAL_MS) return;
      reported = Date.now();
      sources.logger.info({ backup: name, written: formatBytes(bytes) }, "Backup in progress");
    });
    await options.target.removeIncomplete();
    await removeStaleDumps(sources);
    const manifest = await createBackup({
      output: destination,
      stagingDir: await privateStaging(sources),
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
  const rotation = await advisoryLock(sources.pool, ROTATION_LOCK, { shared: true, wait: true });
  try {
    return await createBackup({
      output,
      stagingDir: await privateStaging(sources),
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
