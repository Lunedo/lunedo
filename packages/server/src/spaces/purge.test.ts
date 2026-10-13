import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal } from "../accounts/principal.js";
import { createLogger } from "../logging/logger.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { applyTrashRetention } from "./jobs.js";
import { TrashService } from "./trash.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("permanent deletion", () => {
  let test: TestServices;
  const { organization, member, space } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function setup() {
    const org = await organization();
    const editor = await member(org.id);
    const wiki = await space(org.id, editor);
    const as = accountPrincipal(editor);
    const page = (title: string, parentId: string | null = null) =>
      test.services.tree.create(as, wiki.id, { kind: "page", title, mode: "live", placement: { parentId } });
    return { org, as, wiki, page };
  }

  async function archivedProject() {
    const context = await setup();
    const project = await context.page("Project X");
    const budget = await context.page("Budget", project.id);
    const line = await context.page("Line", budget.id);
    await test.services.archive.archive(context.as, project.id);
    const own = await test.services.trash.deleteItem(context.as, budget.id);
    const parent = await test.services.trash.deleteItem(context.as, project.id);
    return { ...context, project, budget, line, own, parent };
  }

  async function stored(ids: string[]): Promise<number> {
    const found = await test.database.execute<{ count: string }>(
      sql`select count(*) as count from tree_items where id = any(${sql.param(ids)}::uuid[])`,
    );
    return Number(found.rows[0]?.count);
  }

  async function due(entryIds: string[]) {
    await test.database.execute(sql`
      update trash_entries set stage = 2, stage_two_at = now() - interval '1000 days'
      where id = any(${sql.param(entryIds)}::uuid[])`);
  }

  async function keepLegacyArchiveReference(itemIds: string[], archivedRootId: string) {
    await test.database.execute(sql`
      update tree_items set archived_root_id = ${archivedRootId} where id = any(${sql.param(itemIds)}::uuid[])`);
  }

  it("takes a page deleted from an archive out of the archive, and restore puts it back", async () => {
    const { project, budget, line } = await archivedProject();
    const rows = await test.database.execute<{ id: string; archived_root_id: string | null }>(
      sql`select id, archived_root_id from tree_items where id in (${project.id}, ${budget.id}, ${line.id})`,
    );
    expect(Object.fromEntries(rows.rows.map((row) => [row.id, row.archived_root_id]))).toEqual({
      [project.id]: project.id,
      [budget.id]: null,
      [line.id]: null,
    });

    const other = await archivedProject();
    await test.services.trash.restore(other.as, other.parent.id);
    await test.services.trash.restore(other.as, other.own.id);
    const back = await test.database.execute<{ parent_id: string | null; archived_root_id: string | null }>(
      sql`select parent_id, archived_root_id from tree_items where id = ${other.budget.id}`,
    );
    expect(back.rows[0]).toEqual({ parent_id: other.project.id, archived_root_id: other.project.id });
  });

  it("deletes an archive immediately after a page was deleted from it", async () => {
    const { as, project, budget, line, own, parent } = await archivedProject();
    await test.services.trash.deleteImmediately(as, parent.id, "Erasure request");
    expect(await test.services.trash.get(parent.id)).toBeNull();
    expect(await test.services.trash.get(own.id)).toBeNull();
    expect(await stored([project.id, budget.id, line.id])).toBe(0);
  });

  it("deletes an archive whose retention ended after a page was deleted from it", async () => {
    const { project, budget, line, own, parent } = await archivedProject();
    await due([parent.id]);
    expect((await test.services.trash.applyRetention()).failed).toBe(0);
    expect(await test.services.trash.get(parent.id)).toBeNull();
    expect(await test.services.trash.get(own.id)).toBeNull();
    expect(await stored([project.id, budget.id, line.id])).toBe(0);
  });

  it("deletes both entries after the trash was emptied", async () => {
    const { as, wiki, project, budget, line, own, parent } = await archivedProject();
    expect(await test.services.trash.empty(as, wiki.id)).toBe(2);
    await due([own.id, parent.id]);
    expect((await test.services.trash.applyRetention()).failed).toBe(0);
    expect(await test.services.trash.get(parent.id)).toBeNull();
    expect(await test.services.trash.get(own.id)).toBeNull();
    expect(await stored([project.id, budget.id, line.id])).toBe(0);
  });

  it("deletes an item that a row of another trash entry still marks as its archive", async () => {
    const { as, project, budget, line, own, parent } = await archivedProject();
    await keepLegacyArchiveReference([budget.id, line.id], project.id);
    await test.database.execute(sql`
      update tree_items set restore_parent_id = null where id = ${budget.id}`);

    await test.services.trash.deleteImmediately(as, parent.id, "Erasure request");
    expect(await stored([project.id])).toBe(0);
    const left = await test.database.execute<{ archived_root_id: string | null }>(
      sql`select archived_root_id from tree_items where id in (${budget.id}, ${line.id})`,
    );
    expect(left.rows).toEqual([{ archived_root_id: null }, { archived_root_id: null }]);
    expect(await test.services.trash.get(own.id)).not.toBeNull();
  });

  it("deletes a space across batches when rows of different entries reference each other", async () => {
    const { wiki, project, budget, line, as } = await archivedProject();
    await keepLegacyArchiveReference([budget.id, line.id], project.id);
    const extra = await Promise.all(
      ["One", "Two", "Three"].map((title) =>
        test.services.tree.create(as, wiki.id, {
          kind: "page",
          title,
          mode: "live",
          placement: { parentId: null },
        }),
      ),
    );
    const entry = await test.services.trash.deleteSpace(as, wiki.id, wiki.name);
    await test.database.execute(
      sql`update trash_entries set stage_two_at = now() - interval '1000 days' where id = ${entry.id}`,
    );

    const result = await test.services.trash.applyRetention({ batchSize: 1 });
    expect(result.failed).toBe(0);
    const spaces = await test.database.execute<{ count: string }>(
      sql`select count(*) as count from spaces where id = ${wiki.id}`,
    );
    expect(Number(spaces.rows[0]?.count)).toBe(0);
    expect(await stored([project.id, budget.id, line.id, ...extra.map((page) => page.id)])).toBe(0);
  });

  it("repairs archive references of pages that were deleted from an archive", async () => {
    const { project, budget, line } = await archivedProject();
    const kept = await archivedProject();
    await keepLegacyArchiveReference([budget.id, line.id], project.id);

    const migration = readFileSync(
      fileURLToPath(new URL("../../drizzle/0050_purge_without_archive_reference.sql", import.meta.url)),
      "utf8",
    );
    const repair = migration.split("--> statement-breakpoint").at(-1) ?? "";
    await test.pool.query(repair);

    const rows = await test.database.execute<{ id: string; archived_root_id: string | null }>(sql`
      select id, archived_root_id from tree_items
      where id in (${project.id}, ${budget.id}, ${line.id}, ${kept.project.id})`);
    expect(Object.fromEntries(rows.rows.map((row) => [row.id, row.archived_root_id]))).toEqual({
      [project.id]: project.id,
      [budget.id]: null,
      [line.id]: null,
      [kept.project.id]: kept.project.id,
    });
    const archive = await setup();
    const root = await archive.page("Root");
    const child = await archive.page("Child", root.id);
    await test.services.archive.archive(archive.as, root.id);
    await test.pool.query(repair);
    const untouched = await test.database.execute<{ archived_root_id: string | null }>(
      sql`select archived_root_id from tree_items where id = ${child.id}`,
    );
    expect(untouched.rows[0]?.archived_root_id).toBe(root.id);
  });

  describe("with a failing entry", () => {
    async function failOnDelete(itemId: string) {
      const name = `fail_${randomBytes(4).toString("hex")}`;
      await test.pool.query(`
        create function ${name}() returns trigger language plpgsql as $$
        begin
          if old.id = '${itemId}' then raise exception 'blocked for the test'; end if;
          return old;
        end $$`);
      await test.pool.query(
        `create trigger ${name} before delete on tree_items for each row execute function ${name}()`,
      );
      return async () => {
        await test.pool.query(`drop trigger ${name} on tree_items`);
        await test.pool.query(`drop function ${name}()`);
      };
    }

    it("keeps the failing entry for the next run and deletes a due entry of another organization", async () => {
      const lines: string[] = [];
      const logger = createLogger({
        service: "test",
        level: "warn",
        destination: { write: (line: string) => lines.push(line) },
      });
      const trash = new TrashService({
        database: test.database,
        audit: test.services.audit,
        settings: test.settings,
        people: test.services.people,
        activity: test.services.activity,
        authorization: test.services.authorization,
        logger,
      });
      const blocked = await setup();
      const secret = await blocked.page("Confidential salaries");
      const failing = await test.services.trash.deleteItem(blocked.as, secret.id);
      const other = await setup();
      const old = await other.page("Old minutes");
      const ok = await test.services.trash.deleteItem(other.as, old.id);
      await due([ok.id]);
      await test.database.execute(
        sql`update trash_entries set purging = true, stage_two_at = null where id = ${failing.id}`,
      );
      const cleanup = await failOnDelete(secret.id);
      try {
        const result = await trash.applyRetention();
        expect(result.failed).toBe(1);
        expect(result.purged).toBeGreaterThanOrEqual(1);
      } finally {
        await cleanup();
      }
      expect(await stored([old.id])).toBe(0);
      expect(await stored([secret.id])).toBe(1);
      const logged = lines.join("\n");
      expect(logged).toContain(failing.id);
      expect(logged).toContain(blocked.wiki.id);
      expect(logged).not.toContain("Confidential salaries");
      expect(logged).not.toContain("blocked for the test");

      await trash.applyRetention();
      expect(await stored([secret.id])).toBe(0);
      expect(await test.services.trash.get(failing.id)).toBeNull();
    });

    it("removes expired drafts and orphaned files even when the trash step fails", async () => {
      const context = await setup();
      const page = await context.page("Policy");
      await test.database.execute(sql`
        insert into discarded_drafts (id, item_id, title, document, schema_version, reason, expires_at)
        values (${uuidv7()}, ${page.id}, 'Old draft', '{}'::jsonb, 1, 'discarded', now() - interval '1 day')`);
      const file = await test.services.files.write(Readable.from([randomBytes(64)]), {
        name: "left.bin",
        maxBytes: 1000,
      });
      await test.database.execute(sql`update stored_files set state = 'orphaned' where id = ${file.id}`);
      const doomed = await context.page("Doomed");
      const entry = await test.services.trash.deleteItem(context.as, doomed.id);
      await due([entry.id]);

      const logger = createLogger({ service: "test", level: "silent" });
      await expect(
        applyTrashRetention(test.services, { signal: AbortSignal.abort(), logger }),
      ).rejects.toThrow();
      const drafts = await test.database.execute<{ count: string }>(
        sql`select count(*) as count from discarded_drafts where item_id = ${page.id}`,
      );
      expect(Number(drafts.rows[0]?.count)).toBe(0);
      const files = await test.database.execute<{ count: string }>(
        sql`select count(*) as count from stored_files where id = ${file.id}`,
      );
      expect(Number(files.rows[0]?.count)).toBe(0);
    });
  });
});
