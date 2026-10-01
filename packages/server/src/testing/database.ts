import { randomBytes } from "node:crypto";
import pg from "pg";

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

/** Creates an empty database on the test server and returns its URL. */
export async function createTemporaryDatabase(
  baseUrl: string,
  prefix = "pagehall_test",
): Promise<TemporaryDatabase> {
  const name = `${prefix}_${Date.now()}_${randomBytes(4).toString("hex")}`;
  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  try {
    await admin.query(`create database "${name}"`);
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
        await client.query(`drop database if exists "${name}" with (force)`);
      } finally {
        await client.end();
      }
    },
  };
}
