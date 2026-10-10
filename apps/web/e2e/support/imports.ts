import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, type Page } from "@playwright/test";
import pg from "pg";
import { readState, STATE_DIR } from "./environment.js";

const run = promisify(execFile);
const serverRoot = fileURLToPath(new URL("../../../../packages/server", import.meta.url));

export const IMPORT_DIR = path.join(STATE_DIR, "import");
export const FOLDER_EXPORT = "space-export.zip";

const WRITE_EXPORT = `
const { writeFileSync } = await import("node:fs");
const { createCsvExport, createXmlExport, syntheticExport } = await import("@pagehall/server/testing");
const [format, target] = process.argv.slice(1);
const model = syntheticExport();
writeFileSync(target, format === "csv" ? createCsvExport(model) : createXmlExport(model));
`;

export async function writeSyntheticExport(format: "xml" | "csv", target: string): Promise<void> {
  await run(process.execPath, ["--input-type=module", "-e", WRITE_EXPORT, format, target], {
    cwd: serverRoot,
    timeout: 30_000,
  });
}

export async function importState(importId: string): Promise<string> {
  const client = new pg.Client({ connectionString: readState().databaseUrl });
  await client.connect();
  try {
    const result = await client.query<{ state: string }>("select state from imports where id = $1", [
      importId,
    ]);
    return result.rows[0]?.state ?? "";
  } finally {
    await client.end();
  }
}

export async function updateImportRow(importId: string, sql: string, values: unknown[] = []): Promise<void> {
  const client = new pg.Client({ connectionString: readState().databaseUrl });
  await client.connect();
  try {
    await client.query(sql, [importId, ...values]);
  } finally {
    await client.end();
  }
}

export async function waitForImportState(importId: string, state: string): Promise<void> {
  await expect.poll(() => importState(importId), { timeout: 60_000 }).toBe(state);
}

export function importIdFrom(page: Page): string {
  const match = /\/imports\/([0-9a-f-]{36})/.exec(page.url());
  if (!match?.[1]) throw new Error(`No import in ${page.url()}`);
  return match[1];
}
