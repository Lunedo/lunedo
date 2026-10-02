import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { uuidv7 } from "@pagehall/shared";
import { afterEach, describe, expect, it } from "vitest";
import { formatKeyEntry, parseKeyRing } from "../crypto/key-ring.js";
import { currentSchemaVersion, runMigrations } from "../database/migrate.js";
import { createDatabasePool } from "../database/pool.js";
import { createLogger } from "../logging/logger.js";
import { createTemporaryDatabase, type TemporaryDatabase, testDatabaseBaseUrl } from "../testing/database.js";
import { createBackup, restoreBackup } from "./archive.js";
import { type DatabaseArchiver, libpqEnvironment, PostgresArchiver } from "./postgres.js";

const baseUrl = testDatabaseBaseUrl();
const logger = createLogger({ service: "test", level: "silent" });
const hasTools = spawnSync("pg_dump", ["--version"]).status === 0;
if (process.env.CI && !hasTools) throw new Error("pg_dump must be installed in CI");

/** Passes on the first bytes of a dump, then fails like a connection lost in the middle of a restore. */
function failAfter(limit: number): Transform {
  let size = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      callback(size > limit ? new Error("injected failure") : null, chunk);
    },
  });
}

describe("libpqEnvironment", () => {
  const base = "postgres://user%40x:p%40ss@db.example:6543/pagehall";

  it("passes credentials through the environment", () => {
    expect(libpqEnvironment(base)).toEqual({
      PGHOST: "db.example",
      PGPORT: "6543",
      PGUSER: "user@x",
      PGPASSWORD: "p@ss",
      PGDATABASE: "pagehall",
    });
  });

  it("strips the brackets of IPv6 hosts", () => {
    expect(libpqEnvironment("postgres://u:p@[::1]:5432/pagehall").PGHOST).toBe("::1");
    expect(libpqEnvironment("postgres://u:p@[2001:db8::5]/pagehall").PGHOST).toBe("2001:db8::5");
  });

  it.each([
    ["sslmode=disable", "disable"],
    ["sslmode=prefer", "verify-full"],
    ["sslmode=require", "verify-full"],
    ["sslmode=verify-ca", "verify-full"],
    ["sslmode=verify-full", "verify-full"],
    ["sslmode=no-verify", "require"],
    ["ssl=true", "verify-full"],
    ["ssl=1", "verify-full"],
    ["sslrootcert=/run/secrets/ca.pem", "verify-full"],
    ["sslcert=/run/secrets/client.pem&sslkey=/run/secrets/client.key", "verify-full"],
    ["sslkey=/run/secrets/client.key", "verify-full"],
    ["sslmode=disable&sslrootcert=/run/secrets/ca.pem", "disable"],
    ["sslmode=no-verify&sslrootcert=/run/secrets/ca.pem", "require"],
    ["uselibpqcompat=true&sslmode=disable", "disable"],
    ["uselibpqcompat=true&sslmode=prefer", "require"],
    ["uselibpqcompat=true&sslmode=prefer&sslrootcert=/run/secrets/ca.pem", "require"],
    ["uselibpqcompat=true&sslmode=require", "require"],
    ["uselibpqcompat=true&sslmode=require&sslrootcert=/run/secrets/ca.pem", "verify-ca"],
    ["uselibpqcompat=true&sslmode=verify-ca&sslrootcert=/run/secrets/ca.pem", "verify-ca"],
    ["uselibpqcompat=true&sslmode=verify-full", "verify-full"],
    ["uselibpqcompat=true&sslmode=no-verify", "verify-full"],
    ["uselibpqcompat=true&sslrootcert=/run/secrets/ca.pem", "verify-full"],
    ["uselibpqcompat=true&sslcert=/run/secrets/client.pem&sslkey=/run/secrets/client.key", "verify-full"],
    ["uselibpqcompat=true&ssl=true", "verify-full"],
  ])("verifies TLS at least like node-pg for %s", (query, mode) => {
    expect(libpqEnvironment(`${base}?${query}`).PGSSLMODE).toBe(mode);
  });

  it("leaves the libpq default without TLS parameters", () => {
    expect(libpqEnvironment(base).PGSSLMODE).toBeUndefined();
    expect(libpqEnvironment(`${base}?uselibpqcompat=true`).PGSSLMODE).toBeUndefined();
  });

  it("passes certificate files and the application name", () => {
    const env = libpqEnvironment(
      `${base}?sslmode=verify-full&sslrootcert=/run/secrets/ca.pem&sslcert=/run/secrets/client.pem&sslkey=/run/secrets/client.key&application_name=pagehall`,
    );
    expect(env).toMatchObject({
      PGSSLMODE: "verify-full",
      PGSSLROOTCERT: "/run/secrets/ca.pem",
      PGSSLCERT: "/run/secrets/client.pem",
      PGSSLKEY: "/run/secrets/client.key",
      PGAPPNAME: "pagehall",
    });
  });

  it.each([
    ["options=-c%20search_path%3Dx", "the backup tools cannot use the URL parameter options"],
    ["host=/var/run/postgresql", "the backup tools cannot use the URL parameter host"],
    ["sslmode=allow", "the backup tools do not support sslmode=allow"],
    ["ssl=false", "the backup tools do not support ssl=false; use sslmode=disable instead"],
  ])("rejects %s with a message naming the parameter", (query, message) => {
    expect(() => libpqEnvironment(`${base}?${query}`)).toThrow(`PAGEHALL_DATABASE_URL: ${message}`);
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
    const secret = randomBytes(512 * 1024);
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
      masterKeys: [],
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
      masterKeys: null,
      database: archiver,
      filesDir: path.join(dir, "restored-files"),
      force: false,
      knownSchemaVersions: [currentSchemaVersion()],
      logger,
    });
    expect(await archiver.isEmpty()).toBe(false);

    const targetPool = createDatabasePool({ connectionString: target.url, applicationName: "pagehall-test" });
    try {
      const settings = await targetPool.query(
        "select scope_id, key, value, locked from setting_values where scope_id = $1",
        [scopeId],
      );
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
        masterKeys: null,
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
      masterKeys: null,
      database: archiver,
      filesDir: path.join(dir, "other-files"),
      force: true,
      knownSchemaVersions: [currentSchemaVersion()],
      logger,
    });

    const before = createDatabasePool({ connectionString: target.url, applicationName: "pagehall-test" });
    try {
      await before.query("create table test_existing (id int primary key)");
      await before.query("insert into test_existing values (1)");
    } finally {
      await before.end();
    }
    const failures: [DatabaseArchiver, RegExp][] = [
      [
        {
          dump: () => archiver.dump(),
          isEmpty: () => archiver.isEmpty(),
          restore: (dump, options) => archiver.restore(dump.pipe(failAfter(64 * 1024)), options),
        },
        /^injected failure$/,
      ],
      [
        {
          dump: () => archiver.dump(),
          isEmpty: async () => true,
          restore: (dump) => archiver.restore(dump, { replaceExisting: false }),
        },
        /^psql exited with code 3: .*already exists/s,
      ],
    ];
    for (const [failing, message] of failures) {
      await expect(
        restoreBackup({
          input: output,
          backupKeys,
          masterKeys: null,
          database: failing,
          filesDir: path.join(dir, "other-files"),
          force: true,
          knownSchemaVersions: [currentSchemaVersion()],
          logger,
        }),
      ).rejects.toThrow(message);
      const after = createDatabasePool({ connectionString: target.url, applicationName: "pagehall-test" });
      try {
        expect((await after.query("select id from test_existing")).rows).toEqual([{ id: 1 }]);
        const blobs = await after.query<{ content: Buffer }>("select content from test_blobs");
        expect(blobs.rows[0]?.content.equals(secret)).toBe(true);
      } finally {
        await after.end();
      }
    }
  });
});
