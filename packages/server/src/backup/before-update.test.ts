import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { knownSchemaVersions, migrationStatus, runMigrations } from "../database/migrate.js";
import { createDatabasePool } from "../database/pool.js";
import { encryptedStreamOwnersOf } from "../files/owners.js";
import { createLogger } from "../logging/logger.js";
import { outboundPolicy } from "../outbound/guarded-request.js";
import { createTemporaryDatabase, testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { readBackupHeader } from "./archive.js";
import {
  BackupBeforeUpdateError,
  backupBeforeMigrations,
  requestSkipBeforeUpdate,
  SKIP_BEFORE_UPDATE_MARKER,
} from "./before-update.js";
import { parseBackupName } from "./naming.js";
import { PostgresArchiver } from "./postgres.js";
import type { BackupSources } from "./runner.js";

const hasTools = spawnSync("pg_dump", ["--version"]).status === 0;
if (process.env.CI && !hasTools) throw new Error("pg_dump must be installed in CI");

const baseUrl = testDatabaseBaseUrl();
const logger = createLogger({ service: "test", level: "silent" });

describe.skipIf(!baseUrl)("backup before an update", () => {
  let test: TestServices;
  let backupDir: string;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  beforeEach(async () => {
    backupDir = await mkdtemp(path.join(tmpdir(), "pagehall-before-update-"));
    await test.database.execute(sql`delete from backup_configuration`);
    await test.database.execute(sql`delete from backup_runs`);
    return () => rm(backupDir, { recursive: true, force: true });
  });

  function sources(schemaVersion: string): BackupSources {
    return {
      pool: test.pool,
      database: test.database,
      archiver: new PostgresArchiver({ databaseUrl: test.url }),
      filesDir: test.filesDir,
      objectStore: undefined,
      streamOwners: encryptedStreamOwnersOf(test.services.files.store),
      backupKeys: test.backupKeys,
      masterKeys: async () => test.keyRing.ring,
      stagingDir: backupDir,
      configuration: {},
      pagehallVersion: "2.0.0",
      schemaVersion,
      logger,
    };
  }

  function before(options: { environmentAllows?: boolean; schemaVersion?: string } = {}) {
    return backupBeforeMigrations({
      sources: sources(options.schemaVersion ?? knownSchemaVersions().at(-2) ?? ""),
      database: test.database,
      backupDir,
      policy: outboundPolicy([]),
      environmentAllows: options.environmentAllows ?? true,
      logger,
    });
  }

  async function names() {
    return (await readdir(backupDir)).filter((name) => parseBackupName(name)).sort();
  }

  it.skipIf(!hasTools)(
    "writes to the default directory when no target is set up, with the schema of the old version",
    async () => {
      const schemaVersion = knownSchemaVersions().at(-2) ?? "";
      await before({ schemaVersion });
      const [name] = await names();
      expect(parseBackupName(name ?? "")?.backupClass).toBe("beforeUpdate");
      expect((await readBackupHeader(path.join(backupDir, name ?? ""))).header).toMatchObject({
        schemaVersion,
        pagehallVersion: "2.0.0",
      });
      const runs = await test.database.execute(sql`select trigger, state from backup_runs`);
      expect(runs.rows).toEqual([{ trigger: "beforeUpdate", state: "succeeded" }]);
    },
  );

  it.skipIf(!hasTools)("keeps the configured number of backups before updates", async () => {
    await test.database.execute(
      sql`insert into backup_configuration (singleton, keep_before_update) values (true, 2)`,
    );
    for (let index = 0; index < 3; index += 1) {
      await before();
      await new Promise((resolve) => setTimeout(resolve, 1100));
    }
    expect(await names()).toHaveLength(2);
  });

  it.skipIf(!hasTools)(
    "is turned off by the setting, by the environment and once by the skip command",
    async () => {
      await before({ environmentAllows: false });
      await test.database.execute(
        sql`insert into backup_configuration (singleton, before_update) values (true, false)`,
      );
      await before();
      await test.database.execute(sql`delete from backup_configuration`);
      await requestSkipBeforeUpdate(backupDir);
      await before();
      expect(await names()).toEqual([]);
      expect(await readdir(backupDir)).not.toContain(SKIP_BEFORE_UPDATE_MARKER);
      await before();
      expect(await names()).toHaveLength(1);
    },
  );

  it("stops with the reason and the command to skip it once", async () => {
    const file = path.join(backupDir, "not-a-directory");
    await writeFile(file, "x");
    const failing = backupBeforeMigrations({
      sources: { ...sources("0000_foundation"), stagingDir: file },
      database: test.database,
      backupDir: file,
      policy: outboundPolicy([]),
      environmentAllows: true,
      logger,
    });
    await expect(failing).rejects.toBeInstanceOf(BackupBeforeUpdateError);
    await expect(failing).rejects.toThrow("docker compose run --rm pagehall backup skip-before-update");
  });

  it("does not migrate when the hook fails", async () => {
    const temporary = await createTemporaryDatabase(baseUrl ?? "", "pagehall_before_update_test");
    const pool = createDatabasePool({ connectionString: temporary.url, applicationName: "pagehall-test" });
    try {
      await expect(
        runMigrations(pool, {
          logger,
          beforeMigrate: async () => {
            throw new BackupBeforeUpdateError("backup failed");
          },
        }),
      ).rejects.toThrow("backup failed");
      expect((await migrationStatus(pool)).applied).toBe(0);
    } finally {
      await pool.end();
      await temporary.drop();
    }
  });
});
