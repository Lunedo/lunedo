import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AuditLog, auditSettingChanges } from "../audit/audit-log.js";
import { Secret } from "../config/secret.js";
import { Encryption } from "../crypto/envelope.js";
import { EnvKeyProvider } from "../crypto/key-provider.js";
import { formatKeyEntry, parseKeyRing } from "../crypto/key-ring.js";
import { KeyRingHolder } from "../crypto/key-ring-holder.js";
import { createDatabase, type Database } from "../database/database.js";
import { runMigrations } from "../database/migrate.js";
import { createDatabasePool, type DatabasePool } from "../database/pool.js";
import { createLogger } from "../logging/logger.js";
import { type AccountServices, createAccountServices } from "../services.js";
import { SettingsService } from "../settings/service.js";
import { createTemporaryDatabase, type TemporaryDatabase } from "./database.js";
import { CapturingTransport } from "./jobs.js";

export interface TestServices {
  pool: DatabasePool;
  database: Database;
  settings: SettingsService;
  services: AccountServices;
  mail: CapturingTransport;
  close(): Promise<void>;
}

export async function createTestServices(baseUrl: string): Promise<TestServices> {
  const temporary: TemporaryDatabase = await createTemporaryDatabase(baseUrl, "pagehall_services_test");
  const pool = createDatabasePool({ connectionString: temporary.url, applicationName: "pagehall-test" });
  const logger = createLogger({ service: "test", level: "silent" });
  await runMigrations(pool, { logger });
  const database = createDatabase(pool);
  const audit = new AuditLog({ database });
  const settings = new SettingsService({ database, logger, onChange: auditSettingChanges(audit) });
  const keyRing = new KeyRingHolder(
    new EnvKeyProvider(new Secret(formatKeyEntry(1, randomBytes(32)))),
    logger,
  );
  await keyRing.reload();
  const mail = new CapturingTransport();
  const services = createAccountServices({
    database,
    pool,
    settings,
    audit,
    encryption: new Encryption(() => keyRing.ring),
    keyRing,
    backupKeys: parseKeyRing(formatKeyEntry(1, randomBytes(32))),
    jobs: undefined,
    logger,
    filesDir: mkdtempSync(path.join(tmpdir(), "pagehall-files-")),
    passwordHashConcurrency: 2,
    mailTransport: () => mail,
  });
  return {
    pool,
    database,
    settings,
    services,
    mail,
    async close() {
      await pool.end();
      await temporary.drop();
    },
  };
}
