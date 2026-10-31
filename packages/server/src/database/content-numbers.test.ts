import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "../logging/logger.js";
import { createTemporaryDatabase, type TemporaryDatabase, testDatabaseBaseUrl } from "../testing/database.js";
import { runMigrations } from "./migrate.js";
import { createDatabasePool, type DatabasePool } from "./pool.js";

const baseUrl = testDatabaseBaseUrl();
const logger = createLogger({ service: "test", level: "silent" });

describe.skipIf(!baseUrl)("content numbers", () => {
  let database: TemporaryDatabase | undefined;
  let pool: DatabasePool | undefined;

  afterEach(async () => {
    await pool?.end();
    await database?.drop();
    pool = undefined;
    database = undefined;
  });

  async function migrated(): Promise<DatabasePool> {
    database = await createTemporaryDatabase(baseUrl as string);
    pool = createDatabasePool({ connectionString: database.url, applicationName: "lunedo-test", max: 12 });
    await runMigrations(pool, { logger });
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

  it("starts at 1000 on an empty instance", async () => {
    const target = await migrated();
    const spaceId = await space(target);
    const id = randomUUID();
    await item(target, spaceId, id);
    const row = await target.query<{ number: string }>("select number from tree_items where id = $1", [id]);
    expect(Number(row.rows[0]?.number)).toBe(1000);
  });

  it("gives concurrently created items unique numbers and never reuses a deleted one", async () => {
    const target = await migrated();
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
