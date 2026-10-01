import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, inject, it } from "vitest";
import { createLogger } from "../logging/logger.js";
import { createTemporaryDatabase, type TemporaryDatabase, testDatabaseBaseUrl } from "../testing/database.js";
import { currentSchemaVersion, migrationStatus, runMigrations } from "./migrate.js";
import { createDatabasePool, type DatabasePool } from "./pool.js";

const baseUrl = testDatabaseBaseUrl();
const logger = createLogger({ service: "test", level: "silent" });

describe.skipIf(!baseUrl)("migrations", () => {
  let database: TemporaryDatabase | undefined;
  let pool: DatabasePool | undefined;

  afterEach(async () => {
    await pool?.end();
    await database?.drop();
    pool = undefined;
    database = undefined;
  });

  async function freshDatabase(): Promise<DatabasePool> {
    database = await createTemporaryDatabase(baseUrl as string);
    pool = createDatabasePool({ connectionString: database.url, applicationName: "pagehall-test" });
    return pool;
  }

  async function appliedMigrations(target: DatabasePool) {
    const result = await target.query<{ hash: string }>('select hash from "drizzle"."__drizzle_migrations"');
    return result.rows.map((row) => row.hash);
  }

  it("applies all migrations to an empty database and reports the state", async () => {
    const target = await freshDatabase();
    expect((await migrationStatus(target)).upToDate).toBe(false);
    await runMigrations(target, { logger });
    const status = await migrationStatus(target);
    expect(status).toMatchObject({ upToDate: true });
    expect(status.applied).toBe(status.expected);
    expect(currentSchemaVersion()).toMatch(/^\d{4}_/);
  });

  it("does nothing when the database is up to date", async () => {
    const target = await freshDatabase();
    await runMigrations(target, { logger });
    const before = await appliedMigrations(target);
    await runMigrations(target, { logger });
    expect(await appliedMigrations(target)).toEqual(before);
  });

  it("runs once when several callers in one process start at the same time", async () => {
    const target = await freshDatabase();
    await Promise.all(Array.from({ length: 4 }, () => runMigrations(target, { logger })));
    const hashes = await appliedMigrations(target);
    expect(new Set(hashes).size).toBe(hashes.length);
    expect(hashes.length).toBe((await migrationStatus(target)).expected);
  });

  it("runs once when two processes start at the same time", async () => {
    const target = await freshDatabase();
    const script = fileURLToPath(new URL("../testing/migrate-process.ts", import.meta.url));
    const runProcess = () =>
      new Promise<number>((resolve, reject) => {
        const loader = new URL("../testing/ts-resolve.mjs", import.meta.url).href;
        const child = spawn(process.execPath, ["--import", loader, script], {
          env: { ...process.env, MIGRATE_DATABASE_URL: database?.url },
          stdio: ["ignore", "ignore", "inherit"],
        });
        child.once("error", reject);
        child.once("exit", (code) => resolve(code ?? 1));
      });
    expect(await Promise.all([runProcess(), runProcess()])).toEqual([0, 0]);
    const hashes = await appliedMigrations(target);
    expect(new Set(hashes).size).toBe(hashes.length);
    expect(hashes.length).toBe((await migrationStatus(target)).expected);
  });
});

describe.skipIf(!baseUrl)("test database", () => {
  it("is migrated once per test run", async () => {
    const target = createDatabasePool({
      connectionString: inject("databaseUrl"),
      applicationName: "pagehall-test",
    });
    try {
      expect((await migrationStatus(target)).upToDate).toBe(true);
    } finally {
      await target.end();
    }
  });
});
