import { sql } from "drizzle-orm";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import type { KeyRingHolder } from "../crypto/key-ring-holder.js";
import type { KeyRotation } from "../crypto/rotation.js";
import type { Database } from "../database/database.js";
import type { DatabasePool } from "../database/pool.js";
import type { JobQueue, QueueCounts } from "../jobs/job-queue.js";
import type { MailService } from "../mail/mail-service.js";
import type { SearchIndexer } from "../search/indexer.js";
import type { SettingsService } from "../settings/service.js";
import { checkDatabaseAndClock, checkFileStorage } from "../setup/steps.js";
import type { StorageService } from "../storage/storage.js";
import type { BackupStatus } from "../backup/service.js";
import type { BackupStatusSource } from "./backup-status.js";
import { type RecentErrorType, recentErrorTypes } from "./error-events.js";
import type { MaintenanceService } from "./maintenance.js";
import type { UpdateCheckService } from "./update-check.js";
import { pagehallVersion } from "./version.js";

export type StatusLevel = "ok" | "warning" | "error";

export const statusItemIds = [
  "version",
  "maintenance",
  "database",
  "storage",
  "jobs",
  "collaboration",
  "backups",
  "searchIndex",
  "recentErrors",
  "tls",
  "email",
  "encryption",
  "clock",
  "fileStorage",
] as const;

export type StatusItemId = (typeof statusItemIds)[number];
export type StatusFact = string | number | boolean | null;

export interface StatusItem {
  id: StatusItemId;
  status: StatusLevel;
  reason: string | null;
  facts: Record<string, StatusFact>;
  page: string | null;
  docs: string;
}

export interface QueueStatus extends QueueCounts {
  queue: string;
}

export interface OperationsStatus {
  checkedAt: Date;
  status: StatusLevel;
  items: StatusItem[];
  queues: QueueStatus[];
  recentErrors: RecentErrorType[];
}

export type CollaborationProbe = () => Promise<boolean>;

export const RECENT_ERRORS_HOURS = 24;
export const RECENT_ERRORS_LIMIT = 50;
export const QUEUE_BACKLOG_WARNING = 1000;
const HOUR_MS = 60 * 60 * 1000;
const INSTANCE_PAGE = "/settings/instance";

function item(
  id: StatusItemId,
  status: StatusLevel,
  reason: string | null,
  facts: Record<string, StatusFact>,
  links: { page?: string; docs: string },
): StatusItem {
  return { id, status, reason, facts, page: links.page ?? null, docs: links.docs };
}

function worst(levels: readonly StatusLevel[]): StatusLevel {
  if (levels.includes("error")) return "error";
  return levels.includes("warning") ? "warning" : "ok";
}

export function backupItem(backup: BackupStatus): StatusItem {
  const links = { page: `${INSTANCE_PAGE}/backups`, docs: "backup.md" };
  const facts = {
    enabled: backup.enabled,
    targetConfigured: backup.targetConfigured,
    running: backup.running,
    beforeUpdate: backup.beforeUpdate.enabled,
    lastSuccessAt: backup.lastSuccess?.at.toISOString() ?? null,
    lastFailureAt: backup.lastFailure?.at.toISOString() ?? null,
    lastFailureReason: backup.lastFailure?.reason ?? null,
    nextRunAt: backup.nextRunAt?.toISOString() ?? null,
  };
  if (!backup.targetConfigured) return item("backups", "warning", "noTarget", facts, links);
  if (!backup.enabled) return item("backups", "warning", "off", facts, links);
  if (backup.alert === "failing") return item("backups", "error", "failed", facts, links);
  if (backup.alert === "missing") return item("backups", "warning", "noRecentBackup", facts, links);
  return item("backups", "ok", backup.beforeUpdate.enabled ? null : "beforeUpdateOff", facts, links);
}

