import { uuidv7 } from "@pagehall/shared";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { instanceNameSetting, instanceUrlSetting } from "../accounts/instance-settings.js";
import type { Principal } from "../accounts/principal.js";
import { SYSTEM } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import { instanceAdministratorIds } from "../auth/emergency-recipients.js";
import type { ChatChannelService } from "../chat/channels.js";
import type { Encryption } from "../crypto/envelope.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import type { DatabasePool } from "../database/pool.js";
import type { JobQueue } from "../jobs/job-queue.js";
import type { Logger } from "../logging/logger.js";
import {
  backupFailed,
  backupMissing,
  backupRecovered,
  backupTestRestoreFailed,
} from "../mail/backup-texts.js";
import type { MailService } from "../mail/mail-service.js";
import { instanceSecrets } from "../mail/schema.js";
import type { Content, Language } from "../mail/templates.js";
import type { NotificationService } from "../notifications/service.js";
import { OutboundError, type OutboundPolicy, parseOutboundUrl } from "../outbound/guarded-request.js";
import { languageSetting, timeZoneSetting } from "../settings/builtin.js";
import type { SettingsService } from "../settings/service.js";
import { storageOperationsEmailsSetting, storageReminderSetting } from "../storage/settings.js";
import { reminderDue } from "../storage/storage.js";
import { BackupError, type BackupScope } from "./archive.js";
import {
  BACKUP_S3_SECRET,
  type BackupConfiguration,
  type BackupSettings,
  backupS3SecretContext,
  closeTarget,
  localPathProblem,
  MissingTargetSecretError,
  openTarget,
  readBackupConfiguration,
  readS3Secret,
  type TargetSettings,
} from "./configuration.js";
import { BackupBusyError, BackupNotFoundError, BackupSettingsError } from "./errors.js";
import { backupRunJob, backupTestRestoreJob } from "./jobs.js";
import { type BackupClass, parseBackupName } from "./naming.js";
import type { RetentionPolicy } from "./retention.js";
import {
  applyRetention,
  type BackupSources,
  isBackupRunning,
  isTestRestoreRunning,
  type ListedBackup,
  listBackups,
  tryBackupLock,
  tryTestRestoreLock,
  writeBackup,
} from "./runner.js";
import { type BackupSchedule, classOfSlot, DAILY_TIME, latestSlot, nextSlot } from "./schedule.js";
import {
  backupConfiguration,
  backupRuns,
  backupState,
  backupTestRestores,
  type TestRestoreCheck,
} from "./schema.js";
import {
  type BackupTarget,
  BackupTargetError,
  sameVolume,
  type TargetFailure,
  type TargetStep,
} from "./targets.js";
import { runTestRestore, type TestRestoreSources } from "./test-restore.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const BACKUP_SETTINGS_PATH = "/settings/instance/backups";
const REASON_LIMIT = 600;
const RECENT_RUNS = 20;

export type BackupTrigger = "scheduled" | "manual" | "beforeUpdate";
export type BackupAlert = "none" | "failing" | "missing";
export type BackupWarning = "off" | "noTarget";

export interface SettingsInput {
  enabled?: boolean | undefined;
  dailyTime?: string | undefined;
  weeklyDay?: number | null | undefined;
  monthlyDay?: number | null | undefined;
  retention?: Partial<RetentionPolicy> | undefined;
  scope?: BackupScope | undefined;
  beforeUpdate?: boolean | undefined;
  missingDays?: number | undefined;
  autoTestRestore?: boolean | undefined;
}

export type TargetInput =
  | { kind: "local"; path: string }
  | {
      kind: "s3";
      endpoint: string | null;
      region: string;
      bucket: string;
      prefix: string;
      forcePathStyle: boolean;
      accessKeyId: string;
      secretAccessKey?: string | undefined;
    };

export type TargetView =
  | { kind: "local"; path: string; sameVolumeAsFiles: boolean }
  | {
      kind: "s3";
      endpoint: string | null;
      region: string;
      bucket: string;
      prefix: string;
      forcePathStyle: boolean;
      accessKeyId: string;
      secretKeyConfigured: boolean;
    };

