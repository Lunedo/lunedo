import { randomBytes } from "node:crypto";
import { availableParallelism } from "node:os";
import type { HealthCheck } from "@lunedo/shared";
import { AuditLog, auditSettingChanges } from "../audit/audit-log.js";
import { backupBeforeMigrations, consumeSkipMarker } from "../backup/before-update.js";
import { PostgresArchiver } from "../backup/postgres.js";
import { checkRestoreComplete } from "../backup/restore-marker.js";
import { pauseBackupsAfterRestore } from "../backup/restored.js";
import { removeStaleStaging } from "../backup/runner.js";
import { startChatDelivery } from "../chat/jobs.js";
import { startBlogAnnouncements } from "../collaboration/jobs.js";
import { configurationForBackup } from "../config/backup-view.js";
import { ensureSecretFile, generateToken } from "../config/generated-secrets.js";
import { type Env, loadConfig, type ServerConfig } from "../config/load.js";
import { Secret } from "../config/secret.js";
import { type EncryptedColumn, encryptedColumns } from "../crypto/encrypted-column.js";
import type { EncryptedStreamOwner } from "../crypto/encrypted-stream.js";
import { Encryption } from "../crypto/envelope.js";
import { createKeyProvider } from "../crypto/key-provider.js";
import { formatKeyEntry, KEY_LENGTH, type KeyRing, KeyRingError, parseKeyRing } from "../crypto/key-ring.js";
import { KeyRingHolder } from "../crypto/key-ring-holder.js";
import { loadMasterKeyRing } from "../crypto/key-usage.js";
import { KeyRotation, rotateDataKeysJob } from "../crypto/rotation.js";
import { masterStreamKeys, type StreamKeys } from "../crypto/stream.js";
import { createDatabase, type Database } from "../database/database.js";
import { currentSchemaVersion, knownSchemaVersions, runMigrations } from "../database/migrate.js";
import { NotificationListener } from "../database/notifications.js";
import { createDatabasePool, type DatabasePool } from "../database/pool.js";
import { displayVersionJob, startDisplayVersions } from "../files/jobs.js";
import { encryptedStreamOwnersOf, fileStoreOf } from "../files/owners.js";
import { readinessChecks } from "../health/readiness.js";
import type { JobQueue } from "../jobs/job-queue.js";
import { PgBossQueue } from "../jobs/pg-boss-queue.js";
import {
  CLEANUP_JOB_PROGRESS_SCHEDULE,
  cleanupJobProgress,
  cleanupJobProgressJob,
} from "../jobs/progress-cleanup.js";
import { startRemovedArticlePruning, startReviewReminders } from "../knowledge-bases/jobs.js";
import { createLogger, type Logger } from "../logging/logger.js";
import type { MailTransport, SmtpOptions } from "../mail/transport.js";
import { NotificationHub } from "../notifications/hub.js";
import { Metrics } from "../observability/metrics.js";
import { ErrorEvents } from "../operations/error-events.js";
import { instanceMetricsSource } from "../operations/instance-metrics.js";
import { startUpdateChecks } from "../operations/jobs.js";
import type { CollaborationProbe } from "../operations/status.js";
import { outboundPolicy } from "../outbound/guarded-request.js";
import { startPushDelivery } from "../push/push-service.js";
import { searchIndexJob, startSearchIndexing } from "../search/jobs.js";
import { SearchLane } from "../search/lane.js";
import { type AccountServices, createAccountServices, workAccountJobs } from "../services.js";
import { settingDefinitions } from "../settings/catalog.js";
import { type SettingDefinition, SettingsRegistry } from "../settings/definition.js";
import { SettingsService } from "../settings/service.js";
import { restartWhenRestored } from "../setup/restore.js";

export type ProcessRole = "api" | "collab" | "worker";

const ERROR_FLUSH_INTERVAL_MS = 60_000;
const COLLABORATION_PROBE_TIMEOUT_MS = 2_000;

export function collaborationProbe(upstream: string): CollaborationProbe {
  return async () => {
    const response = await fetch(new URL("/health/ready", upstream), {
      signal: AbortSignal.timeout(COLLABORATION_PROBE_TIMEOUT_MS),
    });
    await response.body?.cancel();
    return response.ok;
  };
}

