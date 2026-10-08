import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export const durabilitySettings = [
  ["fsync", "off"],
  ["synchronous_commit", "off"],
  ["full_page_writes", "off"],
] as const;

export interface Queryable {
  query(sql: string): Promise<{ rows: Record<string, string>[] }>;
}

export async function tuneForTests(client: Queryable): Promise<void> {
  for (const [name, value] of durabilitySettings) await client.query(`ALTER SYSTEM SET ${name} = '${value}'`);
  await client.query("SELECT pg_reload_conf()");
  for (const [name, value] of durabilitySettings) {
    const result = await client.query(`SHOW ${name}`);
    const actual = result.rows[0]?.[name];
    if (actual !== value) throw new Error(`${name} is '${actual}' after the reload, expected '${value}'.`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: node scripts/tune-test-postgres.ts <database url>");
    process.exit(2);
  }
  const { Client } = createRequire(new URL("../packages/server/package.json", import.meta.url))("pg");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await tuneForTests(client);
  } finally {
    await client.end();
  }
}
