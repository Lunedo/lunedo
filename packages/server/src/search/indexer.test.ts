import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DocumentJson } from "@pagehall/editor-schema";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal } from "../accounts/principal.js";
import { createDatabase } from "../database/database.js";
import { migrationsFolder, runMigrations } from "../database/migrate.js";
import { createDatabasePool } from "../database/pool.js";
import { createLogger } from "../logging/logger.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { SearchIndexer } from "./indexer.js";
import { PostgresSearchAdapter } from "./postgres-adapter.js";
import { searchRequest } from "./search.testing.js";

const baseUrl = testDatabaseBaseUrl();
const SEARCH_MIGRATION = "0056_search_index";

function body(text: string): DocumentJson {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

function migrationsBefore(tag: string): string {
  const folder = mkdtempSync(path.join(tmpdir(), "pagehall-migrations-"));
  cpSync(migrationsFolder, folder, { recursive: true });
  const journalPath = path.join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
  const index = journal.entries.findIndex((entry) => entry.tag === tag);
  if (index === -1) throw new Error(`Migration ${tag} does not exist`);
  journal.entries = journal.entries.slice(0, index);
  writeFileSync(journalPath, JSON.stringify(journal));
  return folder;
}

describe.skipIf(!baseUrl)("search indexer", () => {
  let test: TestServices;
  const fixtures = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function setup(pages = 1) {
    const org = await fixtures.organization();
    const memberId = await fixtures.member(org.id, "member", "Member");
    const space = await fixtures.space(org.id, memberId, { visibility: "organization" });
    const member = accountPrincipal(memberId);
    const word = `w${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    const ids: string[] = [];
    for (let index = 0; index < pages; index++) {
      const created = await test.services.tree.create(member, space.id, {
        kind: "page",
        title: `Page ${index}`,
        mode: "live",
        placement: { parentId: null },
        document: body(`${word} number ${index}`),
      });
      ids.push(created.id);
    }
    return { org, space, member, memberId, word, ids };
  }

  async function found(context: Awaited<ReturnType<typeof setup>>, query = context.word) {
    const result = await test.services.search.search(
      context.member,
      context.org.id,
      searchRequest(query, { limit: 50 }),
    );
    return result.results.map((hit) => hit.itemId).sort();
  }

  it("keeps one copy of every chunk when two nodes update the index at the same time", async () => {
    const context = await setup(30);
    const adapter = new PostgresSearchAdapter();
    const first = new SearchIndexer({ database: test.database, adapter });
    const otherNode = createDatabasePool({
      connectionString: test.url,
      applicationName: "pagehall-test-node",
    });
    const second = new SearchIndexer({ database: createDatabase(otherNode), adapter });
    const [a, b] = await Promise.all([first.drain(), second.drain()]).finally(() => otherNode.end());
    expect(a.items + b.items).toBeGreaterThanOrEqual(30);
    const counts = await test.pool.query<{ item_id: string; count: number }>(
      `select item_id, count(*)::int as count from search_chunks where item_id = any($1::uuid[]) group by item_id`,
      [context.ids],
    );
    expect(counts.rows).toHaveLength(30);
    expect(counts.rows.every((row) => row.count === 1)).toBe(true);
    const pending = await test.pool.query(
      "select count(*)::int as count from search_pending_items where item_id = any($1::uuid[])",
      [context.ids],
    );
    expect(pending.rows[0]?.count).toBe(0);
  });

  it("leaves the item pending when indexing fails halfway and indexes it on the next run", async () => {
    const context = await setup(1);
    const adapter = new PostgresSearchAdapter();
    const crashing = new SearchIndexer({
      database: test.database,
      adapter: {
        ...adapter,
        search: adapter.search.bind(adapter),
        removeItem: adapter.removeItem.bind(adapter),
        updateAccess: adapter.updateAccess.bind(adapter),
        indexedItemsOfSpace: adapter.indexedItemsOfSpace.bind(adapter),
        replaceItem: async (executor, item) => {
          await adapter.replaceItem(executor, item);
          throw new Error("Node stopped");
        },
      },
    });
    const crashed = await crashing.drain();
    expect(crashed.failed).toBeGreaterThan(0);
    expect(await found(context)).toEqual([]);
    const pending = await test.pool.query<{ attempts: number }>(
      "select attempts from search_pending_items where item_id = $1",
      [context.ids[0]],
    );
    expect(pending.rows[0]?.attempts).toBe(1);
    await test.pool.query("update search_pending_items set due_at = now() where item_id = $1", [
      context.ids[0],
    ]);
    await test.services.search.indexer.drain();
    expect(await found(context)).toEqual(context.ids);
  });

  it("retries a failing item later without holding up the others", async () => {
    const context = await setup(3);
    const [broken, ...healthy] = context.ids;
    await test.pool.query("update page_documents set schema_version = 9999 where item_id = $1", [broken]);
    const result = await test.services.search.indexer.drain();
    expect(result.failed).toBe(1);
    expect(result.nextDueAt?.getTime()).toBeGreaterThan(Date.now());
    expect(await found(context)).toEqual(healthy.sort());
    const pending = await test.pool.query<{ attempts: number; later: boolean }>(
      "select attempts, due_at > now() as later from search_pending_items where item_id = $1",
      [broken],
    );
    expect(pending.rows[0]).toEqual({ attempts: 1, later: true });
  });

  it("waits for pages being indexed before it updates the access of their space", async () => {
    const context = await setup(1);
    await test.services.search.indexer.drain();
    await test.pool.query("insert into search_pending_spaces (space_id) values ($1) on conflict do nothing", [
      context.space.id,
    ]);
    const client = new pg.Client({ connectionString: test.url });
    await client.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock_shared(hashtextextended($1, 0))", [
        `pagehall.search.space:${context.space.id}`,
      ]);
      const blocked = await test.services.search.indexer.drain();
      expect(blocked.spaces).toBe(0);
      expect(blocked.nextDueAt).not.toBeNull();
      await client.query("commit");
    } finally {
      await client.end();
    }
    const done = await test.services.search.indexer.drain();
    expect(done.spaces).toBeGreaterThanOrEqual(1);
    const pending = await test.pool.query(
      "select count(*)::int as count from search_pending_spaces where space_id = $1",
      [context.space.id],
    );
    expect(pending.rows[0]?.count).toBe(0);
  });

  it("rebuilds the whole index on request and reports the progress meanwhile", async () => {
    const context = await setup(2);
    await test.services.search.indexer.drain();
    await test.pool.query("delete from search_chunks where item_id = $1", [context.ids[0]]);
    await test.pool.query("update search_chunks set body = 'stale' where item_id = $1", [context.ids[1]]);
    const marked = await test.services.search.indexer.requestRebuild();
    expect(marked).toBeGreaterThanOrEqual(2);
    const during = await test.services.search.search(
      context.member,
      context.org.id,
      searchRequest(context.word),
    );
    expect(during.index).toEqual({ building: true });
    expect(await test.services.search.indexer.state()).toMatchObject({ building: true, total: marked });
    await test.services.search.indexer.drain();
    expect(await found(context)).toEqual([...context.ids].sort());
    const after = await test.services.search.indexer.state();
    expect(after.building).toBe(false);
  });

  it("uses the content language of the page, then of the space, then of the organization", async () => {
    const context = await setup(1);
    const [pageId] = context.ids;
    await test.services.documents.replace(context.member, pageId ?? "", body(`Das Haus ${context.word}`));
    await test.pool.query("update search_pending_items set due_at = now()");
    await test.services.search.indexer.drain();
    const config = async () =>
      (
        await test.pool.query<{ config: string; language: string }>(
          "select config, language from search_chunks where item_id = $1 limit 1",
          [pageId],
        )
      ).rows[0];
    expect(await config()).toEqual({ config: "english", language: "en" });
    expect(await found(context, "Häuser")).toEqual([]);

    await test.pool.query(
      `insert into setting_values (id, level, scope_id, key, value) values ($1, 'organization', $2, 'locale.language', '"de"')`,
      [randomUUID(), context.org.id],
    );
    await test.services.search.indexer.drain();
    expect(await config()).toEqual({ config: "german", language: "de" });
    expect(await found(context, "Häuser")).toEqual(context.ids);

    await test.pool.query(
      `insert into setting_values (id, level, scope_id, key, value) values ($1, 'space', $2, 'content.language', '"other"')`,
      [randomUUID(), context.space.id],
    );
    await test.services.search.indexer.drain();
    expect(await config()).toEqual({ config: "simple", language: "other" });

    await test.pool.query("update tree_items set content_language = 'fr' where id = $1", [pageId]);
    await test.services.search.indexer.drain();
    expect(await config()).toEqual({ config: "french", language: "fr" });
  });
});

describe.skipIf(!baseUrl)("search index after the migration", () => {
  let test: TestServices;
  const organizationId = randomUUID();
  const accountId = randomUUID();
  const itemIds = [randomUUID(), randomUUID()];

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "", {
      beforeMigrations: async (url) => {
        const pool = createDatabasePool({ connectionString: url, applicationName: "pagehall-test" });
        try {
          await runMigrations(pool, {
            logger: createLogger({ service: "test", level: "silent" }),
            folder: migrationsBefore(SEARCH_MIGRATION),
          });
          const spaceId = randomUUID();
          await pool.query("insert into organizations (id, name, slug) values ($1, 'Existing', $2)", [
            organizationId,
            `existing-${organizationId.slice(0, 8)}`,
          ]);
          await pool.query(
            "insert into accounts (id, type, state, email, name) values ($1, 'standard', 'active', $2, 'Existing member')",
            [accountId, `${accountId}@example.org`],
          );
          await pool.query(
            "insert into memberships (id, organization_id, account_id, kind) values ($1, $2, $3, 'member')",
            [randomUUID(), organizationId, accountId],
          );
          await pool.query(
            "insert into spaces (id, organization_id, key, name, visibility) values ($1, $2, 'EXIST', 'Existing', 'organization')",
            [spaceId, organizationId],
          );
          for (const [index, itemId] of itemIds.entries()) {
            await pool.query(
              "insert into tree_items (id, space_id, kind, position, title, mode) values ($1, $2, 'page', $3, $4, 'live')",
              [itemId, spaceId, `a${index}`, `Existing page ${index}`],
            );
            await pool.query(
              "insert into page_documents (item_id, state, snapshot, schema_version) values ($1, '\\x00', $2, 1)",
              [itemId, body("written before search existed")],
            );
          }
        } finally {
          await pool.end();
        }
      },
    });
  });

  afterAll(async () => {
    await test?.close();
  });

  it("fills the index in the background after the first start and says so until it is done", async () => {
    const before = await test.services.search.search(
      accountPrincipal(accountId),
      organizationId,
      searchRequest("existed"),
    );
    expect(before.results).toEqual([]);
    expect(before.index).toEqual({ building: true });
    expect(await test.services.search.indexer.state()).toMatchObject({ building: true, total: 2, done: 0 });
    await test.services.search.indexer.drain();
    const after = await test.services.search.search(
      accountPrincipal(accountId),
      organizationId,
      searchRequest("existed"),
    );
    expect(after.results.map((hit) => hit.itemId).sort()).toEqual([...itemIds].sort());
    expect(after.index.building).toBe(false);
  });
});
