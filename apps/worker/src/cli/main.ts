import path from "node:path";
import {
  availableMasterKeys,
  type BackupSources,
  ConfigError,
  checkRestoreComplete,
  configurationForBackup,
  createBeforeUpdateBackup,
  createDatabase,
  createDatabasePool,
  createKeyProvider,
  createLogger,
  currentSchemaVersion,
  type DatabasePool,
  Encryption,
  encryptedColumns,
  encryptedStreamOwnersOf,
  fileStoreOf,
  KeyRingHolder,
  KeyRotation,
  knownSchemaVersions,
  type Logger,
  loadConfig,
  outboundPolicy,
  PgBossQueue,
  PostgresArchiver,
  pagehallVersion,
  requestSkipBeforeUpdate,
  resolveGeneratedSecrets,
  restoreBackup,
  rotateDataKeysJob,
  rotateMasterKey,
  type ServerConfig,
  verifyBackup,
  writeBackupFile,
} from "@pagehall/server";
import { verifyAuditLog } from "./audit.js";
import { maintenance } from "./maintenance.js";
import { type Command, parseCommand, UsageError, usage } from "./parse.js";
import { releaseNotes, UpdateStepError } from "./release-notes.js";
import { rebuildSearchIndex, searchIndexStatus } from "./search.js";

const write = (text: string) => process.stdout.write(`${text}\n`);

function backupSources(
  config: ServerConfig,
  env: NodeJS.ProcessEnv,
  pool: DatabasePool,
  logger: Logger,
  databaseUrl: string,
): BackupSources {
  const fileStore = fileStoreOf(config);
  return {
    pool,
    database: createDatabase(pool),
    archiver: new PostgresArchiver({ databaseUrl }),
    filesDir: config.paths.files,
    objectStore: fileStore.kind === "s3" ? fileStore : undefined,
    streamOwners: encryptedStreamOwnersOf(fileStore),
    backupKeys: resolveGeneratedSecrets(config).backupKeys,
    masterKeys: () => availableMasterKeys(config),
    stagingDir: config.paths.backups,
    configuration: configurationForBackup(env),
    pagehallVersion: pagehallVersion(env),
    schemaVersion: currentSchemaVersion(),
    logger,
  };
}

async function withPool<T>(databaseUrl: string, use: (pool: DatabasePool) => Promise<T>): Promise<T> {
  const pool = createDatabasePool({ connectionString: databaseUrl, applicationName: "pagehall-cli" });
  try {
    return await use(pool);
  } finally {
    await pool.end();
  }
}

async function run(command: Command): Promise<void> {
  if (command.name === "help") {
    process.stdout.write(usage);
    return;
  }
  if (command.name === "version") {
    write(pagehallVersion());
    return;
  }
  if (command.name === "release-notes") {
    await releaseNotes(process.env, command.command, write);
    return;
  }
  const env = process.env;
  const config = loadConfig(env);
  const logger = createLogger({ service: "cli", level: "warn", destination: process.stderr });
  const databaseUrl = config.database.url.reveal();

  switch (command.name) {
    case "backup create": {
      await checkRestoreComplete(config.paths.files);
      const manifest = await withPool(databaseUrl, (pool) =>
        writeBackupFile(backupSources(config, env, pool, logger, databaseUrl), path.resolve(command.output)),
      );
      write(`Backup written to ${path.resolve(command.output)} (${manifest.entries.length} entries).`);
      write("It can only be restored with the backup key. Keep a copy of the key in a safe place.");
      return;
    }
    case "backup create before update": {
      await checkRestoreComplete(config.paths.files);
      const written = await withPool(databaseUrl, (pool) =>
        createBeforeUpdateBackup({
          sources: backupSources(config, env, pool, logger, databaseUrl),
          database: createDatabase(pool),
          backupDir: config.paths.backups,
          policy: outboundPolicy(config.outboundAllowedNetworks),
          logger,
        }),
      );
      write(written.location);
      return;
    }
    case "backup skip-before-update": {
      const marker = await requestSkipBeforeUpdate(config.paths.backups);
      write(`The next start applies pending migrations without a backup before the update (${marker}).`);
      return;
    }
    case "backup verify": {
      const { backupKeys } = resolveGeneratedSecrets(config);
      const manifest = await verifyBackup({
        input: command.input,
        backupKeys,
        knownSchemaVersions: knownSchemaVersions(),
      });
      write(
        `Backup is complete and readable: ${manifest.entries.length} entries, schema ${manifest.schemaVersion}, created ${manifest.createdAt} by Pagehall ${manifest.pagehallVersion}.`,
      );
      return;
    }
    case "backup restore": {
      const { backupKeys } = resolveGeneratedSecrets(config);
      const manifest = await restoreBackup({
        input: command.input,
        backupKeys,
        masterKeys: await availableMasterKeys(config),
        database: new PostgresArchiver({ databaseUrl }),
        filesDir: config.paths.files,
        objectStore: config.fileStorage.kind === "s3" ? fileStoreOf(config) : undefined,
        configDir: command.configDir,
        force: command.force,
        knownSchemaVersions: knownSchemaVersions(),
        logger,
      });
      write(
        `Backup restored (schema ${manifest.schemaVersion}). Start Pagehall to apply pending migrations.`,
      );
      return;
    }
    case "audit verify": {
      process.exitCode = await verifyAuditLog(databaseUrl, write);
      return;
    }
    case "search rebuild": {
      await rebuildSearchIndex(databaseUrl, write);
      return;
    }
    case "search status": {
      await searchIndexStatus(databaseUrl, write);
      return;
    }
    case "maintenance": {
      await maintenance(config, command.command, write);
      return;
    }
    case "keys rotate":
    case "keys status": {
      const pool = createDatabasePool({ connectionString: databaseUrl, applicationName: "pagehall-cli" });
      const database = createDatabase(pool);
      const keyRing = new KeyRingHolder(createKeyProvider(config), logger);
      const jobs = new PgBossQueue({ connectionString: databaseUrl, database, logger, role: "producer" });
      try {
        await keyRing.reload();
        const rotation = new KeyRotation({
          database,
          encryption: new Encryption(() => keyRing.ring),
          keyRing,
          jobs,
          columns: () => encryptedColumns,
          streams: {
            owners: () => encryptedStreamOwnersOf(fileStoreOf(config)),
            context: { database, filesDir: config.paths.files },
          },
        });
        if (command.name === "keys status") {
          const status = await rotation.status();
          write(`Current master key version: ${status.currentVersion}`);
          write(`Available versions: ${keyRing.ring.versions.join(", ")}`);
          if (status.latest) {
            write(
              `Latest rotation: to version ${status.latest.targetVersion}, ${status.latest.status}, ${status.latest.rewrapped} values re-wrapped`,
            );
          }
          return;
        }
        await jobs.register(rotateDataKeysJob);
        const started = await rotateMasterKey({ pool, keyRing, rotation });
        write(
          `Key rotation to version ${started.targetVersion} started (${started.id}). The worker re-wraps all data keys.`,
        );
      } finally {
        await jobs.stop({ timeoutSeconds: 5 });
        await pool.end();
      }
      return;
    }
  }
}

try {
  await run(parseCommand(process.argv.slice(2)));
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`${error.message}\n\n${usage}`);
    process.exit(64);
  }
  if (error instanceof UpdateStepError) {
    process.stderr.write(`${error.message}
`);
    process.exit(65);
  }
  if (error instanceof ConfigError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(78);
  }
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
