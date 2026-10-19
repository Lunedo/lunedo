import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { migrationsFolder, runMigrations } from "../database/migrate.js";
import { createDatabasePool } from "../database/pool.js";
import { createLogger } from "../logging/logger.js";

const CLOSE_ATTEMPTS = 40;
const CLOSE_INTERVAL_MS = 50;

/**
 * Base URL of the PostgreSQL server for integration tests. Tests that need a database are
 * skipped locally without it; in CI a missing URL is an error so that they cannot be skipped silently.
 */
export function testDatabaseBaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const url = env.PAGEHALL_TEST_DATABASE_URL?.trim();
  if (!url && env.CI) throw new Error("PAGEHALL_TEST_DATABASE_URL must be set in CI");
  return url || undefined;
}

export interface TemporaryDatabase {
  url: string;
  name: string;
  drop(): Promise<void>;
}

const RUN_VARIABLE = "PAGEHALL_TEST_DATABASE_RUN";
const drops = new Set<Promise<void>>();

/** Creates an empty database on the test server, or a copy of a template, and returns its URL. */
export async function createTemporaryDatabase(
  baseUrl: string,
  prefix = "pagehall_test",
  template?: string,
): Promise<TemporaryDatabase> {
  const run = process.env[RUN_VARIABLE];
  const name = `${prefix}_${run ? `${run}_` : ""}${Date.now()}_${randomBytes(4).toString("hex")}`;
  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  try {
    await admin.query(`create database "${name}"${template ? ` template "${template}"` : ""}`);
  } finally {
    await admin.end();
  }
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    name,
    async drop() {
      const client = new pg.Client({ connectionString: baseUrl });
      await client.connect();
      try {
        for (let attempt = 0; attempt < CLOSE_ATTEMPTS; attempt += 1) {
          const open = await client.query<{ count: number }>(
            "select count(*)::int as count from pg_stat_activity where datname = $1",
            [name],
          );
          if ((open.rows[0]?.count ?? 0) === 0) break;
          await new Promise((resolve) => setTimeout(resolve, CLOSE_INTERVAL_MS));
        }
      } catch (error) {
        await client.end();
        throw error;
      }
      const removal = client
        .query(`drop database if exists "${name}" with (force)`)
        .then(() => undefined)
        .finally(() => client.end());
      if (!run) return removal;
      const pending = removal.catch(() => undefined);
      drops.add(pending);
      void pending.finally(() => drops.delete(pending));
    },
  };
}

export async function settleDatabaseDrops(): Promise<void> {
  await Promise.all([...drops]);
}

export function startDatabaseRun(baseUrl: string): () => Promise<void> {
  const run = `run${randomBytes(4).toString("hex")}`;
  process.env[RUN_VARIABLE] = run;
  return async () => {
    await settleDatabaseDrops();
    const client = new pg.Client({ connectionString: baseUrl });
    await client.connect();
    try {
      const left = await client.query<{ datname: string }>(
        "select datname from pg_database where position($1 in datname) > 0",
        [`_${run}_`],
      );
      for (const row of left.rows)
        await client.query(`drop database if exists "${row.datname}" with (force)`);
    } finally {
      await client.end();
    }
  };
}

const TEMPLATE_LOCK = "pagehall.test-template";
const templates = new Map<string, Promise<string>>();

function migrationsFingerprint(): string {
  const hash = createHash("sha256");
  const files = [
    ...readdirSync(migrationsFolder)
      .filter((file) => file.endsWith(".sql"))
      .sort(),
    "meta/_journal.json",
  ];
  for (const file of files) hash.update(file).update(readFileSync(path.join(migrationsFolder, file)));
  return hash.digest("hex").slice(0, 16);
}

function databaseUrl(baseUrl: string, name: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

async function buildTemplate(baseUrl: string): Promise<string> {
  const name = `pagehall_template_${migrationsFingerprint()}`;
  const building = `${name}_building`;
  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  try {
    const exists = async () =>
      (await admin.query("select 1 from pg_database where datname = $1", [name])).rowCount === 1;
    if (await exists()) return name;
    await admin.query("select pg_advisory_lock(hashtext($1))", [`${TEMPLATE_LOCK}:${name}`]);
    if (!(await exists())) {
      await admin.query(`drop database if exists "${building}" with (force)`);
      await admin.query(`create database "${building}"`);
      const pool = createDatabasePool({
        connectionString: databaseUrl(baseUrl, building),
        applicationName: "pagehall-test-template",
      });
      try {
        await runMigrations(pool, { logger: createLogger({ service: "test", level: "silent" }) });
      } finally {
        await pool.end();
      }
      await admin.query(`alter database "${building}" rename to "${name}"`);
    }
    return name;
  } finally {
    await admin.end();
  }
}

export async function createMigratedDatabase(
  baseUrl: string,
  prefix = "pagehall_test",
): Promise<TemporaryDatabase> {
  let template = templates.get(baseUrl);
  if (!template) {
    template = buildTemplate(baseUrl);
    templates.set(baseUrl, template);
    template.catch(() => templates.delete(baseUrl));
  }
  return createTemporaryDatabase(baseUrl, prefix, await template);
}
