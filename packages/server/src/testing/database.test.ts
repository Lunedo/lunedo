import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { knownSchemaVersions } from "../database/migrate.js";
import {
  createMigratedDatabase,
  createTemporaryDatabase,
  settleDatabaseDrops,
  startDatabaseRun,
  testDatabaseBaseUrl,
} from "./database.js";

const baseUrl = testDatabaseBaseUrl();

async function appliedMigrations(url: string): Promise<number> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const result = await client.query<{ count: string }>(
      'select count(*) as count from "drizzle"."__drizzle_migrations"',
    );
    return Number(result.rows[0]?.count ?? 0);
  } finally {
    await client.end();
  }
}

async function exists(name: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: baseUrl });
  await client.connect();
  try {
    return (await client.query("select 1 from pg_database where datname = $1", [name])).rowCount === 1;
  } finally {
    await client.end();
  }
}

function restoreRun(previous: string | undefined) {
  if (previous === undefined) delete process.env.LUNEDO_TEST_DATABASE_RUN;
  else process.env.LUNEDO_TEST_DATABASE_RUN = previous;
}

describe.skipIf(!baseUrl)("createMigratedDatabase", () => {
  const dropped: string[] = [];
  const left: { name: string; finishRun: () => Promise<void> }[] = [];

  afterAll(async () => {
    await settleDatabaseDrops();
    for (const run of left) await run.finishRun();
    for (const name of [...dropped, ...left.map((run) => run.name)]) expect(await exists(name)).toBe(false);
  });

  it("gives every caller its own database with all migrations, also when they start at once", async () => {
    const databases = await Promise.all(
      Array.from({ length: 4 }, () => createMigratedDatabase(baseUrl ?? "", "lunedo_migrated_test")),
    );
    try {
      expect(new Set(databases.map((database) => database.name)).size).toBe(4);
      for (const database of databases) {
        expect(await appliedMigrations(database.url)).toBe(knownSchemaVersions().length);
      }
    } finally {
      await Promise.all(databases.map((database) => database.drop()));
      dropped.push(...databases.map((database) => database.name));
    }
  });

  it("tags the databases of a run so that the end of the run removes those still left", async () => {
    const previous = process.env.LUNEDO_TEST_DATABASE_RUN;
    const finishRun = startDatabaseRun(baseUrl ?? "");
    const run = process.env.LUNEDO_TEST_DATABASE_RUN ?? "";
    try {
      const database = await createTemporaryDatabase(baseUrl ?? "", "lunedo_left_test");
      expect(database.name).toContain(`_${run}_`);
      left.push({ name: database.name, finishRun });
    } finally {
      restoreRun(previous);
    }
  });
});