export function jobsItem(queues: readonly QueueStatus[]): StatusItem {
  const failed = queues.reduce((sum, queue) => sum + queue.failed, 0);
  const queued = queues.reduce((sum, queue) => sum + queue.queued, 0);
  const facts = { failed, queued, active: queues.reduce((sum, queue) => sum + queue.active, 0) };
  const links = { docs: "operations.md#jobs" };
  if (failed > 0) return item("jobs", "warning", "failedJobs", facts, links);
  if (queued >= QUEUE_BACKLOG_WARNING) return item("jobs", "warning", "backlog", facts, links);
  return item("jobs", "ok", null, facts, links);
}

export class OperationsStatusService {
  readonly #database: Database;
  readonly #pool: DatabasePool;
  readonly #settings: SettingsService;
  readonly #storage: StorageService;
  readonly #mail: MailService;
  readonly #indexer: SearchIndexer;
  readonly #keyRing: KeyRingHolder;
  readonly #keyRotation: KeyRotation | undefined;
  readonly #jobs: JobQueue | undefined;
  readonly #backups: BackupStatusSource;
  readonly #maintenance: MaintenanceService;
  readonly #updates: UpdateCheckService | undefined;
  readonly #collaboration: CollaborationProbe | undefined;
  readonly #filesDir: string;
  readonly #fileStore: "local" | "s3";
  readonly #keyProvider: "env" | "file";
  readonly #configuredInstanceUrl: string | undefined;
  readonly #now: () => Date;
  readonly #version: string;

  constructor(options: {
    database: Database;
    pool: DatabasePool;
    settings: SettingsService;
    storage: StorageService;
    mail: MailService;
    indexer: SearchIndexer;
    keyRing: KeyRingHolder;
    keyRotation?: KeyRotation | undefined;
    jobs: JobQueue | undefined;
    backups: BackupStatusSource;
    maintenance: MaintenanceService;
    updates?: UpdateCheckService | undefined;
    collaboration?: CollaborationProbe | undefined;
    filesDir: string;
    fileStore: "local" | "s3";
    keyProvider: "env" | "file";
    configuredInstanceUrl?: string | undefined;
    version?: string;
    now?: () => Date;
  }) {
    this.#database = options.database;
    this.#pool = options.pool;
    this.#settings = options.settings;
    this.#storage = options.storage;
    this.#mail = options.mail;
    this.#indexer = options.indexer;
    this.#keyRing = options.keyRing;
    this.#keyRotation = options.keyRotation;
    this.#jobs = options.jobs;
    this.#backups = options.backups;
    this.#maintenance = options.maintenance;
    this.#updates = options.updates;
    this.#collaboration = options.collaboration;
    this.#filesDir = options.filesDir;
    this.#fileStore = options.fileStore;
    this.#keyProvider = options.keyProvider;
    this.#configuredInstanceUrl = options.configuredInstanceUrl;
    this.#now = options.now ?? (() => new Date());
    this.#version = options.version ?? pagehallVersion();
  }

  get database(): Database {
    return this.#database;
  }

  backups(): Promise<BackupStatus> {
    return this.#backups.status();
  }

