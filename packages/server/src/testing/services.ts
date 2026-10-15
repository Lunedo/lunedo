import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AuditLog, auditSettingChanges } from "../audit/audit-log.js";
import { Secret } from "../config/secret.js";
import { Encryption } from "../crypto/envelope.js";
import { EnvKeyProvider, type KeyProvider } from "../crypto/key-provider.js";
import { formatKeyEntry, parseKeyRing } from "../crypto/key-ring.js";
import { KeyRingHolder } from "../crypto/key-ring-holder.js";
import { createDatabase, type Database } from "../database/database.js";
import { runMigrations } from "../database/migrate.js";
import { createDatabasePool, type DatabasePool } from "../database/pool.js";
import type { DirectoryConnector } from "../identity/ldap-connection.js";
import { createLogger } from "../logging/logger.js";
import type { OutboundPolicy } from "../outbound/guarded-request.js";
import { type AccountServices, createAccountServices } from "../services.js";
import { SettingsService } from "../settings/service.js";
import { createMigratedDatabase, createTemporaryDatabase, type TemporaryDatabase } from "./database.js";
import { CapturingTransport } from "./jobs.js";

export interface TestServices {
  encryption: Encryption;
  keyRing: KeyRingHolder;
  url: string;
  pool: DatabasePool;
  database: Database;
  settings: SettingsService;
  services: AccountServices;
  mail: CapturingTransport;
  anotherNode(): AccountServices;
  close(): Promise<void>;
}

export async function createTestServices(
  baseUrl: string,
  options: {
    configuredInstanceUrl?: string;
    directoryConnector?: DirectoryConnector;
    masterKey?: Buffer;
    keyProvider?: KeyProvider;
    atlassianFetch?: typeof fetch;
    chatPolicy?: OutboundPolicy;
    pushPolicy?: OutboundPolicy;
    beforeMigrations?: (url: string) => Promise<unknown>;
  } = {},
): Promise<TestServices> {
  const temporary: TemporaryDatabase = options.beforeMigrations
    ? await createTemporaryDatabase(baseUrl, "pagehall_services_test")
    : await createMigratedDatabase(baseUrl, "pagehall_services_test");
  await options.beforeMigrations?.(temporary.url);
  const pool = createDatabasePool({ connectionString: temporary.url, applicationName: "pagehall-test" });
  const logger = createLogger({ service: "test", level: "silent" });
  await runMigrations(pool, { logger });
  const database = createDatabase(pool);
  const keyRing = new KeyRingHolder(
    options.keyProvider ??
      new EnvKeyProvider(new Secret(formatKeyEntry(1, options.masterKey ?? randomBytes(32)))),
    logger,
  );
  await keyRing.reload({ create: true });
  const encryption = new Encryption(() => keyRing.ring);
  const audit = new AuditLog({ database, encryption });
  const settings = new SettingsService({ database, logger, onChange: auditSettingChanges(audit) });
  const mail = new CapturingTransport();
  const build = () =>
    createAccountServices({
      database,
      pool,
      settings,
      audit,
      encryption,
      keyRing,
      backupKeys: parseKeyRing(formatKeyEntry(1, randomBytes(32))),
      jobs: undefined,
      logger,
      filesDir: mkdtempSync(path.join(tmpdir(), "pagehall-files-")),
      passwordHashConcurrency: 2,
      insecureIdentityProviders: true,
      configuredInstanceUrl: options.configuredInstanceUrl,
      ...(options.directoryConnector ? { directoryConnector: options.directoryConnector } : {}),
      ...(options.atlassianFetch ? { atlassianFetch: options.atlassianFetch } : {}),
      ...(options.chatPolicy ? { chatPolicy: options.chatPolicy } : {}),
      ...(options.pushPolicy ? { pushPolicy: options.pushPolicy } : {}),
      mailTransport: () => mail,
    });
  const services = build();
  return {
    url: temporary.url,
    pool,
    database,
    settings,
    services,
    mail,
    encryption,
    keyRing,
    anotherNode: build,
    async close() {
      await pool.end();
      await temporary.drop();
    },
  };
}
