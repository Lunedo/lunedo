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
  consumeSkipMarker,
  createBeforeUpdateBackup,
  requestSkipBeforeUpdate,
  SKIP_BEFORE_UPDATE_MARKER,
} from "./before-update.js";
import { parseBackupName } from "./naming.js";
import { PostgresArchiver } from "./postgres.js";
import { RESTORED_MARKER, writeRestoredMarker } from "./restore-marker.js";
import { type BackupSources, tryBackupLock, writeBackupFile } from "./runner.js";

const hasTools = spawnSync("pg_dump", ["--version"]).status === 0;
if (process.env.CI && !hasTools) throw new Error("pg_dump must be installed in CI");

const baseUrl = testDatabaseBaseUrl();
const logger = createLogger({ service: "test", level: "silent" });
const NO_SPACE = async () => ({ free: 1024, total: 1024 ** 4, device: 1 });

describe.skipIf(!baseUrl)("backup before an update", () => {
  let test: TestServices;
  let backupDir: string;
  let workDir: string;
  let earlierEvents = new Set<string>();

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  beforeEach(async () => {
    backupDir = await mkdtemp(path.join(tmpdir(), "pagehall-before-update-"));
    workDir = await mkdtemp(path.join(tmpdir(), "pagehall-before-update-work-"));
    await test.database.execute(sql`delete from backup_configuration`);
    await test.database.execute(sql`delete from backup_state`);
    await test.database.execute(sql`delete from backup_runs`);
    const events = await test.database.execute<{ id: string }>(
      sql`select id from audit_events where name like 'backup.%'`,
    );
    earlierEvents = new Set(events.rows.map((row) => row.id));
    return async () => {
      await rm(backupDir, { recursive: true, force: true });
      await rm(workDir, { recursive: true, force: true });
    };
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
      workDir,
      configuration: {},
      pagehallVersion: "2.0.0",
      schemaVersion,
      logger,
    };
  }

  function before(
    options: { environmentAllows?: boolean; schemaVersion?: string; skipRequested?: boolean } = {},
  ) {
    return backupBeforeMigrations({
      sources: sources(options.schemaVersion ?? knownSchemaVersions().at(-2) ?? ""),
      database: test.database,
      backupDir,
      policy: outboundPolicy([]),
      environmentAllows: options.environmentAllows ?? true,
      skipRequested: options.skipRequested ?? false,
      logger,
    });
  }

  async function names() {
    return (await readdir(backupDir)).filter((name) => parseBackupName(name)).sort();
  }

  async function audited(name: string) {
    const result = await test.database.execute<{ id: string; fields: Record<string, unknown> }>(
      sql`select id, fields from audit_events where name = ${name} order by occurred_at, id`,
    );
    return result.rows.filter((row) => !earlierEvents.has(row.id)).map((row) => row.fields);
  }

  const second = () => new Promise((resolve) => setTimeout(resolve, 1100));

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
      const runs = await test.database.execute(sql`select trigger, state, name from backup_runs`);
      expect(runs.rows).toEqual([{ trigger: "beforeUpdate", state: "succeeded", name }]);
    },
  );

  it.skipIf(!hasTools)("keeps the configured number of backups before updates", async () => {
    await test.database.execute(
      sql`insert into backup_configuration (singleton, keep_before_update) values (true, 2)`,
    );
    for (let index = 0; index < 3; index += 1) {
      await before();
      await second();
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
      await before({ skipRequested: true });
      expect(await names()).toEqual([]);
      await before();
      expect(await names()).toHaveLength(1);
    },
  );

  it("applies a skip request only to the next start of the version it was made for", async () => {
    await requestSkipBeforeUpdate(workDir, "1.5.0");
    expect(await readdir(workDir)).toContain(SKIP_BEFORE_UPDATE_MARKER);
    expect(await consumeSkipMarker(workDir, "1.5.0", logger)).toBe(true);
    expect(await readdir(workDir)).not.toContain(SKIP_BEFORE_UPDATE_MARKER);
    expect(await consumeSkipMarker(workDir, "1.5.0", logger)).toBe(false);

    await requestSkipBeforeUpdate(workDir, "1.4.0");
    expect(await consumeSkipMarker(workDir, "1.5.0", logger)).toBe(false);
    expect(await readdir(workDir)).not.toContain(SKIP_BEFORE_UPDATE_MARKER);

    await writeFile(path.join(workDir, SKIP_BEFORE_UPDATE_MARKER), "not json");
    expect(await consumeSkipMarker(workDir, "1.5.0", logger)).toBe(false);
    expect(await readdir(workDir)).not.toContain(SKIP_BEFORE_UPDATE_MARKER);
  });

  it.skipIf(!hasTools)("audits the backup and the deletions of its retention as other backups", async () => {
    await test.database.execute(
      sql`insert into backup_configuration (singleton, keep_before_update) values (true, 3)`,
    );
    for (let index = 0; index < 4; index += 1) {
      await before();
      await second();
    }
    const created = await audited("backup.created");
    expect(created).toHaveLength(4);
    expect(created.at(-1)).toMatchObject({ trigger: "beforeUpdate", backupClass: "beforeUpdate" });
    expect(await audited("backup.deleted")).toEqual([
      expect.objectContaining({ reason: "retention", backupClass: "beforeUpdate" }),
    ]);
    expect(await names()).toHaveLength(3);
  });

  it("audits a failed backup before an update", async () => {
    const file = path.join(backupDir, "not-a-directory");
    await writeFile(file, "x");
    await expect(
      createBeforeUpdateBackup({
        sources: sources("0000_foundation"),
        database: test.database,
        backupDir: file,
        policy: outboundPolicy([]),
        logger,
      }),
    ).rejects.toThrow();
    expect(await audited("backup.failed")).toEqual([
      expect.objectContaining({ trigger: "beforeUpdate", backupClass: "beforeUpdate" }),
    ]);
  });

  it.skipIf(!hasTools)("never deletes backups another installation wrote to the same directory", async () => {
    await test.database.execute(
      sql`insert into backup_configuration (singleton, keep_before_update) values (true, 1)`,
    );
    await before();
    const [foreign] = await names();
    await test.database.execute(sql`delete from backup_runs`);
    await second();
    await before();
    await second();
    await before();
    const kept = await names();
    expect(kept).toContain(foreign);
    expect(kept).toHaveLength(2);
  });

  it.skipIf(!hasTools)(
    "writes to the default directory and deletes nothing while a restored instance is unconfirmed",
    async () => {
      const target = await mkdtemp(path.join(tmpdir(), "pagehall-before-update-target-"));
      try {
        await test.database.execute(sql`
          insert into backup_configuration (singleton, target_kind, target_path, keep_before_update)
          values (true, 'local', ${target}, 1)`);
        await writeRestoredMarker(test.filesDir);
        await before();
        await second();
        await before();
        expect(await readdir(target)).toEqual([]);
        expect(await names()).toHaveLength(2);
      } finally {
        await rm(path.join(test.filesDir, RESTORED_MARKER), { force: true });
        await rm(target, { recursive: true, force: true });
      }
    },
  );

  it("refuses before the dump starts when the work directory has too little space", async () => {
    let dumped = false;
    const archiver = new PostgresArchiver({ databaseUrl: test.url });
    archiver.dump = () => {
      dumped = true;
      throw new Error("must not be called");
    };
    await expect(
      createBeforeUpdateBackup({
        sources: { ...sources("0000_foundation"), archiver, diskSpace: NO_SPACE },
        database: test.database,
        backupDir,
        policy: outboundPolicy([]),
        logger,
      }),
    ).rejects.toThrow("Not enough free space for the database dump in the work directory");
    expect(dumped).toBe(false);
    expect((await audited("backup.failed")).at(-1)).toMatchObject({
      reason: expect.stringContaining("Not enough free space"),
    });
  });

  it.skipIf(!hasTools)("makes a backup to a file wait for a running backup", async () => {
    const lock = await tryBackupLock(test.pool);
    const output = path.join(backupDir, "manual.phbak");
    let finished = false;
    const writing = writeBackupFile(sources("0000_foundation"), output).then(() => {
      finished = true;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(finished).toBe(false);
    } finally {
      await lock?.release();
    }
    await writing;
    expect(finished).toBe(true);
  });

  it("checks the space of the work directory for a backup to a file", async () => {
    const archiver = new PostgresArchiver({ databaseUrl: test.url });
    archiver.dump = () => {
      throw new Error("must not be called");
    };
    await expect(
      writeBackupFile(
        { ...sources("0000_foundation"), archiver, diskSpace: NO_SPACE },
        path.join(backupDir, "manual.phbak"),
      ),
    ).rejects.toThrow("Not enough free space");
  });

  it("stops with the reason and the command to skip it once", async () => {
    const file = path.join(backupDir, "not-a-directory");
    await writeFile(file, "x");
    const failing = backupBeforeMigrations({
      sources: sources("0000_foundation"),
      database: test.database,
      backupDir: file,
      policy: outboundPolicy([]),
      environmentAllows: true,
      skipRequested: false,
      logger,
    });
    await expect(failing).rejects.toBeInstanceOf(BackupBeforeUpdateError);
    await expect(failing).rejects.toThrow("docker compose run --rm pagehall backup skip-before-update");
  });

  it("calls the start hook also when no migration is pending", async () => {
    const temporary = await createTemporaryDatabase(baseUrl ?? "", "pagehall_before_update_test");
    const pool = createDatabasePool({ connectionString: temporary.url, applicationName: "pagehall-test" });
    try {
      const calls: { applied: number; expected: number }[] = [];
      const record = async (pending: { applied: number; expected: number }) => {
        calls.push(pending);
      };
      await runMigrations(pool, { logger, beforeMigrate: record });
      await runMigrations(pool, { logger, beforeMigrate: record });
      const expected = knownSchemaVersions().length;
      expect(calls).toEqual([
        { applied: 0, expected },
        { applied: expected, expected },
      ]);
    } finally {
      await pool.end();
      await temporary.drop();
    }
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
