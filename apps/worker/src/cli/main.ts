import path from "node:path";
import {
  ConfigError,
  checkRestoreComplete,
  configurationForBackup,
  createBackup,
  createDatabase,
  createDatabasePool,
  createKeyProvider,
  createLogger,
  currentSchemaVersion,
  Encryption,
  encryptedColumns,
  encryptedStreamOwnersOf,
  fileStoreOf,
  type KeyRing,
  KeyRingError,
  KeyRingHolder,
  KeyRotation,
  keyFingerprint,
  knownSchemaVersions,
  loadConfig,
  masterKeyVersionsInUse,
  PgBossQueue,
  PostgresArchiver,
  pagehallVersion,
  resolveGeneratedSecrets,
  restoreBackup,
  rotateDataKeysJob,
  rotateMasterKey,
  type ServerConfig,
  verifyBackup,
} from "@pagehall/server";
import { verifyAuditLog } from "./audit.js";
import { maintenance } from "./maintenance.js";
import { type Command, parseCommand, UsageError, usage } from "./parse.js";
import { rebuildSearchIndex, searchIndexStatus } from "./search.js";

const write = (text: string) => process.stdout.write(`${text}\n`);

/** Master key versions that encrypted data of this instance uses, for the backup header. */
async function requiredMasterKeys(config: ServerConfig, databaseUrl: string) {
  const pool = createDatabasePool({ connectionString: databaseUrl, applicationName: "pagehall-cli" });
  try {
    const database = createDatabase(pool);
    const inUse = Object.keys(
      await masterKeyVersionsInUse({
        database,
        columns: encryptedColumns,
        streams: {
          owners: () => encryptedStreamOwnersOf(fileStoreOf(config)),
          context: { database, filesDir: config.paths.files },
        },
      }),
    ).map(Number);
    if (inUse.length === 0) return [];
    const ring = await createKeyProvider(config).load();
    return inUse.map((version) => {
      if (!ring.has(version)) {
        throw new Error(
          `Encrypted data uses master key version ${version}, which is not in the master key ring of this instance, so a backup could not be restored. Restore that key version first.`,
        );
      }
      return { version, fingerprint: keyFingerprint("master", ring.get(version)) };
    });
  } finally {
    await pool.end();
  }
}

/** The master key ring of this instance, without creating one. */
async function availableMasterKeys(config: ServerConfig): Promise<KeyRing | null> {
  try {
    return await createKeyProvider(config).load();
  } catch (error) {
    if (error instanceof KeyRingError) return null;
    throw error;
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
  const env = process.env;
  const config = loadConfig(env);
  const logger = createLogger({ service: "cli", level: "warn", destination: process.stderr });
  const databaseUrl = config.database.url.reveal();

  switch (command.name) {
    case "backup create": {
      await checkRestoreComplete(config.paths.files);
      const { backupKeys } = resolveGeneratedSecrets(config);
      const manifest = await createBackup({
        output: path.resolve(command.output),
        backupKeys,
        masterKeys: await requiredMasterKeys(config, databaseUrl),
        database: new PostgresArchiver({ databaseUrl }),
        filesDir: config.paths.files,
        objectStore: config.fileStorage.kind === "s3" ? fileStoreOf(config) : undefined,
        config: configurationForBackup(env),
        pagehallVersion: pagehallVersion(env),
        schemaVersion: currentSchemaVersion(),
        logger,
      });
      write(`Backup written to ${path.resolve(command.output)} (${manifest.entries.length} entries).`);
      write("It can only be restored with the backup key. Keep a copy of the key in a safe place.");
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
  if (error instanceof ConfigError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(78);
  }
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
