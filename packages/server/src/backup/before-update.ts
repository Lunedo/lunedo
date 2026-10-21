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
import {
  applyRetention,
  type BackupSources,
  tryBackupLock,
  type WrittenBackup,
  waitForBackupLock,
  writeBackup,
} from "./runner.js";
import { describeFailure } from "./service.js";
import { type BackupTarget, ensureDirectory, LocalBackupTarget } from "./targets.js";

export const SKIP_BEFORE_UPDATE_MARKER = ".pagehall-skip-backup-before-update";
export const SKIP_COMMAND = "docker compose run --rm pagehall backup skip-before-update";

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

export async function requestSkipBeforeUpdate(backupDir: string): Promise<string> {
  await ensureDirectory(backupDir);
  const marker = path.join(backupDir, SKIP_BEFORE_UPDATE_MARKER);
  await writeFile(marker, `${new Date().toISOString()}\n`, { mode: 0o600 });
  return marker;
}

async function consumeSkip(backupDir: string): Promise<boolean> {
  const marker = path.join(backupDir, SKIP_BEFORE_UPDATE_MARKER);
  try {
    await stat(marker);
  } catch {
    return false;
  }
  await rm(marker, { force: true });
  return true;
}

async function recordRun(
  database: Database,
  values: {
    state: "succeeded" | "failed";
    written?: WrittenBackup;
    target: string;
    error?: string;
    startedAt: Date;
  },
): Promise<void> {
  try {
    await database.execute(sql`
      insert into backup_runs (id, trigger, backup_class, state, name, target, size_bytes, error, started_at, finished_at)
      values (${uuidv7()}, 'beforeUpdate', 'beforeUpdate', ${values.state}, ${values.written?.name ?? null},
        ${values.target}, ${values.written?.sizeBytes ?? null}, ${values.error ?? null}, ${values.startedAt}, now())`);
  } catch {
    return;
  }
}

async function openConfiguredTarget(options: BeforeUpdateOptions, masterKeys: KeyRing | null) {
  const configuration = await readBackupConfiguration(options.database);
  if (!configuration.target) {
    await ensureDirectory(options.backupDir);
    return {
      configuration,
      target: new LocalBackupTarget(options.backupDir) as BackupTarget,
      configured: false,
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
  if (await consumeSkip(options.backupDir)) {
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
    logger.error({ err: error }, "The backup before the update failed");
    throw new BackupBeforeUpdateError(
      `The backup before the database update failed, so the migrations were not run: ${describeFailure(error)} Fix the cause and start Pagehall again, or start once without this backup after running: ${SKIP_COMMAND}`,
    );
  }
}
