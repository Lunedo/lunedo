import type { HealthCheck } from "@pagehall/shared";
import { ensureSecretFile, generateKey, generateToken } from "../config/generated-secrets.js";
import { type Env, loadConfig, type ServerConfig } from "../config/load.js";
import { Secret } from "../config/secret.js";
import { encryptedColumns } from "../crypto/encrypted-column.js";
import { Encryption } from "../crypto/envelope.js";
import { createKeyProvider } from "../crypto/key-provider.js";
import { KeyRingError, SecretKey } from "../crypto/key-ring.js";
import { KeyRingHolder } from "../crypto/key-ring-holder.js";
import { KeyRotation, rotateDataKeysJob } from "../crypto/rotation.js";
import { masterStreamKeys, type StreamKeys } from "../crypto/stream.js";
import { createDatabase, type Database } from "../database/database.js";
import { runMigrations } from "../database/migrate.js";
import { NotificationListener } from "../database/notifications.js";
import { createDatabasePool, type DatabasePool } from "../database/pool.js";
import { readinessChecks } from "../health/readiness.js";
import type { JobQueue } from "../jobs/job-queue.js";
import { PgBossQueue } from "../jobs/pg-boss-queue.js";
import { createLogger, type Logger } from "../logging/logger.js";
import { Metrics } from "../observability/metrics.js";
import { builtinSettings } from "../settings/builtin.js";
import { type SettingDefinition, SettingsRegistry } from "../settings/definition.js";
import { SettingsService } from "../settings/service.js";

export type ProcessRole = "api" | "collab" | "worker";

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
  backupKey: SecretKey;
} {
  const metricsToken =
    config.metricsToken ?? ensureSecretFile(config.paths.secrets, "metrics-token", generateToken);
  const backupKeyText =
    config.keys.backupKey ?? ensureSecretFile(config.paths.secrets, "backup-key", generateKey);
  const backupKeyBytes = Buffer.from(backupKeyText.reveal(), "base64");
  if (backupKeyBytes.length !== 32) {
    throw new KeyRingError("PAGEHALL_BACKUP_KEY must be 32 bytes, encoded as base64");
  }
  return { metricsToken, backupKey: new SecretKey(backupKeyBytes) };
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
}): Promise<ServerRuntime> {
  const { role } = options;
  const config = loadConfig(options.env);
  const logger = createLogger({ service: role, level: config.logLevel });
  const { metricsToken } = resolveGeneratedSecrets(config);

  const connectionString = config.database.url.reveal();
  const pool = createDatabasePool({
    connectionString,
    applicationName: `pagehall-${role}`,
    max: config.database.poolSize,
  });
  pool.on("error", (error) => logger.warn({ err: error }, "Idle database connection failed"));
  const database = createDatabase(pool);
  const listener = new NotificationListener({ connectionString, logger });
  const metrics = new Metrics(role);
  metrics.observeDatabasePool(pool);

  let jobs: PgBossQueue | undefined;
  try {
    await runMigrations(pool, { logger });

    const keyRing = new KeyRingHolder(createKeyProvider(config), logger);
    await keyRing.reload();
    await keyRing.subscribe(listener);
    const encryption = new Encryption(() => keyRing.ring);

    const settingsRegistry = new SettingsRegistry().register(
      ...(builtinSettings as SettingDefinition<never>[]),
      ...(options.settings ?? []),
    );
    const settings = new SettingsService({ database, logger });
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
      keyRotation = new KeyRotation({ database, encryption, keyRing, jobs, columns: () => encryptedColumns });
      if (role === "worker") {
        metrics.observeJobQueue(jobs);
        await jobs.work(rotateDataKeysJob, keyRotation.run);
      } else {
        await jobs.register(rotateDataKeysJob);
      }
    }

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
      jobs,
      keyRotation,
      metrics,
      metricsToken,
      readiness: readinessChecks({ pool, keyRing }),
      async close() {
        await activeJobs?.stop({ timeoutSeconds: shutdownTimeoutSeconds });
        await listener.close();
        await pool.end();
      },
    };
  } catch (error) {
    await jobs?.stop({ timeoutSeconds: 1 }).catch(() => {});
    await listener.close().catch(() => {});
    await pool.end().catch(() => {});
    throw error;
  }
}
