import { rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import { Encryption } from "../crypto/envelope.js";
import type { KeyRing } from "../crypto/key-ring.js";
import type { Database } from "../database/database.js";
import type { Logger } from "../logging/logger.js";
import type { OutboundPolicy } from "../outbound/guarded-request.js";
import { StartupError } from "../runtime/startup-error.js";
import { closeTarget, openTarget, readBackupConfiguration, readS3Secret } from "./configuration.js";
import { describeFailure } from "./errors.js";
import { backupName } from "./naming.js";
import { hasRestoredMarker } from "./restore-marker.js";
import {
  applyRetention,
  type BackupSources,
  recordedBackupNames,
  tryBackupLock,
  type WrittenBackup,
  waitForBackupLock,
  writeBackup,
} from "./runner.js";
import { type BackupTarget, ensureDirectory, LocalBackupTarget } from "./targets.js";

export const SKIP_BEFORE_UPDATE_MARKER = "skip-backup-before-update.json";
export const SKIP_COMMAND = "docker compose run --rm pagehall backup skip-before-update";

const skipMarkerSchema = z.object({ version: z.string().min(1), createdAt: z.string() });

export class BackupBeforeUpdateError extends StartupError {
  override name = "BackupBeforeUpdateError";
}

export interface BeforeUpdateOptions {
  sources: BackupSources;
  database: Database;
  backupDir: string;
  policy: OutboundPolicy;
  logger: Logger;
}

export async function requestSkipBeforeUpdate(workDir: string, version: string): Promise<string> {
  await ensureDirectory(workDir);
  const marker = path.join(workDir, SKIP_BEFORE_UPDATE_MARKER);
  await writeFile(marker, `${JSON.stringify({ version, createdAt: new Date().toISOString() })}\n`, {
    mode: 0o600,
  });
  return marker;
}

export async function consumeSkipMarker(workDir: string, version: string, logger: Logger): Promise<boolean> {
  const marker = path.join(workDir, SKIP_BEFORE_UPDATE_MARKER);
  let content: string;
  try {
    content = await readFile(marker, "utf8");
  } catch {
    return false;
  }
  await rm(marker, { force: true });
  let parsed: z.infer<typeof skipMarkerSchema> | null = null;
  try {
    parsed = skipMarkerSchema.parse(JSON.parse(content));
  } catch {
    parsed = null;
  }
  if (parsed?.version === version) return true;
  logger.warn(
    { requestedFor: parsed?.version ?? null, version },
    "A request to skip the backup before an update was for another version; it was removed and is not applied",
  );
  return false;
}

async function recordStart(
  database: Database,
  values: { name: string; target: string },
): Promise<string | null> {
  const id = uuidv7();
  try {
    await database.execute(sql`
      insert into backup_runs (id, trigger, backup_class, state, name, target, started_at)
      values (${id}, 'beforeUpdate', 'beforeUpdate', 'running', ${values.name}, ${values.target}, now())`);
    return id;
  } catch {
    return null;
  }
}

async function recordEnd(
  database: Database,
  id: string | null,
  values: { state: "succeeded" | "failed"; sizeBytes?: number; error?: string },
): Promise<void> {
  if (!id) return;
  try {
    await database.execute(sql`
      update backup_runs set state = ${values.state}, size_bytes = ${values.sizeBytes ?? null},
        error = ${values.error ?? null}, finished_at = now(), updated_at = now()
      where id = ${id}`);
  } catch {
    return;
  }
}

const MISSING_SCHEMA = new Set(["42P01", "42703"]);

async function audit<TName extends AuditEventName>(
  database: Database,
  logger: Logger,
  input: AuditEventInput<TName>,
): Promise<void> {
  try {
    await new AuditLog({ database }).recordAlone(input);
  } catch (error) {
    if (MISSING_SCHEMA.has((error as { code?: string }).code ?? "")) return;
    logger.warn({ reason: describeFailure(error), event: input.name }, "Recording an audit event failed");
  }
}

async function restoredAndUnconfirmed(database: Database, filesDir: string): Promise<boolean> {
  if (await hasRestoredMarker(filesDir)) return true;
  try {
    const result = await database.execute<{ restored: boolean }>(
      sql`select restored_at is not null as restored from backup_state where singleton`,
    );
    return result.rows[0]?.restored === true;
  } catch {
    return false;
  }
}

async function openConfiguredTarget(options: BeforeUpdateOptions, masterKeys: KeyRing | null) {
  const configuration = await readBackupConfiguration(options.database);
  const paused = await restoredAndUnconfirmed(options.database, options.sources.filesDir);
  if (!configuration.target || paused) {
    await ensureDirectory(options.backupDir);
    return {
      configuration,
      target: new LocalBackupTarget(options.backupDir) as BackupTarget,
      configured: false,
      paused,
    };
  }
  const secret =
    configuration.target.kind === "s3" && masterKeys
      ? await readS3Secret(options.database, new Encryption(() => masterKeys))
      : null;
  return {
    configuration,
    target: openTarget(configuration.target, { secret, policy: options.policy }),
    configured: true,
  };
}

export async function createBeforeUpdateBackup(options: BeforeUpdateOptions): Promise<WrittenBackup> {
  const { logger } = options;
  const { configuration, target, configured } = await openConfiguredTarget(
    options,
    await options.sources.masterKeys(),
  );
  if (!configured) {
    logger.warn(
      { target: target.description },
      `No backup target is set up, so the backup before the update goes to ${target.description}`,
    );
  }
  const startedAt = new Date();
  let lock = await tryBackupLock(options.sources.pool);
  if (!lock) {
    logger.info("Waiting for a running backup to finish before the backup before the update starts");
    lock = await waitForBackupLock(options.sources.pool);
  }
  try {
    logger.info({ target: target.description }, "Creating the backup before the update");
    const written = await writeBackup(options.sources, {
      target,
      backupClass: "beforeUpdate",
      scope: configuration.settings.scope,
    });
    await recordRun(options.database, { state: "succeeded", written, target: target.description, startedAt });
    await applyRetention(target, configuration.settings.retention, { classes: ["beforeUpdate"], logger });
    logger.info(
      { location: written.location, sizeBytes: written.sizeBytes },
      "Backup before the update created",
    );
    return written;
  } catch (error) {
    await recordRun(options.database, {
      state: "failed",
      target: target.description,
      error: describeFailure(error),
      startedAt,
    });
    throw error;
  } finally {
    closeTarget(target);
    await lock.release();
  }
}

export async function backupBeforeMigrations(
  options: BeforeUpdateOptions & { environmentAllows: boolean },
): Promise<void> {
  const { logger } = options;
  if (!options.environmentAllows) {
    logger.warn(
      "Migrations are pending; the backup before the update is turned off by PAGEHALL_BACKUP_BEFORE_UPDATE",
    );
    return;
  }
  if (options.skipRequested) {
    logger.warn("Migrations are pending; the backup before the update was skipped once as requested");
    return;
  }
  const configuration = await readBackupConfiguration(options.database);
  if (!configuration.settings.beforeUpdate) {
    logger.warn("Migrations are pending; the backup before the update is turned off in the backup settings");
    return;
  }
  try {
    await createBeforeUpdateBackup(options);
  } catch (error) {
    logger.error({ reason: describeFailure(error) }, "The backup before the update failed");
    throw new BackupBeforeUpdateError(
      `The backup before the database update failed, so the migrations were not run: ${describeFailure(error)} Fix the cause and start Pagehall again, or start once without this backup after running: ${SKIP_COMMAND}`,
    );
  }
}
