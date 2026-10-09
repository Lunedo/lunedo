import pg from "pg";
import { describe, expect, it } from "vitest";
import { knownSchemaVersions } from "../database/migrate.js";
import { createMigratedDatabase, testDatabaseBaseUrl } from "./database.js";

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

describe.skipIf(!baseUrl)("createMigratedDatabase", () => {
  it("gives every caller its own database with all migrations, also when they start at once", async () => {
    const databases = await Promise.all(
      Array.from({ length: 4 }, () => createMigratedDatabase(baseUrl ?? "", "pagehall_migrated_test")),
    );
    try {
      expect(new Set(databases.map((database) => database.name)).size).toBe(4);
      for (const database of databases) {
        expect(await appliedMigrations(database.url)).toBe(knownSchemaVersions().length);
      }
    } finally {
      for (const database of databases) await database.drop();
    }
    for (const database of databases) expect(await exists(database.name)).toBe(false);
  });
});