export interface ServerRuntime {
  role: ProcessRole;
  config: ServerConfig;
  logger: Logger;
  pool: DatabasePool;
  database: Database;
  keyRing: KeyRingHolder;
  encryption: Encryption;
  streamKeys: StreamKeys;
  settings: SettingsService;
  settingsRegistry: SettingsRegistry;
  audit: AuditLog;
  services: AccountServices;
  notificationHub: NotificationHub;
  listener: NotificationListener;
  /** Undefined for the collaboration server, which does not use jobs yet. */
  jobs: JobQueue | undefined;
  keyRotation: KeyRotation | undefined;
  metrics: Metrics;
  metricsToken: Secret;
  readiness: Record<string, HealthCheck>;
  close(): Promise<void>;
}

/** Secrets that are generated into the secrets volume on first start unless configured. */
export function resolveGeneratedSecrets(config: ServerConfig): {
  metricsToken: Secret;
  backupKeys: KeyRing;
} {
  const metricsToken =
    config.metricsToken ?? ensureSecretFile(config.paths.secrets, "metrics-token", generateToken);
  const backupKeys =
    config.keys.backupKeys ??
    ensureSecretFile(config.paths.secrets, "backup-keys", () => formatKeyEntry(1, randomBytes(KEY_LENGTH)));
  try {
    return { metricsToken, backupKeys: parseKeyRing(backupKeys.reveal()) };
  } catch (error) {
    throw new KeyRingError(`LUNEDO_BACKUP_KEY: ${(error as Error).message}`);
  }
}

export async function availableMasterKeys(config: ServerConfig): Promise<KeyRing | null> {
  try {
    return await createKeyProvider(config).load();
  } catch (error) {
    if (error instanceof KeyRingError) return null;
    throw error;
  }
}

export function startupWarnings(config: Pick<ServerConfig, "insecureIdentityProviders">): string[] {
  return config.insecureIdentityProviders
    ? [
        "LUNEDO_INSECURE_IDENTITY_PROVIDERS is set: identity providers may use plain HTTP and any host. Use it only for local tests.",
      ]
    : [];
}

/**
 * Starts the shared server foundation of a process: configuration, secrets, database,
 * migrations, master keys, settings and jobs. Every role runs migrations at startup;
 * an advisory lock makes sure only one node applies them.
 */
