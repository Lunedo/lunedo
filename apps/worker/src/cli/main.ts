import path from "node:path";
import {
  ConfigError,
  configurationForBackup,
  createBackup,
  createDatabase,
  createDatabasePool,
  createKeyProvider,
  createLogger,
  currentSchemaVersion,
  Encryption,
  encryptedColumns,
  KeyRingHolder,
  KeyRotation,
  knownSchemaVersions,
  loadConfig,
  PgBossQueue,
  PostgresArchiver,
  resolveGeneratedSecrets,
  restoreBackup,
  rotateDataKeysJob,
  rotateMasterKey,
  verifyBackup,
} from "@pagehall/server";
import { type Command, parseCommand, UsageError, usage } from "./parse.js";

const write = (text: string) => process.stdout.write(`${text}\n`);

async function run(command: Command): Promise<void> {
  if (command.name === "help") {
    process.stdout.write(usage);
    return;
  }
  const env = process.env;
  const config = loadConfig(env);
  const logger = createLogger({ service: "cli", level: "warn", destination: process.stderr });
  const databaseUrl = config.database.url.reveal();

  switch (command.name) {
    case "backup create": {
      const { backupKeys } = resolveGeneratedSecrets(config);
      const manifest = await createBackup({
        output: path.resolve(command.output),
        backupKeys,
        database: new PostgresArchiver({ databaseUrl }),
        filesDir: config.paths.files,
        config: configurationForBackup(env),
        pagehallVersion: env.PAGEHALL_VERSION ?? "dev",
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
        database: new PostgresArchiver({ databaseUrl }),
        filesDir: config.paths.files,
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
