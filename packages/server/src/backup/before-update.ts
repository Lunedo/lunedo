import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { uuidv7 } from "@lunedo/shared";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { SYSTEM } from "../accounts/principal.js";
import { type AuditEventInput, AuditLog } from "../audit/audit-log.js";
import type { AuditEventName } from "../audit/catalog.js";
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
export const SKIP_COMMAND = "docker compose run --rm lunedo backup skip-before-update";

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

async function restoredAndUnconfirmed(database: Database, workDir: string): Promise<boolean> {
  if (await hasRestoredMarker(workDir)) return true;
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
  const paused = await restoredAndUnconfirmed(options.database, options.sources.workDir);
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
    paused,
  };
}

export async function createBeforeUpdateBackup(options: BeforeUpdateOptions): Promise<WrittenBackup> {
  const { logger, database } = options;
  let lock = await tryBackupLock(options.sources.pool);
  if (!lock) {
    logger.info("Waiting for a running backup to finish before the backup before the update starts");
    lock = await waitForBackupLock(options.sources.pool);
  }
  let target: BackupTarget | null = null;
  try {
    let opened: Awaited<ReturnType<typeof openConfiguredTarget>>;
    try {
      opened = await openConfiguredTarget(options, await options.sources.masterKeys());
    } catch (error) {
      await audit(database, logger, {
        name: "backup.failed",
        actor: SYSTEM,
        targetId: null,
        fields: { backupClass: "beforeUpdate", trigger: "beforeUpdate", reason: describeFailure(error) },
      });
      throw error;
    }
    const { configuration, configured, paused } = opened;
    target = opened.target;
    if (paused) {
      logger.warn(
        { target: target.description },
        `This instance was restored from a backup and its backup target is not confirmed yet, so the backup before the update goes to ${target.description}`,
      );
    } else if (!configured) {
      logger.warn(
        { target: target.description },
        `No backup target is set up, so the backup before the update goes to ${target.description}`,
      );
    }
    const name = backupName("beforeUpdate", new Date());
    const runId = await recordStart(database, { name, target: target.description });
    try {
      logger.info({ target: target.description }, "Creating the backup before the update");
      const written = await writeBackup(options.sources, {
        target,
        backupClass: "beforeUpdate",
        scope: configuration.settings.scope,
        name,
      });
      await recordEnd(database, runId, { state: "succeeded", sizeBytes: written.sizeBytes });
      await audit(database, logger, {
        name: "backup.created",
        actor: SYSTEM,
        targetId: null,
        fields: {
          name: written.name,
          backupClass: "beforeUpdate",
          trigger: "beforeUpdate",
          location: written.location,
          sizeBytes: written.sizeBytes,
        },
      });
      if (!paused) {
        const deleted = await applyRetention(target, configuration.settings.retention, {
          classes: ["beforeUpdate"],
          own: await recordedBackupNames(database, "succeeded"),
          logger,
        });
        for (const expired of deleted) {
          await audit(database, logger, {
            name: "backup.deleted",
            actor: SYSTEM,
            targetId: null,
            fields: { name: expired, backupClass: "beforeUpdate", reason: "retention" },
          });
        }
      }
      logger.info(
        { location: written.location, sizeBytes: written.sizeBytes },
        "Backup before the update created",
      );
      return written;
    } catch (error) {
      const reason = describeFailure(error);
      await recordEnd(database, runId, { state: "failed", error: reason });
      await audit(database, logger, {
        name: "backup.failed",
        actor: SYSTEM,
        targetId: null,
        fields: { backupClass: "beforeUpdate", trigger: "beforeUpdate", reason },
      });
      throw error;
    }
  } finally {
    if (target) closeTarget(target);
    await lock.release();
  }
}

export async function backupBeforeMigrations(
  options: BeforeUpdateOptions & { environmentAllows: boolean; skipRequested: boolean },
): Promise<void> {
  const { logger } = options;
  if (!options.environmentAllows) {
    logger.warn(
      "Migrations are pending; the backup before the update is turned off by LUNEDO_BACKUP_BEFORE_UPDATE",
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
      `The backup before the database update failed, so the migrations were not run: ${describeFailure(error)} Fix the cause and start Lunedo again, or start once without this backup after running: ${SKIP_COMMAND}`,
    );
  }
}