export async function createServerRuntime(options: {
  role: ProcessRole;
  env: Env;
  settings?: SettingDefinition<never>[];
  /** Encrypted data for key checks and rotation; defaults to the registered columns and streams. */
  encrypted?: { columns?: readonly EncryptedColumn[]; streamOwners?: readonly EncryptedStreamOwner[] };
  mailTransport?: (options: SmtpOptions) => MailTransport;
  restartAfterRestore?: () => void;
}): Promise<ServerRuntime> {
  const { role } = options;
  const config = loadConfig(options.env);
  const errorEvents = new ErrorEvents({ service: role });
  const logger = createLogger({ service: role, level: config.logLevel, onError: errorEvents.record });
  for (const warning of startupWarnings(config)) logger.warn(warning);
  await checkRestoreComplete(config.paths.files);
  const { metricsToken, backupKeys } = resolveGeneratedSecrets(config);

  const connectionString = config.database.url.reveal();
  const metrics = new Metrics(role);
  const pool = createDatabasePool({
    connectionString,
    applicationName: `lunedo-${role}`,
    max: role === "api" ? config.database.apiPoolSize : config.database.poolSize,
    settings: { plan_cache_mode: "force_generic_plan" },
    onAcquire: metrics.observeDatabaseAcquire,
  });
  pool.on("error", (error) => logger.warn({ err: error }, "Idle database connection failed"));
  const searchPool =
    role === "api"
      ? createDatabasePool({
          connectionString,
          applicationName: "lunedo-search",
          max: config.search.slots,
          connectionTimeoutMillis: config.search.waitSeconds * 1000,
          settings: {
            max_parallel_workers_per_gather: 0,
            statement_timeout: Math.round(config.search.timeoutSeconds * 1000),
          },
        })
      : undefined;
  searchPool?.on("error", (error) => logger.warn({ err: error }, "Idle search connection failed"));
  const searchLane = searchPool
    ? new SearchLane({
        pool: searchPool,
        slots: config.search.slots,
        waitMs: config.search.waitSeconds * 1000,
        observer: metrics.observeSearchLane(),
      })
    : undefined;
  const database = createDatabase(pool);
  const listener = new NotificationListener({ connectionString, logger });
  metrics.observeDatabasePool(pool);
  metrics.observeBuild(config.version);
  errorEvents.onRecord(metrics.countLoggedError);
  let flushing: NodeJS.Timeout | undefined;

  let jobs: PgBossQueue | undefined;
  try {
    await runMigrations(pool, {
      logger,
      beforeMigrate: async ({ applied, expected }) => {
        const skipRequested = await consumeSkipMarker(config.paths.work, config.version, logger);
        if (applied === 0 || applied >= expected) return;
        const fileStore = fileStoreOf(config);
        await backupBeforeMigrations({
          sources: {
            pool,
            database,
            archiver: new PostgresArchiver({ databaseUrl: connectionString }),
            filesDir: config.paths.files,
            objectStore: fileStore.kind === "s3" ? fileStore : undefined,
            streamOwners: options.encrypted?.streamOwners ?? encryptedStreamOwnersOf(fileStore),
            backupKeys,
            masterKeys: () => availableMasterKeys(config),
            workDir: config.paths.work,
            configuration: configurationForBackup(options.env),
            lunedoVersion: options.env.LUNEDO_VERSION ?? "dev",
            schemaVersion: knownSchemaVersions()[applied - 1] ?? currentSchemaVersion(),
            logger,
          },
          database,
          backupDir: config.paths.backups,
          policy: outboundPolicy(config.outboundAllowedNetworks),
          environmentAllows: config.backupBeforeUpdate,
          skipRequested,
          logger,
        });
      },
    });

    await pauseBackupsAfterRestore(config.paths.work, database, logger);
    await removeStaleStaging(pool, config.paths.work, logger);

    const columns = options.encrypted?.columns ?? encryptedColumns;
    const fileStore = fileStoreOf(config);
    const owners = options.encrypted?.streamOwners ?? encryptedStreamOwnersOf(fileStore);
    const streams = {
      owners: () => owners,
      context: { database, filesDir: config.paths.files },
    };
    const keyRing = new KeyRingHolder(createKeyProvider(config), logger);
    await loadMasterKeyRing({ keyRing, database, columns, streams });
    await keyRing.subscribe(listener);
    await restartWhenRestored(listener, logger, options.restartAfterRestore);
    const encryption = new Encryption(() => keyRing.ring);

    const settingsRegistry = new SettingsRegistry().register(
      ...settingDefinitions,
      ...(options.settings ?? []),
    );
    const audit = new AuditLog({ database, encryption });
    const settings = new SettingsService({ database, logger, onChange: auditSettingChanges(audit) });
    await settings.enableCache(listener);

    let keyRotation: KeyRotation | undefined;
    if (role !== "collab") {
      jobs = new PgBossQueue({
        connectionString,
        database,
        logger,
        role: role === "worker" ? "worker" : "producer",
        onJobFinished: metrics.observeJob,
      });
      await jobs.start();
      keyRotation = new KeyRotation({
        database,
        encryption,
        keyRing,
        jobs,
        columns: () => columns,
        streams,
      });
    }

    const services = createAccountServices({
      database,
      pool,
      settings,
      audit,
      encryption,
      keyRing,
      backupKeys,
      jobs,
      logger,
      filesDir: config.paths.files,
      importDir: config.paths.imports,
      fileStore,
      configuredInstanceUrl: config.instanceUrl,
      keyRotation,
      keyProvider: config.keys.provider,
      updates: config.updates,
      version: config.version,
      ...(role === "api" ? { collaborationProbe: collaborationProbe(config.collabUpstream) } : {}),
      passwordHashConcurrency: config.passwordHashConcurrency,
      ...(searchLane ? { searchLane } : {}),
      insecureIdentityProviders: config.insecureIdentityProviders,
      outboundAllowedNetworks: config.outboundAllowedNetworks,
      ...(config.render ? { render: config.render } : {}),
      ...(options.mailTransport ? { mailTransport: options.mailTransport } : {}),
      backup: {
        databaseUrl: connectionString,
        backupDir: config.paths.backups,
        workDir: config.paths.work,
        secretsDir: config.paths.secrets,
        masterKeysPath: config.keys.masterKeysPath,
        backupKeysConfigured: config.keys.backupKeys !== undefined,
        configuration: configurationForBackup(options.env),
        lunedoVersion: options.env.LUNEDO_VERSION ?? "dev",
        beforeUpdateEnvironment: config.backupBeforeUpdate,
      },
    });

    await services.instanceAddress.applyConfigured();
    await services.portals.enableDomainCache(listener);
    await services.maintenance.enableCache(listener);

    if (jobs && keyRotation) {
      if (role === "worker") {
        const queue = jobs;
        await queue.pauseForMaintenance((await services.maintenance.status()).enabled);
        services.maintenance.onChange((status) => {
          queue
            .pauseForMaintenance(status.enabled)
            .catch((error: unknown) => logger.warn({ err: error }, "Pausing jobs for maintenance failed"));
        });
        await services.backups.cleanUpTestRestores();
        await services.spacePermissions.recordPrivateGrantRemovals();
        await workAccountJobs(jobs, services, settings);
        const concurrency = (queue: string) => config.jobConcurrency[queue] ?? availableParallelism();
        await startSearchIndexing({
          jobs,
          listener,
          indexer: services.search.indexer,
          logger,
          concurrency: concurrency(searchIndexJob.name),
        });
        await startBlogAnnouncements({ jobs, listener, subscriptions: services.blogSubscriptions, logger });
        await startPushDelivery({ jobs, listener, push: services.push, logger });
        await startChatDelivery({ jobs, listener, channels: services.chatChannels, logger });
        await startDisplayVersions({
          jobs,
          listener,
          displayVersions: services.displayVersions,
          logger,
          concurrency: concurrency(displayVersionJob.name),
        });
        await startReviewReminders({ jobs, listener, reviews: services.reviews, logger });
        await startRemovedArticlePruning({ jobs, articles: services.articleApi });
        await startUpdateChecks({ jobs, listener, updates: services.updates, logger });
        await jobs.work(rotateDataKeysJob, keyRotation.run);
        await jobs.work(cleanupJobProgressJob, async () => {
          await cleanupJobProgress(database);
        });
        await jobs.schedule(cleanupJobProgressJob, CLEANUP_JOB_PROGRESS_SCHEDULE, {}, { key: "hourly" });
      } else {
        await jobs.register(rotateDataKeysJob);
      }
    }
    if (role === "api") {
      if (jobs) metrics.observeJobQueue(jobs);
      metrics.observeInstance(
        instanceMetricsSource({
          database,
          storage: services.storage,
          mail: services.mail,
          operations: services.operations,
          maintenance: services.maintenance,
          updates: services.updates,
          collaborationProbe: collaborationProbe(config.collabUpstream),
        }),
      );
    }

    flushing = setInterval(() => {
      errorEvents
        .flush(database)
        .catch((error: unknown) => logger.warn({ err: error }, "Storing error counts failed"));
    }, ERROR_FLUSH_INTERVAL_MS);
    flushing.unref();

    const shutdownTimeoutSeconds = config.shutdownTimeoutSeconds;
    const activeJobs = jobs;
    return {
      role,
      config,
      logger,
      pool,
      database,
      keyRing,
      encryption,
      streamKeys: masterStreamKeys(() => keyRing.ring),
      settings,
      settingsRegistry,
      audit,
      services,
      notificationHub: new NotificationHub(listener),
      listener,
      jobs,
      keyRotation,
      metrics,
      metricsToken,
      readiness: readinessChecks({ pool, keyRing }),
      async close() {
        clearInterval(flushing);
        await errorEvents.flush(database).catch(() => 0);
        await activeJobs?.stop({ timeoutSeconds: shutdownTimeoutSeconds });
        await listener.close();
        await pool.end();
        await searchPool?.end();
      },
    };
  } catch (error) {
    clearInterval(flushing);
    await jobs?.stop({ timeoutSeconds: 1 }).catch(() => {});
    await listener.close().catch(() => {});
    await pool.end().catch(() => {});
    await searchPool?.end().catch(() => {});
    throw error;
  }
}
