import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { uuidv7 } from "@pagehall/shared";
import { afterEach, describe, expect, it } from "vitest";
import { formatKeyEntry, parseKeyRing } from "../crypto/key-ring.js";
import { currentSchemaVersion, runMigrations } from "../database/migrate.js";
import { createDatabasePool } from "../database/pool.js";
import { createLogger } from "../logging/logger.js";
import { createTemporaryDatabase, type TemporaryDatabase, testDatabaseBaseUrl } from "../testing/database.js";
import { createBackup, restoreBackup } from "./archive.js";
import { libpqEnvironment, PostgresArchiver } from "./postgres.js";

const baseUrl = testDatabaseBaseUrl();
const logger = createLogger({ service: "test", level: "silent" });
const hasTools = spawnSync("pg_dump", ["--version"]).status === 0;
if (process.env.CI && !hasTools) throw new Error("pg_dump must be installed in CI");

describe("libpqEnvironment", () => {
  it("passes credentials through the environment", () => {
    expect(libpqEnvironment("postgres://user%40x:p%40ss@db.example:6543/pagehall?sslmode=require")).toEqual({
      PGHOST: "db.example",
      PGPORT: "6543",
      PGUSER: "user@x",
      PGPASSWORD: "p@ss",
      PGDATABASE: "pagehall",
      PGSSLMODE: "require",
    });
  });
});

describe.skipIf(!baseUrl || !hasTools)("PostgresArchiver", () => {
  const databases: TemporaryDatabase[] = [];
  let dir: string | undefined;

  afterEach(async () => {
    for (const database of databases.splice(0)) await database.drop();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function database() {
    const created = await createTemporaryDatabase(baseUrl as string);
    databases.push(created);
    return created;
  }

  it("backs up a database and restores it into a fresh one", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "pagehall-pg-backup-"));
    const source = await database();
    const sourcePool = createDatabasePool({ connectionString: source.url, applicationName: "pagehall-test" });
    await runMigrations(sourcePool, { logger });
    const scopeId = uuidv7();
    const secret = randomBytes(64);
    await sourcePool.query(
      "insert into setting_values (id, level, scope_id, key, value, locked) values ($1, 'organization', $2, 'locale.language', '\"de\"', true)",
      [uuidv7(), scopeId],
    );
    await sourcePool.query("create table test_blobs (id int primary key, content bytea)");
    await sourcePool.query("insert into test_blobs values (1, $1)", [secret]);
    await sourcePool.end();

    const backupKeys = parseKeyRing(formatKeyEntry(1, randomBytes(32)));
    const output = path.join(dir, "backup.phbak");
    await createBackup({
      output,
      backupKeys,
      database: new PostgresArchiver({ databaseUrl: source.url }),
      filesDir: path.join(dir, "files"),
      config: {},
      pagehallVersion: "test",
      schemaVersion: currentSchemaVersion(),
      logger,
    });

    const target = await database();
    const archiver = new PostgresArchiver({ databaseUrl: target.url });
    expect(await archiver.isEmpty()).toBe(true);
    await restoreBackup({
      input: output,
      backupKeys,
      database: archiver,
      filesDir: path.join(dir, "restored-files"),
      force: false,
      knownSchemaVersions: [currentSchemaVersion()],
      logger,
    });
    expect(await archiver.isEmpty()).toBe(false);

    const targetPool = createDatabasePool({ connectionString: target.url, applicationName: "pagehall-test" });
    try {
      const settings = await targetPool.query("select scope_id, key, value, locked from setting_values");
      expect(settings.rows).toEqual([
        { scope_id: scopeId, key: "locale.language", value: "de", locked: true },
      ]);
      const blobs = await targetPool.query<{ content: Buffer }>("select content from test_blobs");
      expect(blobs.rows[0]?.content.equals(secret)).toBe(true);
      const migrations = await targetPool.query(
        'select count(*)::int as count from "drizzle"."__drizzle_migrations"',
      );
      expect(migrations.rows[0]?.count).toBeGreaterThan(0);
    } finally {
      await targetPool.end();
    }

    await expect(
      restoreBackup({
        input: output,
        backupKeys,
        database: archiver,
        filesDir: path.join(dir, "other-files"),
        force: false,
        knownSchemaVersions: [currentSchemaVersion()],
        logger,
      }),
    ).rejects.toThrow("the database is not empty");

    await restoreBackup({
      input: output,
      backupKeys,
      database: archiver,
      filesDir: path.join(dir, "other-files"),
      force: true,
      knownSchemaVersions: [currentSchemaVersion()],
      logger,
    });
  });
});
