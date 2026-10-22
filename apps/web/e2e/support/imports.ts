import { execFile } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
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
export const FOLDER_EXPORT_TEMPLATE = path.join(STATE_DIR, FOLDER_EXPORT);
export const PEOPLE_EXPORT_TEMPLATE = path.join(STATE_DIR, "people-export.zip");
export const REIMPORT_BEFORE_TEMPLATE = path.join(STATE_DIR, "reimport-before.zip");
export const REIMPORT_AFTER_TEMPLATE = path.join(STATE_DIR, "reimport-after.zip");

const WRITE_EXPORT = `
const { writeFileSync } = await import("node:fs");
const { createCsvExport, createXmlExport, peopleExport, reimportAfter, reimportBefore, syntheticExport } =
  await import("@lunedo/server/testing");
const [format, target, kind] = process.argv.slice(1);
const models = { people: peopleExport, reimportBefore, reimportAfter };
const model = (models[kind] ?? syntheticExport)();
writeFileSync(target, format === "csv" ? createCsvExport(model) : createXmlExport(model));
`;

export async function writeSyntheticExport(
  format: "xml" | "csv",
  target: string,
  kind: "synthetic" | "people" | "reimportBefore" | "reimportAfter" = "synthetic",
): Promise<void> {
  await run(process.execPath, ["--input-type=module", "-e", WRITE_EXPORT, format, target, kind], {
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

export function placeFolderExport(organizationId: string, template: string = FOLDER_EXPORT_TEMPLATE): string {
  const directory = path.join(IMPORT_DIR, organizationId);
  mkdirSync(directory, { recursive: true });
  copyFileSync(template, path.join(directory, FOLDER_EXPORT));
  return directory;
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

export async function runSql(sql: string, values: unknown[] = []): Promise<void> {
  const client = new pg.Client({ connectionString: readState().databaseUrl });
  await client.connect();
  try {
    await client.query(sql, values);
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

const WRITE_FILES = `
const { writeFileSync } = await import("node:fs");
const [kind, target] = process.argv.slice(1);
if (kind === "markdown") {
  const { createZip } = await import("@lunedo/server/testing");
  writeFileSync(
    target,
    createZip([
      { name: "handbook/README.md", data: "# Team handbook\\n\\nStart with [the laptop setup](setup/laptop.md).\\n" },
      {
        name: "handbook/setup/laptop.md",
        data: "---\\ntitle: Laptop setup\\ntags: [it]\\n---\\nInstall the tools.\\n\\n<div>raw html</div>\\n",
      },
    ]),
  );
} else {
  const { Document, HeadingLevel, Packer, Paragraph } = await import("docx");
  const document = new Document({
    title: "Security policy",
    sections: [
      {
        children: [
          new Paragraph({ text: "Applies to everyone." }),
          new Paragraph({ text: "Passwords", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: "Use a password manager." }),
          new Paragraph({ text: "Devices", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: "Lock the screen." }),
        ],
      },
    ],
  });
  writeFileSync(target, await Packer.toBuffer(document));
}
`;

export async function writeSourceFile(kind: "markdown" | "word", target: string): Promise<void> {
  await run(process.execPath, ["--input-type=module", "-e", WRITE_FILES, kind, target], {
    cwd: serverRoot,
    timeout: 30_000,
  });
}