  async queues(): Promise<QueueStatus[]> {
    if (!this.#jobs) return [];
    const counts = await this.#jobs.counts();
    return Object.entries(counts)
      .map(([queue, value]) => ({ queue, ...value }))
      .sort((left, right) => left.queue.localeCompare(right.queue));
  }

  async status(): Promise<OperationsStatus> {
    const now = this.#now();
    const [databaseAndClock, queues, recentErrors] = await Promise.all([
      checkDatabaseAndClock(this.#pool),
      this.queues().catch(() => null),
      recentErrorTypes(this.#database, {
        since: new Date(now.getTime() - RECENT_ERRORS_HOURS * HOUR_MS),
        limit: RECENT_ERRORS_LIMIT,
      }),
    ]);
    const [database, clock] = databaseAndClock;
    const items: StatusItem[] = [
      await this.#versionItem(),
      await this.#maintenanceItem(),
      await this.#databaseItem(database),
      await this.#storageItem(),
      queues ? jobsItem(queues) : item("jobs", "error", "unreachable", {}, { docs: "operations.md#jobs" }),
      await this.#collaborationItem(),
      backupItem(await this.#backups.status()),
      await this.#searchItem(),
      this.#errorsItem(recentErrors),
      await this.#tlsItem(),
      await this.#emailItem(),
      await this.#encryptionItem(),
      item(
        "clock",
        clock.status,
        clock.cause,
        { offsetMs: numberOrNull(clock.offsetMs) },
        { docs: "setup.md#clock" },
      ),
    ];
    if (this.#fileStore === "local") items.push(await this.#fileStorageItem());
    return {
      checkedAt: now,
      status: worst(items.map((entry) => entry.status)),
      items,
      queues: (queues ?? []).filter(
        (queue) => queue.queued + queue.active + queue.deferred + queue.failed > 0,
      ),
      recentErrors,
    };
  }

  async databaseSizeBytes(): Promise<number> {
    const result = await this.#database.execute<{ size: string | number }>(
      sql`select pg_database_size(current_database()) as size`,
    );
    return Number(result.rows[0]?.size ?? 0);
  }

  async #databaseItem(check: { status: StatusLevel; cause: string | null } & Record<string, unknown>) {
    const facts: Record<string, StatusFact> = {
      version: typeof check.version === "string" ? check.version : null,
      sizeBytes:
        check.status === "error" && check.cause === "unreachable" ? null : await this.databaseSizeBytes(),
    };
    return item("database", check.status, check.cause, facts, { docs: "setup.md#database" });
  }

  async #versionItem(): Promise<StatusItem> {
    const version = this.#version;
    const links = { page: `${INSTANCE_PAGE}/updates`, docs: "operations.md#updates" };
    const updates = await this.#updates?.status();
    if (!updates?.enabled) return item("version", "ok", updates ? "checkOff" : null, { version }, links);
    const facts = {
      version,
      latest: updates.latest,
      checkedAt: updates.checkedAt?.toISOString() ?? null,
      failure: updates.failure,
    };
    if (updates.runningIsRelease && updates.latest)
      return item("version", "warning", "updateAvailable", facts, links);
    if (updates.checkedAt && !updates.succeeded) return item("version", "ok", "checkFailed", facts, links);
    return item("version", "ok", null, facts, links);
  }

