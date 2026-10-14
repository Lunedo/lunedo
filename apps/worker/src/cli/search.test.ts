import { randomUUID } from "node:crypto";
import { createDatabasePool, createLogger, type DatabasePool, runMigrations } from "@pagehall/server";
import {
  createTemporaryDatabase,
  type TemporaryDatabase,
  testDatabaseBaseUrl,
} from "@pagehall/server/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rebuildSearchIndex, searchIndexStatus } from "./search.js";

const baseUrl = testDatabaseBaseUrl();
const DATABASE_HOOK_TIMEOUT_MS = 60_000;

describe.skipIf(!baseUrl)("pagehall search rebuild and status", () => {
  let database: TemporaryDatabase;
  let pool: DatabasePool;

  beforeAll(async () => {
    database = await createTemporaryDatabase(baseUrl ?? "", "pagehall_cli_test");
    pool = createDatabasePool({ connectionString: database.url, applicationName: "pagehall-test" });
    await runMigrations(pool, { logger: createLogger({ service: "test", level: "silent" }) });
  }, DATABASE_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await pool?.end();
    await database?.drop();
  }, DATABASE_HOOK_TIMEOUT_MS);

  async function lines(command: (url: string, write: (line: string) => void) => Promise<void>) {
    const written: string[] = [];
    await command(database.url, (line) => written.push(line));
    return written;
  }

  it("queues every page for the worker and reports the progress", async () => {
    const organizationId = randomUUID();
    const spaceId = randomUUID();
    await pool.query("insert into organizations (id, name, slug) values ($1, 'Docs', 'docs')", [
      organizationId,
    ]);
    await pool.query(
      "insert into spaces (id, organization_id, key, name, visibility) values ($1, $2, 'DOCS', 'Docs', 'organization')",
      [spaceId, organizationId],
    );
    await pool.query(
      "insert into tree_items (id, space_id, kind, position, title, mode) values ($1, $2, 'page', 'a', 'Welcome', 'live')",
      [randomUUID(), spaceId],
    );
    await pool.query("delete from search_pending_items");
    await pool.query("update search_index_state set building_since = null");
    expect(await lines(searchIndexStatus)).toEqual([
      "The search index is complete.",
      "Pages waiting for an update: 0.",
    ]);

    const rebuild = await lines(rebuildSearchIndex);
    expect(rebuild[0]).toBe("Rebuilding the search index: 1 pages and blog posts are queued for the worker.");
    expect(await lines(searchIndexStatus)).toEqual([
      "The search index is being built: 0 of 1 pages done.",
      "Pages waiting for an update: 1.",
    ]);
  });
});
