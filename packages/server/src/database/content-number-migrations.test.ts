import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "../logging/logger.js";
import { createTemporaryDatabase, type TemporaryDatabase, testDatabaseBaseUrl } from "../testing/database.js";
import { runMigrations } from "./migrate.js";
import { createDatabasePool, type DatabasePool } from "./pool.js";

const baseUrl = testDatabaseBaseUrl();
const migrations = fileURLToPath(new URL("../../drizzle", import.meta.url));
const logger = createLogger({ service: "test", level: "silent" });

function foldersBefore(tag: string): string {
  const folder = mkdtempSync(path.join(tmpdir(), "lunedo-migrations-"));
  cpSync(migrations, folder, { recursive: true });
  const journalFile = path.join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalFile, "utf8")) as { entries: { tag: string }[] };
  const index = journal.entries.findIndex((entry) => entry.tag === tag);
  if (index < 0) throw new Error(`Unknown migration ${tag}`);
  journal.entries = journal.entries.slice(0, index);
  writeFileSync(journalFile, JSON.stringify(journal));
  return folder;
}

describe.skipIf(!baseUrl)("content number migration", () => {
  let database: TemporaryDatabase | undefined;
  let pool: DatabasePool | undefined;
  let folder: string | undefined;

  afterEach(async () => {
    await pool?.end();
    await database?.drop();
    if (folder) rmSync(folder, { recursive: true, force: true });
    pool = undefined;
    database = undefined;
    folder = undefined;
  });

  async function migratedBefore(tag: string): Promise<DatabasePool> {
    database = await createTemporaryDatabase(baseUrl as string);
    pool = createDatabasePool({ connectionString: database.url, applicationName: "lunedo-test", max: 12 });
    folder = foldersBefore(tag);
    await runMigrations(pool, { logger, folder });
    return pool;
  }

  async function space(target: DatabasePool): Promise<string> {
    const organizationId = randomUUID();
    await target.query("insert into organizations (id, name, slug) values ($1, 'Team', $2)", [
      organizationId,
      `team-${organizationId.slice(0, 8)}`,
    ]);
    const id = randomUUID();
    await target.query(
      "insert into spaces (id, organization_id, key, name, visibility) values ($1, $2, 'NUM', 'Numbers', 'private')",
      [id, organizationId],
    );
    return id;
  }

  async function item(target: DatabasePool, spaceId: string, id: string, kind = "page"): Promise<void> {
    await target.query(
      "insert into tree_items (id, space_id, kind, position, title) values ($1, $2, $3, $4, $5)",
      [id, spaceId, kind, `a${id.slice(-6)}`, `Item ${id.slice(-4)}`],
    );
  }

  it("numbers existing items in creation order from 1000 and continues after the highest number", async () => {
    const target = await migratedBefore("0104_content_numbers");
    const spaceId = await space(target);
    const ordered = [
      "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f0001",
      "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f0002",
      "01929b1e-7c3b-7d2e-9f4b-3c2d1e0f0003",
      "01929b1f-0000-7d2e-9f4b-3c2d1e0f0004",
    ];
    await item(target, spaceId, ordered[2] as string, "folder");
    await item(target, spaceId, ordered[0] as string);
    await item(target, spaceId, ordered[3] as string, "whiteboard");
    await item(target, spaceId, ordered[1] as string, "blogPost");

    await runMigrations(target, { logger });

    const numbered = await target.query<{ id: string; number: string }>(
      "select id, number from tree_items order by number",
    );
    expect(numbered.rows.map((row) => row.id)).toEqual(ordered);
    expect(numbered.rows.map((row) => Number(row.number))).toEqual([1000, 1001, 1002, 1003]);

    const created = randomUUID();
    await item(target, spaceId, created);
    const next = await target.query<{ number: string }>("select number from tree_items where id = $1", [
      created,
    ]);
    expect(Number(next.rows[0]?.number)).toBe(1004);
  });

  it("starts at 1000 on an empty instance", async () => {
    const target = await migratedBefore("0104_content_numbers");
    await runMigrations(target, { logger });
    const spaceId = await space(target);
    const id = randomUUID();
    await item(target, spaceId, id);
    const row = await target.query<{ number: string }>("select number from tree_items where id = $1", [id]);
    expect(Number(row.rows[0]?.number)).toBe(1000);
  });

  it("gives concurrently created items unique numbers and never reuses a deleted one", async () => {
    const target = await migratedBefore("0104_content_numbers");
    await runMigrations(target, { logger });
    const spaceId = await space(target);
    const ids = Array.from({ length: 40 }, () => randomUUID());
    await Promise.all(ids.map((id) => item(target, spaceId, id)));
    const numbers = await target.query<{ number: string }>("select number from tree_items");
    const values = numbers.rows.map((row) => Number(row.number));
    expect(new Set(values).size).toBe(40);
    expect(Math.min(...values)).toBe(1000);
    expect(Math.max(...values)).toBe(1039);

    await target.query("delete from tree_items where number = 1039");
    const later = randomUUID();
    await item(target, spaceId, later);
    const row = await target.query<{ number: string }>("select number from tree_items where id = $1", [
      later,
    ]);
    expect(Number(row.rows[0]?.number)).toBe(1040);
    await expect(target.query("update tree_items set number = 1000 where id = $1", [later])).rejects.toThrow(
      /tree_items_number_unique/,
    );
  });
});