export interface RunView {
  id: string;
  trigger: BackupTrigger;
  backupClass: BackupClass;
  state: "running" | "succeeded" | "failed" | "skipped";
  name: string | null;
  sizeBytes: number | null;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface TestRestoreView {
  id: string;
  trigger: "manual" | "automatic";
  state: "running" | "passed" | "verified" | "failed";
  stage: "verify" | "restore" | "checks" | "done";
  checks: TestRestoreCheck[];
  error: string | null;
  actor: { id: string; name: string } | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface BeforeUpdateState {
  enabled: boolean;
  disabledBy: "setting" | "environment" | null;
}

export interface BackupOverview {
  settings: BackupSettings;
  target: TargetView | null;
  timeZone: string;
  nextRunAt: Date | null;
  beforeUpdate: BeforeUpdateState;
  keyConfirmed: { at: Date; by: { id: string; name: string } | null } | null;
  running: boolean;
  testRestoreRunning: boolean;
  alert: BackupAlert;
  warning: BackupWarning | null;
  lastSuccess: RunView | null;
  lastFailure: RunView | null;
  runs: RunView[];
}

export interface BackupStatus {
  enabled: boolean;
  targetConfigured: boolean;
  running: boolean;
  nextRunAt: Date | null;
  lastSuccess: { at: Date; name: string | null; sizeBytes: number | null } | null;
  lastFailure: { at: Date; reason: string | null } | null;
  alert: BackupAlert;
  beforeUpdate: BeforeUpdateState;
}

export interface BackupListEntry {
  name: string;
  backupClass: BackupClass;
  createdAt: Date;
  sizeBytes: number;
  readable: boolean;
  pagehallVersion: string | null;
  schemaVersion: string | null;
  scope: BackupScope | null;
  testRestore: TestRestoreView | null;
}

export interface BackupList {
  available: boolean;
  error: string | null;
  backups: BackupListEntry[];
}

export type TargetTestResult =
  | { ok: true }
  | { ok: false; failure: TargetFailure; step: TargetStep; message: string };

interface Announcement {
  type: "backup.failed" | "backup.missing" | "backup.recovered" | "backup.testRestoreFailed";
  reason?: string;
  reminder?: boolean;
  days?: number;
  lastSuccessAt?: Date | null;
  backupName?: string;
}

type RunRow = typeof backupRuns.$inferSelect;
type TestRow = typeof backupTestRestores.$inferSelect;

export function describeFailure(error: unknown): string {
  if (
    error instanceof BackupTargetError ||
    error instanceof BackupError ||
    error instanceof MissingTargetSecretError ||
    error instanceof BackupSettingsError
  ) {
    return error.message;
  }
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOSPC" || code === "EDQUOT")
    return "The backup target is full. Free up space or choose another target.";
  const text = error instanceof Error ? error.message : String(error);
  return `The backup failed: ${text}`.slice(0, REASON_LIMIT);
}

function runView(row: RunRow): RunView {
  return {
    id: row.id,
    trigger: row.trigger,
    backupClass: row.backupClass,
    state: row.state,
    name: row.name,
    sizeBytes: row.sizeBytes,
    error: row.error,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

const BUCKET = /^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/;
const PREFIX = /^([A-Za-z0-9._-]+\/)*$/;
const REGION = /^[a-z0-9-]{1,64}$/;
const ACCESS_KEY = /^[\x21-\x7e]{1,256}$/;

export interface BackupServiceOptions {
  database: Database;
  pool: DatabasePool;
  settings: SettingsService;
  notifications: NotificationService;
  mail: MailService;
  chat: ChatChannelService;
  encryption: Encryption;
  audit: AuditLog;
  jobs?: JobQueue | undefined;
  sources: Omit<BackupSources, "logger">;
  testRestore: Omit<TestRestoreSources, "logger" | "pool">;
  policy: OutboundPolicy;
  paths: { files: string; secrets: string; imports: string; backups: string };
  fileStoreKind: "local" | "s3";
  beforeUpdateEnvironment: boolean;
  criticalPercent: () => Promise<number>;
  logger: Logger;
  clock?: () => Date;
}

export class BackupService {
  readonly #options: BackupServiceOptions;
  readonly #database: Database;
  readonly #clock: () => Date;

  constructor(options: BackupServiceOptions) {
    this.#options = options;
    this.#database = options.database;
    this.#clock = options.clock ?? (() => new Date());
  }

  get #logger(): Logger {
    return this.#options.logger;
  }

  async configuration(executor: Pick<Executor, "execute"> = this.#database): Promise<BackupConfiguration> {
    return readBackupConfiguration(executor);
  }

  async #schedule(settings: BackupSettings, executor: Executor = this.#database): Promise<BackupSchedule> {
    return {
      dailyTime: settings.dailyTime,
      weeklyDay: settings.weeklyDay,
      monthlyDay: settings.monthlyDay,
      timeZone: await this.#options.settings.get(timeZoneSetting, {}, { executor }),
    };
  }

  beforeUpdateState(settings: BackupSettings): BeforeUpdateState {
    if (!this.#options.beforeUpdateEnvironment) return { enabled: false, disabledBy: "environment" };
    if (!settings.beforeUpdate) return { enabled: false, disabledBy: "setting" };
    return { enabled: true, disabledBy: null };
  }

  async #secret(executor: Pick<Database, "select"> = this.#database): Promise<string | null> {
    return readS3Secret(executor, this.#options.encryption);
  }

  async #target(configuration: BackupConfiguration): Promise<BackupTarget | null> {
    if (!configuration.target) return null;
    return openTarget(configuration.target, { secret: await this.#secret(), policy: this.#options.policy });
  }

  async #targetView(target: TargetSettings | null): Promise<TargetView | null> {
    if (!target) return null;
    if (target.kind === "local") {
      return {
        kind: "local",
        path: target.path,
        sameVolumeAsFiles:
          this.#options.fileStoreKind === "local" &&
          (await sameVolume(target.path, this.#options.paths.files)),
      };
    }
    return { ...target, secretKeyConfigured: (await this.#secret()) !== null };
  }

  async #state(executor: Executor = this.#database) {
    await executor.insert(backupState).values({ singleton: true }).onConflictDoNothing();
    const [state] = await executor.select().from(backupState).where(eq(backupState.singleton, true));
    if (!state) throw new Error("The backup state is missing");
    return state;
  }

  async #lastRun(state: "succeeded" | "failed"): Promise<RunRow | null> {
    const [row] = await this.#database
      .select()
      .from(backupRuns)
      .where(eq(backupRuns.state, state))
      .orderBy(desc(backupRuns.finishedAt))
      .limit(1);
    return row ?? null;
  }

  async #hasContent(): Promise<boolean> {
    const result = await this.#database.execute<{ present: boolean }>(
      sql`select exists (select 1 from tree_items) as present`,
    );
    return result.rows[0]?.present === true;
  }

  async warning(configuration?: BackupConfiguration): Promise<BackupWarning | null> {
    const current = configuration ?? (await this.configuration());
    if (current.target && current.settings.enabled) return null;
    if (!(await this.#hasContent())) return null;
    return current.target ? "off" : "noTarget";
  }

  async #nextRun(configuration: BackupConfiguration): Promise<Date | null> {
    if (!configuration.settings.enabled || !configuration.target) return null;
    return nextSlot(this.#clock(), await this.#schedule(configuration.settings));
  }

  async overview(): Promise<BackupOverview> {
    const configuration = await this.configuration();
    const state = await this.#state();
    const runs = await this.#database
      .select()
      .from(backupRuns)
      .orderBy(desc(backupRuns.startedAt))
      .limit(RECENT_RUNS);
    const lastSuccess = await this.#lastRun("succeeded");
    const lastFailure = await this.#lastRun("failed");
    let keyConfirmed: BackupOverview["keyConfirmed"] = null;
    if (configuration.keyConfirmed) {
      const by = configuration.keyConfirmed.by;
      const name = by
        ? (await this.#database.execute<{ name: string }>(sql`select name from accounts where id = ${by}`))
            .rows[0]?.name
        : undefined;
      keyConfirmed = { at: configuration.keyConfirmed.at, by: by && name ? { id: by, name } : null };
    }
    return {
      settings: configuration.settings,
      target: await this.#targetView(configuration.target),
      timeZone: await this.#options.settings.get(timeZoneSetting, {}),
      nextRunAt: await this.#nextRun(configuration),
      beforeUpdate: this.beforeUpdateState(configuration.settings),
      keyConfirmed,
      running: await isBackupRunning(this.#options.pool),
      testRestoreRunning: await isTestRestoreRunning(this.#options.pool),
      alert: state.alert,
      warning: await this.warning(configuration),
      lastSuccess: lastSuccess ? runView(lastSuccess) : null,
      lastFailure: lastFailure ? runView(lastFailure) : null,
      runs: runs.map(runView),
    };
  }

  async status(): Promise<BackupStatus> {
    const configuration = await this.configuration();
    const state = await this.#state();
    const lastSuccess = await this.#lastRun("succeeded");
    const lastFailure = await this.#lastRun("failed");
    return {
      enabled: configuration.settings.enabled,
      targetConfigured: configuration.target !== null,
      running: await isBackupRunning(this.#options.pool),
      nextRunAt: await this.#nextRun(configuration),
      lastSuccess: lastSuccess
        ? {
            at: lastSuccess.finishedAt ?? lastSuccess.startedAt,
            name: lastSuccess.name,
            sizeBytes: lastSuccess.sizeBytes,
          }
        : null,
      lastFailure: lastFailure
        ? { at: lastFailure.finishedAt ?? lastFailure.startedAt, reason: lastFailure.error }
        : null,
      alert: state.alert,
      beforeUpdate: this.beforeUpdateState(configuration.settings),
    };
  }

  #validateSettings(current: BackupSettings, input: SettingsInput): BackupSettings {
    const next: BackupSettings = {
      ...current,
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.dailyTime !== undefined ? { dailyTime: input.dailyTime.trim() } : {}),
      ...(input.weeklyDay !== undefined ? { weeklyDay: input.weeklyDay } : {}),
      ...(input.monthlyDay !== undefined ? { monthlyDay: input.monthlyDay } : {}),
      ...(input.scope !== undefined ? { scope: input.scope } : {}),
      ...(input.beforeUpdate !== undefined ? { beforeUpdate: input.beforeUpdate } : {}),
      ...(input.missingDays !== undefined ? { missingDays: input.missingDays } : {}),
      ...(input.autoTestRestore !== undefined ? { autoTestRestore: input.autoTestRestore } : {}),
      retention: { ...current.retention, ...input.retention },
    };
    if (!DAILY_TIME.test(next.dailyTime)) {
      throw new BackupSettingsError(
        "invalidTime",
        "Enter the time as hours and minutes, for example 02:30.",
        ["dailyTime"],
      );
    }
    if (
      next.weeklyDay !== null &&
      !(Number.isInteger(next.weeklyDay) && next.weeklyDay >= 1 && next.weeklyDay <= 7)
    ) {
      throw new BackupSettingsError("invalidDay", "Choose a day of the week.", ["weeklyDay"]);
    }
    if (
      next.monthlyDay !== null &&
      !(Number.isInteger(next.monthlyDay) && next.monthlyDay >= 1 && next.monthlyDay <= 31)
    ) {
      throw new BackupSettingsError("invalidDay", "Choose a day of the month from 1 to 31.", ["monthlyDay"]);
    }
    for (const [field, value] of Object.entries(next.retention)) {
      if (!Number.isInteger(value) || value < 1 || value > 1000) {
        throw new BackupSettingsError("invalidCount", "Keep between 1 and 1000 backups of each kind.", [
          `retention.${field}`,
        ]);
      }
    }
    if (!Number.isInteger(next.missingDays) || next.missingDays < 1 || next.missingDays > 365) {
      throw new BackupSettingsError("invalidCount", "Enter a number of days from 1 to 365.", ["missingDays"]);
    }
    if (next.scope !== "all" && next.scope !== "database") {
      throw new BackupSettingsError("invalidScope", "Choose what the backups contain.", ["scope"]);
    }
    return next;
  }

  async updateSettings(actor: Principal, input: SettingsInput): Promise<BackupOverview> {
    await this.#database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('pagehall.backup-configuration'))`);
      const current = await this.configuration(tx);
      const next = this.#validateSettings(current.settings, input);
      if (next.enabled && !current.settings.enabled && !current.target) {
        throw new BackupSettingsError(
          "noTarget",
          "Set up a backup target first. Backups can be turned on once Pagehall knows where to write them.",
          ["enabled"],
        );
      }
      const changes: Record<string, string | number | boolean | null> = {};
      const compare = (key: string, before: unknown, after: string | number | boolean | null) => {
        if (before !== after) changes[key] = after;
      };
      compare("enabled", current.settings.enabled, next.enabled);
      compare("dailyTime", current.settings.dailyTime, next.dailyTime);
      compare("weeklyDay", current.settings.weeklyDay, next.weeklyDay);
      compare("monthlyDay", current.settings.monthlyDay, next.monthlyDay);
      compare("scope", current.settings.scope, next.scope);
      compare("beforeUpdate", current.settings.beforeUpdate, next.beforeUpdate);
      compare("missingDays", current.settings.missingDays, next.missingDays);
      compare("autoTestRestore", current.settings.autoTestRestore, next.autoTestRestore);
      for (const key of ["daily", "weekly", "monthly", "beforeUpdate"] as const) {
        compare(`retention.${key}`, current.settings.retention[key], next.retention[key]);
      }
      if (Object.keys(changes).length === 0) return;
      const values = {
        enabled: next.enabled,
        dailyTime: next.dailyTime,
        weeklyDay: next.weeklyDay,
        monthlyDay: next.monthlyDay,
        keepDaily: next.retention.daily,
        keepWeekly: next.retention.weekly,
        keepMonthly: next.retention.monthly,
        keepBeforeUpdate: next.retention.beforeUpdate,
        scope: next.scope,
        beforeUpdate: next.beforeUpdate,
        missingDays: next.missingDays,
        autoTestRestore: next.autoTestRestore,
      };
      await tx
        .insert(backupConfiguration)
        .values({ singleton: true, ...values })
        .onConflictDoUpdate({ target: backupConfiguration.singleton, set: values });
      if ("enabled" in changes || "dailyTime" in changes) {
        const now = this.#clock();
        await this.#state(tx);
        await tx
          .update(backupState)
          .set({
            lastSlot: latestSlot(now, await this.#schedule(next, tx)),
            ...(next.enabled && !current.settings.enabled ? { enabledAt: now } : {}),
            ...(!next.enabled ? { alert: "none" as const, alertNotifiedAt: null } : {}),
          })
          .where(eq(backupState.singleton, true));
      }
      await this.#options.audit.record(tx, {
        name: "backup.settingsChanged",
        actor,
        targetId: null,
        fields: { changes },
      });
    });
    return this.overview();
  }

  #validateTarget(input: TargetInput): TargetSettings {
    if (input.kind === "local") {
      const candidate = input.path.trim();
      const problem = localPathProblem(candidate, [
        this.#options.paths.files,
        this.#options.paths.secrets,
        this.#options.paths.imports,
      ]);
      if (problem === "relative") {
        throw new BackupSettingsError(
          "invalidPath",
          "Enter an absolute path inside the container, for example /var/lib/pagehall/backups.",
          ["path"],
        );
      }
      if (problem === "reserved") {
        throw new BackupSettingsError(
          "reservedPath",
          "This path holds the file store, the secrets or the import folder, or is the root directory. Choose a directory of its own.",
          ["path"],
        );
      }
      return { kind: "local", path: candidate };
    }
    let endpoint: string | null = null;
    if (input.endpoint?.trim()) {
      let url: URL;
      try {
        url = parseOutboundUrl(input.endpoint.trim());
      } catch (error) {
        if (!(error instanceof OutboundError)) throw error;
        throw new BackupSettingsError(
          "invalidEndpoint",
          "Enter the endpoint as an https:// address without a user name.",
          ["endpoint"],
        );
      }
      if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
        throw new BackupSettingsError(
          "invalidEndpoint",
          "Enter only the address of the service, without a path, for example https://s3.example.org.",
          ["endpoint"],
        );
      }
      endpoint = url.origin;
    }
    const region = input.region.trim();
    if (!REGION.test(region)) {
      throw new BackupSettingsError("invalidRegion", "Enter the region, for example eu-central-1 or auto.", [
        "region",
      ]);
    }
    const bucket = input.bucket.trim();
    if (!BUCKET.test(bucket)) {
      throw new BackupSettingsError(
        "invalidBucket",
        "Enter the bucket name: 3 to 63 lowercase letters, digits, dots, hyphens or underscores.",
        ["bucket"],
      );
    }
    const prefix = input.prefix.trim();
    if (!PREFIX.test(prefix)) {
      throw new BackupSettingsError(
        "invalidPrefix",
        "Leave the prefix empty or end it with a slash, for example backups/.",
        ["prefix"],
      );
    }
    const accessKeyId = input.accessKeyId.trim();
    if (!ACCESS_KEY.test(accessKeyId)) {
      throw new BackupSettingsError("invalidAccessKey", "Enter the access key.", ["accessKeyId"]);
    }
    return {
      kind: "s3",
      endpoint,
      region,
      bucket,
      prefix,
      forcePathStyle: input.forcePathStyle,
      accessKeyId,
    };
  }

  #newSecret(input: TargetInput): string | undefined {
    if (input.kind !== "s3" || input.secretAccessKey === undefined) return undefined;
    const secret = input.secretAccessKey.trim();
    if (secret.length === 0 || secret.length > 512) {
      throw new BackupSettingsError("secretKeyRequired", "Enter the secret key.", ["secretAccessKey"]);
    }
    return secret;
  }

  async updateTarget(actor: Principal, input: TargetInput): Promise<BackupOverview> {
    const target = this.#validateTarget(input);
    const secret = this.#newSecret(input);
    await this.#database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('pagehall.backup-configuration'))`);
      if (target.kind === "s3" && secret === undefined && (await this.#secret(tx)) === null) {
        throw new BackupSettingsError("secretKeyRequired", "Enter the secret key.", ["secretAccessKey"]);
      }
      const values =
        target.kind === "local"
          ? {
              targetKind: "local" as const,
              targetPath: target.path,
              s3Endpoint: null,
              s3Region: null,
              s3Bucket: null,
              s3Prefix: "",
              s3ForcePathStyle: false,
              s3AccessKeyId: null,
            }
          : {
              targetKind: "s3" as const,
              targetPath: null,
              s3Endpoint: target.endpoint,
              s3Region: target.region,
              s3Bucket: target.bucket,
              s3Prefix: target.prefix,
              s3ForcePathStyle: target.forcePathStyle,
              s3AccessKeyId: target.accessKeyId,
            };
      await tx
        .insert(backupConfiguration)
        .values({ singleton: true, ...values })
        .onConflictDoUpdate({ target: backupConfiguration.singleton, set: values });
      if (target.kind === "local") {
        await tx.delete(instanceSecrets).where(eq(instanceSecrets.name, BACKUP_S3_SECRET));
      } else if (secret !== undefined) {
        const value = this.#options.encryption.encrypt(secret, backupS3SecretContext());
        await tx
          .insert(instanceSecrets)
          .values({ name: BACKUP_S3_SECRET, value })
          .onConflictDoUpdate({ target: instanceSecrets.name, set: { value, updatedAt: new Date() } });
      }
      await this.#options.audit.record(tx, {
        name: "backup.targetChanged",
        actor,
        targetId: null,
        fields:
          target.kind === "local"
            ? {
                kind: "local",
                location: target.path,
                endpointHost: null,
                accessKeyId: null,
                credentialsReplaced: false,
              }
            : {
                kind: "s3",
                location: `s3://${target.bucket}/${target.prefix}`,
                endpointHost: target.endpoint ? new URL(target.endpoint).host : null,
                accessKeyId: target.accessKeyId,
                credentialsReplaced: secret !== undefined,
              },
      });
    });
    return this.overview();
  }

  async testTarget(input: TargetInput): Promise<TargetTestResult> {
    const settings = this.#validateTarget(input);
    const secret = this.#newSecret(input) ?? (settings.kind === "s3" ? await this.#secret() : null);
    if (settings.kind === "s3" && !secret) {
      throw new BackupSettingsError("secretKeyRequired", "Enter the secret key.", ["secretAccessKey"]);
    }
    let target: BackupTarget;
    try {
      target = openTarget(settings, { secret, policy: this.#options.policy });
    } catch (error) {
      if (error instanceof BackupTargetError) {
        return { ok: false, failure: error.failure, step: error.step, message: error.message };
      }
      throw error;
    }
    try {
      await target.test();
      return { ok: true };
    } catch (error) {
      if (error instanceof BackupTargetError) {
        this.#logger.info({ failure: error.failure, step: error.step }, "Backup target test failed");
        return { ok: false, failure: error.failure, step: error.step, message: error.message };
      }
      throw error;
    } finally {
      closeTarget(target);
    }
  }

  async confirmKey(actor: Principal, confirmed: boolean): Promise<BackupOverview> {
    if (actor.type !== "account") throw new Error("Only an account confirms the backup key");
    await this.#database.transaction(async (tx) => {
      const values = confirmed
        ? { keyConfirmedAt: this.#clock(), keyConfirmedBy: actor.id }
        : { keyConfirmedAt: null, keyConfirmedBy: null };
      await tx
        .insert(backupConfiguration)
        .values({ singleton: true, ...values })
        .onConflictDoUpdate({ target: backupConfiguration.singleton, set: values });
      await this.#options.audit.record(tx, {
        name: "backup.keyConfirmed",
        actor,
        targetId: null,
        fields: { confirmed },
      });
    });
    return this.overview();
  }

  async #latestTests(names: readonly string[]): Promise<Map<string, TestRestoreView>> {
    if (names.length === 0) return new Map();
    const rows = await this.#database.execute<{
      id: string;
      backup_name: string;
      trigger: "manual" | "automatic";
      state: TestRow["state"];
      stage: TestRow["stage"];
      checks: TestRestoreCheck[];
      error: string | null;
      actor_id: string | null;
      actor_name: string | null;
      started_at: Date | string;
      finished_at: Date | string | null;
    }>(sql`
      select distinct on (t.backup_name) t.id, t.backup_name, t.trigger, t.state, t.stage, t.checks, t.error,
        t.actor_id, a.name as actor_name, t.started_at, t.finished_at
      from backup_test_restores t left join accounts a on a.id = t.actor_id
      where t.backup_name = any(${sql.param([...names])}::text[])
      order by t.backup_name, t.started_at desc, t.id desc`);
    return new Map(
      rows.rows.map((row) => [
        row.backup_name,
        {
          id: row.id,
          trigger: row.trigger,
          state: row.state,
          stage: row.stage,
          checks: row.checks,
          error: row.error,
          actor: row.actor_id && row.actor_name ? { id: row.actor_id, name: row.actor_name } : null,
          startedAt: new Date(row.started_at),
          finishedAt: row.finished_at ? new Date(row.finished_at) : null,
        },
      ]),
    );
  }

  async list(): Promise<BackupList> {
    const configuration = await this.configuration();
    let target: BackupTarget | null = null;
    try {
      target = await this.#target(configuration);
      if (!target) return { available: false, error: null, backups: [] };
      const listed = await listBackups(target);
      const tests = await this.#latestTests(listed.map((backup) => backup.name));
      return {
        available: true,
        error: null,
        backups: listed.map((backup) => ({
          name: backup.name,
          backupClass: backup.backupClass,
          createdAt: backup.header ? new Date(backup.header.createdAt) : backup.createdAt,
          sizeBytes: backup.sizeBytes,
          readable: backup.header !== null,
          pagehallVersion: backup.header?.pagehallVersion ?? null,
          schemaVersion: backup.header?.schemaVersion ?? null,
          scope: backup.header ? (backup.header.scope ?? "all") : null,
          testRestore: tests.get(backup.name) ?? null,
        })),
      };
    } catch (error) {
      this.#logger.warn({ err: error }, "Listing the backups failed");
      return { available: false, error: describeFailure(error), backups: [] };
    } finally {
      if (target) closeTarget(target);
    }
  }

  async #find(target: BackupTarget, name: string): Promise<ListedBackup> {
    if (!parseBackupName(name)) throw new BackupNotFoundError(name);
    const found = (await listBackups(target)).find((backup) => backup.name === name);
    if (!found?.header) throw new BackupNotFoundError(name);
    return found;
  }

  async #requireTarget(): Promise<BackupTarget> {
    const target = await this.#target(await this.configuration());
    if (!target) {
      throw new BackupSettingsError("noTarget", "Set up a backup target first.", ["target"]);
    }
    return target;
  }

  async deleteBackup(actor: Principal, name: string): Promise<void> {
    const target = await this.#requireTarget();
    try {
      const found = await this.#find(target, name);
      await target.delete(found.name);
      await this.#options.audit.recordAlone({
        name: "backup.deleted",
        actor,
        targetId: null,
        fields: { name: found.name, backupClass: found.backupClass, reason: "manual" },
      });
    } finally {
      closeTarget(target);
    }
  }

  async requestBackup(actor: Principal): Promise<void> {
    closeTarget(await this.#requireTarget());
    if (await isBackupRunning(this.#options.pool)) throw new BackupBusyError("backup");
    const jobs = this.#jobs();
    await this.#options.audit.recordAlone({
      name: "backup.requested",
      actor,
      targetId: null,
      fields: {},
    });
    await jobs.enqueue(backupRunJob, {
      trigger: "manual",
      slot: null,
      actorId: actor.type === "account" ? actor.id : null,
    });
  }

  #jobs(): JobQueue {
    if (!this.#options.jobs) throw new Error("Backups need the job queue");
    return this.#options.jobs;
  }

  async requestTestRestore(actor: Principal, name: string): Promise<string> {
    const target = await this.#requireTarget();
    try {
      await this.#find(target, name);
    } finally {
      closeTarget(target);
    }
    if (await isTestRestoreRunning(this.#options.pool)) throw new BackupBusyError("testRestore");
    return this.#startTestRestore(actor, name, "manual");
  }

  async #startTestRestore(actor: Principal, name: string, trigger: "manual" | "automatic"): Promise<string> {
    const jobs = this.#jobs();
    const id = uuidv7();
    await this.#database.transaction(async (tx) => {
      const running = await tx
        .select({ id: backupTestRestores.id })
        .from(backupTestRestores)
        .where(eq(backupTestRestores.state, "running"))
        .limit(1);
      if (running.length > 0 && (await isTestRestoreRunning(this.#options.pool))) {
        throw new BackupBusyError("testRestore");
      }
      await tx.insert(backupTestRestores).values({
        id,
        backupName: name,
        trigger,
        state: "running",
        stage: "verify",
        actorId: actor.type === "account" ? actor.id : null,
        startedAt: this.#clock(),
      });
      await this.#options.audit.record(tx, {
        name: "backup.testRestoreStarted",
        actor,
        targetId: null,
        fields: { name, trigger },
      });
    });
    await jobs.enqueue(backupTestRestoreJob, { testId: id });
    return id;
  }

  async testRestore(id: string): Promise<TestRestoreView | null> {
    const views = await this.#database
      .select({ name: backupTestRestores.backupName })
      .from(backupTestRestores)
      .where(eq(backupTestRestores.id, id));
    const name = views[0]?.name;
    if (!name) return null;
    const latest = await this.#latestTests([name]);
    const view = latest.get(name);
    return view?.id === id ? view : null;
  }

  async #recordRun(values: Partial<typeof backupRuns.$inferInsert> & { id: string }): Promise<void> {
    await this.#database.update(backupRuns).set(values).where(eq(backupRuns.id, values.id));
  }

  async #markInterrupted(): Promise<void> {
    if (await isBackupRunning(this.#options.pool)) return;
    await this.#database
      .update(backupRuns)
      .set({
        state: "failed",
        error: "The backup was interrupted, for example by a restart of the worker.",
        finishedAt: this.#clock(),
      })
      .where(eq(backupRuns.state, "running"));
    if (!(await isTestRestoreRunning(this.#options.pool))) {
      await this.#database
        .update(backupTestRestores)
        .set({
          state: "failed",
          error: "The test restore was interrupted, for example by a restart of the worker.",
          finishedAt: this.#clock(),
        })
        .where(eq(backupTestRestores.state, "running"));
    }
  }

  async #estimate(): Promise<number> {
    const [previous] = await this.#database
      .select({ size: backupRuns.sizeBytes })
      .from(backupRuns)
      .where(and(eq(backupRuns.state, "succeeded"), inArray(backupRuns.trigger, ["scheduled", "manual"])))
      .orderBy(desc(backupRuns.finishedAt))
      .limit(1);
    if (previous?.size) return previous.size;
    const result = await this.#database.execute<{ size: string }>(
      sql`select pg_database_size(current_database()) as size`,
    );
    return Number(result.rows[0]?.size ?? 0);
  }

  async #checkFreeSpace(target: BackupTarget): Promise<void> {
    const capacity = await target.capacity();
    if (!capacity || capacity.total <= 0) return;
    const estimate = await this.#estimate();
    const used = capacity.total - capacity.free;
    const projected = ((used + estimate) / capacity.total) * 100;
    const critical = await this.#options.criticalPercent();
    if (projected >= critical) {
      throw new BackupError(
        `Not enough free space in the backup target: the backup needs about ${formatGb(estimate)}, ${formatGb(capacity.free)} are free, and the disk must stay below ${critical} %. Free up space, lower the number of kept backups or choose another target.`,
      );
    }
  }

  async run(payload: {
    trigger: "scheduled" | "manual";
    slot: string | null;
    actorId: string | null;
  }): Promise<void> {
    const configuration = await this.configuration();
    if (payload.trigger === "scheduled" && (!configuration.settings.enabled || !configuration.target)) return;
    const actor: Principal = payload.actorId ? { type: "account", id: payload.actorId } : SYSTEM;
    const backupClass: BackupClass =
      payload.trigger === "scheduled" && payload.slot
        ? classOfSlot(new Date(payload.slot), await this.#schedule(configuration.settings))
        : "manual";
    const id = uuidv7();
    const lock = await tryBackupLock(this.#options.pool);
    if (!lock) {
      await this.#database.insert(backupRuns).values({
        id,
        trigger: payload.trigger,
        backupClass,
        state: "skipped",
        error: "Skipped because another backup was still running.",
        actorId: payload.actorId,
        startedAt: this.#clock(),
        finishedAt: this.#clock(),
      });
      this.#logger.info({ trigger: payload.trigger }, "Backup skipped because another backup is running");
      return;
    }
    let target: BackupTarget | null = null;
    try {
      await this.#database
        .update(backupRuns)
        .set({
          state: "failed",
          error: "The backup was interrupted, for example by a restart of the worker.",
          finishedAt: this.#clock(),
        })
        .where(eq(backupRuns.state, "running"));
      await this.#database.insert(backupRuns).values({
        id,
        trigger: payload.trigger,
        backupClass,
        state: "running",
        actorId: payload.actorId,
        startedAt: this.#clock(),
      });
      try {
        target = await this.#target(configuration);
        if (!target) throw new BackupSettingsError("noTarget", "No backup target is set up.", ["target"]);
        await this.#checkFreeSpace(target);
        const written = await writeBackup(
          { ...this.#options.sources, logger: this.#logger },
          { target, backupClass, scope: configuration.settings.scope, now: this.#clock() },
        );
        await this.#recordRun({
          id,
          state: "succeeded",
          name: written.name,
          target: target.description,
          sizeBytes: written.sizeBytes,
          finishedAt: this.#clock(),
        });
        await this.#options.audit.recordAlone({
          name: "backup.created",
          actor,
          targetId: null,
          fields: {
            name: written.name,
            backupClass,
            trigger: payload.trigger,
            location: written.location,
            sizeBytes: written.sizeBytes,
          },
        });
        const deleted = await applyRetention(target, configuration.settings.retention, {
          classes: ["daily", "weekly", "monthly"],
          logger: this.#logger,
        });
        await this.#auditExpired(deleted);
        await this.#succeeded();
        if (payload.trigger === "scheduled" && configuration.settings.autoTestRestore) {
          await this.#automaticTestRestore(written.name);
        }
      } catch (error) {
        const reason = describeFailure(error);
        this.#logger.warn({ err: error, trigger: payload.trigger }, "Backup failed");
        await this.#recordRun({ id, state: "failed", error: reason, finishedAt: this.#clock() });
        await this.#options.audit.recordAlone({
          name: "backup.failed",
          actor,
          targetId: null,
          fields: { backupClass, trigger: payload.trigger, reason },
        });
        await this.#failed(reason);
      }
    } finally {
      if (target) closeTarget(target);
      await lock.release();
    }
  }

  async #auditExpired(names: readonly string[]): Promise<void> {
    for (const name of names) {
      await this.#options.audit.recordAlone({
        name: "backup.deleted",
        actor: SYSTEM,
        targetId: null,
        fields: { name, backupClass: parseBackupName(name)?.backupClass ?? "daily", reason: "retention" },
      });
    }
  }

  async #automaticTestRestore(name: string): Promise<void> {
    const now = this.#clock();
    const monthAgo = new Date(now);
    monthAgo.setUTCMonth(monthAgo.getUTCMonth() - 1);
    await this.#state();
    const claimed = await this.#database.execute<{ singleton: boolean }>(sql`
      update backup_state set last_automatic_test_at = ${now}, updated_at = now()
      where singleton and (last_automatic_test_at is null or last_automatic_test_at <= ${monthAgo})
      returning singleton`);
    if (claimed.rows.length === 0) return;
    try {
      await this.#startTestRestore(SYSTEM, name, "automatic");
    } catch (error) {
      this.#logger.warn({ err: error }, "Starting the monthly test restore failed");
    }
  }

  async runTestRestore(payload: { testId: string }): Promise<void> {
    const [row] = await this.#database
      .select()
      .from(backupTestRestores)
      .where(eq(backupTestRestores.id, payload.testId));
    if (row?.state !== "running") return;
    const actor: Principal = row.actorId ? { type: "account", id: row.actorId } : SYSTEM;
    const lock = await tryTestRestoreLock(this.#options.pool);
    if (!lock) {
      await this.#database
        .update(backupTestRestores)
        .set({
          state: "failed",
          error: new BackupBusyError("testRestore").message,
          finishedAt: this.#clock(),
        })
        .where(eq(backupTestRestores.id, row.id));
      return;
    }
    let target: BackupTarget | null = null;
    let outcome: Awaited<ReturnType<typeof runTestRestore>>;
    try {
      target = await this.#requireTarget();
      outcome = await runTestRestore(
        target,
        row.backupName,
        { ...this.#options.testRestore, pool: this.#options.pool, logger: this.#logger },
        async (stage, checks) => {
          await this.#database
            .update(backupTestRestores)
            .set({ stage, checks })
            .where(eq(backupTestRestores.id, row.id));
        },
      );
    } catch (error) {
      outcome = { state: "failed", stage: "verify", checks: [], error: describeFailure(error) };
    } finally {
      if (target) closeTarget(target);
      await lock.release();
    }
    await this.#database
      .update(backupTestRestores)
      .set({
        state: outcome.state,
        stage: outcome.stage,
        checks: outcome.checks,
        error: outcome.error,
        finishedAt: this.#clock(),
      })
      .where(eq(backupTestRestores.id, row.id));
    await this.#options.audit.recordAlone({
      name: "backup.testRestoreFinished",
      actor,
      targetId: null,
      fields: { name: row.backupName, trigger: row.trigger, state: outcome.state, stage: outcome.stage },
    });
    if (outcome.state === "failed") {
      await this.#announce({
        type: "backup.testRestoreFailed",
        backupName: row.backupName,
        reason: outcome.error ?? "A check failed",
      });
    }
  }

  async #succeeded(): Promise<void> {
    const previous = await this.#database.execute<{ alert: BackupAlert }>(sql`
      update backup_state s set alert = 'none', alert_notified_at = null, updated_at = now()
      from (select alert from backup_state where singleton for update) old
      where s.singleton and old.alert <> 'none' returning old.alert`);
    if (previous.rows.length > 0) await this.#announce({ type: "backup.recovered" });
  }

  async #failed(reason: string): Promise<void> {
    await this.#state();
    const changed = await this.#database.execute<{ singleton: boolean }>(sql`
      update backup_state set alert = 'failing', alert_notified_at = ${this.#clock()}, updated_at = now()
      where singleton and alert <> 'failing' returning singleton`);
    if (changed.rows.length > 0) await this.#announce({ type: "backup.failed", reason, reminder: false });
  }

  async check(): Promise<void> {
    await this.#markInterrupted();
    const configuration = await this.configuration();
    const now = this.#clock();
    if (!configuration.settings.enabled || !configuration.target) {
      await this.#database
        .update(backupState)
        .set({ alert: "none", alertNotifiedAt: null })
        .where(and(eq(backupState.singleton, true), sql`${backupState.alert} <> 'none'`));
      return;
    }
    const schedule = await this.#schedule(configuration.settings);
    const slot = latestSlot(now, schedule);
    await this.#state();
    const claimed = await this.#database.execute<{ singleton: boolean }>(sql`
      update backup_state set last_slot = ${slot}, updated_at = now()
      where singleton and (last_slot is null or last_slot < ${slot}) returning singleton`);
    if (claimed.rows.length > 0 && this.#options.jobs) {
      await this.#options.jobs.enqueue(
        backupRunJob,
        { trigger: "scheduled", slot: slot.toISOString(), actorId: null },
        { idempotencyKey: `backup-slot:${slot.toISOString()}` },
      );
    }
    await this.#checkMissing(configuration, now);
  }

  async #checkMissing(configuration: BackupConfiguration, now: Date): Promise<void> {
    const state = await this.#state();
    const lastSuccess = await this.#lastRun("succeeded");
    const successAt = lastSuccess?.finishedAt ?? null;
    const since = [successAt, state.enabledAt].filter((value): value is Date => value !== null);
    const reference = since.length > 0 ? new Date(Math.max(...since.map((value) => value.getTime()))) : null;
    const days = configuration.settings.missingDays;
    const overdue = reference !== null && now.getTime() - reference.getTime() >= days * DAY_MS;
    if (state.alert === "none") {
      if (!overdue) return;
      const changed = await this.#database.execute<{ singleton: boolean }>(sql`
        update backup_state set alert = 'missing', alert_notified_at = ${now}, updated_at = now()
        where singleton and alert = 'none' returning singleton`);
      if (changed.rows.length > 0) {
        await this.#announce({ type: "backup.missing", days, lastSuccessAt: successAt, reminder: false });
      }
      return;
    }
    const reminder = await this.#options.settings.get(storageReminderSetting, {});
    if (!state.alertNotifiedAt || !reminderDue(reminder, state.alertNotifiedAt, now)) return;
    const claimed = await this.#database.execute<{ singleton: boolean }>(sql`
      update backup_state set alert_notified_at = ${now}, updated_at = now()
      where singleton and alert_notified_at = ${state.alertNotifiedAt} returning singleton`);
    if (claimed.rows.length === 0) return;
    if (state.alert === "failing") {
      const lastFailure = await this.#lastRun("failed");
      await this.#announce({
        type: "backup.failed",
        reason: lastFailure?.error ?? "The last backup failed.",
        reminder: true,
      });
    } else {
      await this.#announce({ type: "backup.missing", days, lastSuccessAt: successAt, reminder: true });
    }
  }

  async #link(executor: Executor): Promise<string | null> {
    const base = await this.#options.settings.get(instanceUrlSetting, {}, { executor });
    return base ? `${base.replace(/\/+$/, "")}${BACKUP_SETTINGS_PATH}` : null;
  }

  #content(
    language: Language,
    instanceName: string,
    announcement: Announcement,
    link: string | null,
  ): Content {
    switch (announcement.type) {
      case "backup.failed":
        return backupFailed(language, {
          instanceName,
          reason: announcement.reason ?? "",
          reminder: announcement.reminder ?? false,
          link,
        });
      case "backup.missing":
        return backupMissing(language, {
          instanceName,
          days: announcement.days ?? 0,
          lastSuccess: announcement.lastSuccessAt
            ? announcement.lastSuccessAt.toISOString().slice(0, 10)
            : null,
          reminder: announcement.reminder ?? false,
          link,
        });
      case "backup.recovered":
        return backupRecovered(language, { instanceName, link });
      case "backup.testRestoreFailed":
        return backupTestRestoreFailed(language, {
          instanceName,
          backupName: announcement.backupName ?? "",
          reason: announcement.reason ?? "",
          link,
        });
    }
  }

  async #announce(announcement: Announcement): Promise<void> {
    const mailIds: string[] = [];
    await this.#database.transaction(async (tx) => {
      const link = await this.#link(tx);
      const recipients = await instanceAdministratorIds(tx);
      const params = this.#params(announcement, link);
      const result = await this.#options.notifications.notify(tx, {
        type: announcement.type,
        recipients,
        organizationId: null,
        targetId: uuidv7(),
        params,
      } as Parameters<NotificationService["notify"]>[1]);
      mailIds.push(...result.mailIds);
      const language = await this.#options.settings.get(languageSetting, {}, { executor: tx });
      const addresses = await this.#options.settings.get(
        storageOperationsEmailsSetting,
        {},
        { executor: tx },
      );
      for (const address of addresses) {
        mailIds.push(await this.#queueOperationsMail(tx, address, language, announcement, link));
      }
      const instanceName = await this.#options.settings.get(instanceNameSetting, {}, { executor: tx });
      const content = this.#content(language, instanceName, announcement, link);
      await this.#options.chat.queueStorageMessage(tx, {
        event: "backup",
        heading: instanceName,
        title: content.subject,
        detail: content.paragraphs.join("\n"),
        link: content.action ? { url: content.action.url, label: content.action.label } : null,
        occurredAt: this.#clock(),
        space: null,
        organizationId: null,
        item: null,
        actor: null,
      });
    });
    await this.#options.notifications.dispatch(mailIds);
  }

  #params(announcement: Announcement, link: string | null): Record<string, unknown> {
    switch (announcement.type) {
      case "backup.failed":
        return { reason: announcement.reason ?? "", reminder: announcement.reminder ?? false, link };
      case "backup.missing":
        return {
          days: announcement.days ?? 0,
          lastSuccessAt: announcement.lastSuccessAt?.toISOString() ?? null,
          reminder: announcement.reminder ?? false,
          link,
        };
      case "backup.recovered":
        return { link };
      case "backup.testRestoreFailed":
        return { backupName: announcement.backupName ?? "", reason: announcement.reason ?? "", link };
    }
  }

  async #queueOperationsMail(
    tx: Transaction,
    to: string,
    language: Language,
    announcement: Announcement,
    link: string | null,
  ): Promise<string> {
    const mail = this.#options.mail;
    switch (announcement.type) {
      case "backup.failed":
        return mail.queue(tx, {
          to,
          template: "backupFailed",
          language,
          operations: true,
          params: { reason: announcement.reason ?? "", reminder: announcement.reminder ?? false, link },
        });
      case "backup.missing":
        return mail.queue(tx, {
          to,
          template: "backupMissing",
          language,
          operations: true,
          params: {
            days: announcement.days ?? 0,
            lastSuccess: announcement.lastSuccessAt
              ? announcement.lastSuccessAt.toISOString().slice(0, 10)
              : null,
            reminder: announcement.reminder ?? false,
            link,
          },
        });
      case "backup.recovered":
        return mail.queue(tx, {
          to,
          template: "backupRecovered",
          language,
          operations: true,
          params: { link },
        });
      case "backup.testRestoreFailed":
        return mail.queue(tx, {
          to,
          template: "backupTestRestoreFailed",
          language,
          operations: true,
          params: { backupName: announcement.backupName ?? "", reason: announcement.reason ?? "", link },
        });
    }
  }
}

function formatGb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