  async #maintenanceItem(): Promise<StatusItem> {
    const status = await this.#maintenance.status();
    const links = { page: `${INSTANCE_PAGE}/maintenance`, docs: "operations.md#maintenance-mode" };
    if (!status.enabled) return item("maintenance", "ok", null, {}, links);
    return item(
      "maintenance",
      "warning",
      status.blockSignIn ? "onSignInPaused" : "on",
      { startedAt: status.startedAt?.toISOString() ?? null },
      links,
    );
  }

  async #storageItem(): Promise<StatusItem> {
    const status = await this.#storage.status();
    const facts = {
      store: status.store,
      usedBytes: status.usedBytes,
      totalBytes: status.totalBytes,
      percent: status.percent,
      level: status.level,
    };
    const links = { page: `${INSTANCE_PAGE}/storage`, docs: "storage.md" };
    if (!status.measured) return item("storage", "ok", status.inactiveReason, facts, links);
    if (status.level === 3) return item("storage", "error", "critical", facts, links);
    if (status.level === 2) return item("storage", "warning", "largeWritesPaused", facts, links);
    if (status.level === 1) return item("storage", "warning", "warning", facts, links);
    return item("storage", "ok", null, facts, links);
  }

  async #collaborationItem(): Promise<StatusItem> {
    const links = { docs: "operations.md#collaboration" };
    if (!this.#collaboration) return item("collaboration", "ok", "notChecked", {}, links);
    const ready = await this.#collaboration().catch(() => false);
    return ready
      ? item("collaboration", "ok", null, {}, links)
      : item("collaboration", "error", "unavailable", {}, links);
  }

  async #searchItem(): Promise<StatusItem> {
    const state = await this.#indexer.state();
    const failing = await this.#database.execute<{ count: string | number }>(
      sql`select count(*) as count from search_pending_items where attempts > 0`,
    );
    const failingItems = Number(failing.rows[0]?.count ?? 0);
    const facts = {
      building: state.building,
      done: state.done,
      total: state.total,
      pendingItems: state.pendingItems,
      failingItems,
    };
    const links = { docs: "operations.md#search-index" };
    if (state.building) return item("searchIndex", "warning", "building", facts, links);
    if (failingItems > 0) return item("searchIndex", "warning", "failingItems", facts, links);
    return item("searchIndex", "ok", null, facts, links);
  }

  #errorsItem(recent: readonly RecentErrorType[]): StatusItem {
    const count = recent.reduce((sum, entry) => sum + entry.count, 0);
    const facts = { count, types: recent.length, hours: RECENT_ERRORS_HOURS };
    const links = { docs: "operations.md#recent-errors" };
    return count > 0
      ? item("recentErrors", "warning", "errorsLogged", facts, links)
      : item("recentErrors", "ok", null, facts, links);
  }

  async #tlsItem(): Promise<StatusItem> {
    const stored = await this.#settings.get(instanceUrlSetting, {});
    const url = stored || this.#configuredInstanceUrl || "";
    const links = { page: `${INSTANCE_PAGE}/general`, docs: "reverse-proxy.md" };
    if (!url) return item("tls", "warning", "instanceUrlNotSet", { url: null }, links);
    return url.startsWith("https:")
      ? item("tls", "ok", null, { url }, links)
      : item("tls", "warning", "instanceUrlNotHttps", { url }, links);
  }

  async #emailItem(): Promise<StatusItem> {
    const method = await this.#mail.configuredMethod();
    const delivery = await this.#mail.deliveryState();
    const facts = {
      method,
      lastSuccessAt: delivery.lastSuccessAt?.toISOString() ?? null,
      lastFailureAt: delivery.lastFailure?.at.toISOString() ?? null,
      lastFailureCode: delivery.lastFailure?.code ?? null,
    };
    const links = { page: `${INSTANCE_PAGE}/mail`, docs: "email.md" };
    if (!method) return item("email", "warning", "notConfigured", facts, links);
    const failure = delivery.lastFailure;
    if (failure && (!delivery.lastSuccessAt || failure.at > delivery.lastSuccessAt)) {
      return item("email", "error", "deliveryFailing", facts, links);
    }
    return item("email", "ok", null, facts, links);
  }

  async #encryptionItem(): Promise<StatusItem> {
    const links = { docs: "encryption.md" };
    if (!this.#keyRing.loaded) return item("encryption", "error", "masterKeyMissing", {}, links);
    const rotation = this.#keyRotation ? await this.#keyRotation.status() : null;
    const facts = {
      provider: this.#keyProvider,
      currentVersion: this.#keyRing.ring.currentVersion,
      rotationRunning: rotation?.latest?.status === "running",
    };
    if (this.#keyProvider === "file" && !(await this.#keysBackedUp())) {
      return item("encryption", "warning", "keysNotBackedUp", facts, links);
    }
    return item("encryption", "ok", facts.rotationRunning ? "rotationRunning" : null, facts, links);
  }

  async #keysBackedUp(): Promise<boolean> {
    const result = await this.#database.execute<{ confirmed: boolean }>(sql`
      select exists (select 1 from setup_steps where step = 'keyBackup' and completed_at is not null)
        or exists (select 1 from instance where setup_completed_through = 'configuration') as confirmed
    `);
    return result.rows[0]?.confirmed ?? false;
  }

  async #fileStorageItem(): Promise<StatusItem> {
    const check = await checkFileStorage(this.#filesDir);
    return item(
      "fileStorage",
      check.status,
      check.cause,
      {
        path: this.#filesDir,
        freeBytes: numberOrNull(check.freeBytes),
        fixCommand: check.fixCommand,
      },
      { docs: check.docs },
    );
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}
