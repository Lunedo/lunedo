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

async function applied(client: Queryable): Promise<string | null> {
  for (const [name, value] of durabilitySettings) {
    const result = await client.query(`SHOW ${name}`);
    const actual = result.rows[0]?.[name];
    if (actual !== value) return `${name} is '${actual}', expected '${value}'`;
  }
  return null;
}

export async function tuneForTests(client: Queryable, attempts = 50, delayMs = 100): Promise<void> {
  for (const [name, value] of durabilitySettings) await client.query(`ALTER SYSTEM SET ${name} = '${value}'`);
  await client.query("SELECT pg_reload_conf()");
  let problem = await applied(client);
  for (let attempt = 1; problem !== null && attempt < attempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    problem = await applied(client);
  }
  if (problem !== null)
    throw new Error(`The server did not apply the settings after the reload: ${problem}.`);
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
