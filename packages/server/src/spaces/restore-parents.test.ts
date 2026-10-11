import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import type { TrashEntry } from "./trash.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("restoring below restricted pages", () => {
  let test: TestServices;
  const { organization, member, space } = spaceFixtures(() => test);
  const anyEntry = async (_entry: TrashEntry) => true;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function canView(accountId: string, itemId: string): Promise<boolean> {
    const decision = await test.services.authorization.explain(
      accountPrincipal(accountId),
      "item.view",
      { type: "item", id: itemId },
      { fresh: true },
    );
    return decision.allowed;
  }

  async function setup() {
    const org = await organization();
    const editor = await member(org.id, "member", "Edda Editor");
    const colleague = await member(org.id, "member", "Carl Colleague");
    const reader = await member(org.id, "member", "Rita Reader");
    const wiki = await space(org.id, editor, {
      grants: [
        { principalKind: "account", principalId: colleague, role: "editor" },
        { principalKind: "account", principalId: reader, role: "reader" },
      ],
    });
    const as = accountPrincipal(editor);
    const page = (title: string, parentId: string | null = null) =>
      test.services.tree.create(as, wiki.id, { kind: "page", title, mode: "live", placement: { parentId } });
    const hr = await page("HR");
    await test.services.pageAccess.change(as, hr.id, [{ action: "restrict", kind: "view" }]);
    return { org, editor, colleague, reader, wiki, as, page, hr };
  }

  async function parentOf(itemId: string): Promise<string | null> {
    const found = await test.database.execute<{ parent_id: string | null }>(
      sql`select parent_id from tree_items where id = ${itemId}`,
    );
    return found.rows[0]?.parent_id ?? null;
  }

  it("refuses to restore a page below a restricted parent in the trash, then restores it with its parents", async () => {
    const { reader, as, page, hr } = await setup();
    const salaries = await page("Salaries", hr.id);
    const own = await test.services.trash.deleteItem(as, salaries.id);
    const parent = await test.services.trash.deleteItem(as, hr.id);

    await expect(test.services.trash.restore(as, own.id, { mayRestore: anyEntry })).rejects.toMatchObject({
      code: "restrictedParentInTrash",
      details: { formerParent: { id: hr.id, title: "HR" }, parentEntries: 1 },
    });
    expect(await test.services.trash.get(own.id)).not.toBeNull();
    expect(await canView(reader, salaries.id)).toBe(false);

    expect(
      await test.services.trash.restore(as, own.id, { withParents: true, mayRestore: anyEntry }),
    ).toEqual({ itemId: salaries.id, parentId: hr.id, parentEntries: 1 });
    expect(await test.services.trash.get(parent.id)).toBeNull();
    expect(await parentOf(hr.id)).toBeNull();
    expect(await canView(reader, salaries.id)).toBe(false);
    expect(await canView(reader, hr.id)).toBe(false);
  });

  it("refuses to bring back an archived page below a restricted parent in the trash, then restores the parent with it", async () => {
    const { reader, as, page, hr } = await setup();
    const salaries = await page("Salaries", hr.id);
    await test.services.archive.archive(as, salaries.id);
    const own = await test.services.trash.deleteItem(as, salaries.id);
    await test.services.trash.deleteItem(as, hr.id);
    expect(await test.services.trash.restore(as, own.id)).toEqual({
      itemId: salaries.id,
      parentId: null,
      parentEntries: 0,
    });
    expect(await canView(reader, salaries.id)).toBe(false);

    await expect(
      test.services.archive.unarchive(as, salaries.id, { mayRestore: anyEntry }),
    ).rejects.toMatchObject({ code: "restrictedParentInTrash", details: { parentEntries: 1 } });
    expect(await canView(reader, salaries.id)).toBe(false);

    expect(
      await test.services.archive.unarchive(as, salaries.id, { withParents: true, mayRestore: anyEntry }),
    ).toEqual({ parentId: hr.id, parentEntries: 1 });
    expect(await parentOf(salaries.id)).toBe(hr.id);
    expect(await canView(reader, salaries.id)).toBe(false);
  });

  it("restores the whole chain when the restricted page is two levels up", async () => {
    const { reader, as, page, hr } = await setup();
    const team = await page("Team", hr.id);
    const salaries = await page("Salaries", team.id);
    const own = await test.services.trash.deleteItem(as, salaries.id);
    const middle = await test.services.trash.deleteItem(as, team.id);
    const top = await test.services.trash.deleteItem(as, hr.id);

    await expect(test.services.trash.restore(as, own.id, { mayRestore: anyEntry })).rejects.toMatchObject({
      code: "restrictedParentInTrash",
      details: { formerParent: { id: team.id, title: "Team" }, parentEntries: 2 },
    });
    expect(
      await test.services.trash.restore(as, own.id, { withParents: true, mayRestore: anyEntry }),
    ).toEqual({ itemId: salaries.id, parentId: team.id, parentEntries: 2 });
    expect(await test.services.trash.get(middle.id)).toBeNull();
    expect(await test.services.trash.get(top.id)).toBeNull();
    expect(await parentOf(team.id)).toBe(hr.id);
    expect(await canView(reader, salaries.id)).toBe(false);
  });

  it("refuses a restore that would lose the restriction of an ancestor two levels up that is still in the tree", async () => {
    const { reader, as, page, hr } = await setup();
    const team = await page("Team", hr.id);
    const salaries = await page("Salaries", team.id);
    const own = await test.services.trash.deleteItem(as, salaries.id);
    await test.services.trash.deleteItem(as, team.id);

    await expect(test.services.trash.restore(as, own.id, { mayRestore: anyEntry })).rejects.toMatchObject({
      code: "restrictedParentInTrash",
      details: { parentEntries: 1 },
    });
    await test.services.trash.restore(as, own.id, { withParents: true, mayRestore: anyEntry });
    expect(await parentOf(salaries.id)).toBe(team.id);
    expect(await parentOf(team.id)).toBe(hr.id);
    expect(await canView(reader, salaries.id)).toBe(false);
  });

  it("names the former parent only to people who may view it", async () => {
    const { org, colleague, as, page, hr } = await setup();
    const salaries = await page("Salaries", hr.id);
    const own = await test.services.trash.deleteItem(as, salaries.id);
    await test.services.trash.deleteItem(as, hr.id);

    const administrator = accountPrincipal(org.owner);
    const refused = test.services.trash.restore(administrator, own.id, { mayRestore: anyEntry });
    await expect(refused).rejects.toMatchObject({
      code: "restrictedParentInTrash",
      message: expect.not.stringContaining("HR"),
      details: { formerParent: null, parentEntries: 1 },
    });
    await expect(refused).rejects.toMatchObject({
      message: expect.stringContaining("ask a space or organization administrator"),
    });

    const notAllowed = async (entry: TrashEntry) =>
      test.services.trash.accessible(accountPrincipal(colleague), entry.id);
    await expect(
      test.services.trash.restore(accountPrincipal(colleague), own.id, {
        withParents: true,
        mayRestore: notAllowed,
      }),
    ).rejects.toMatchObject({
      code: "restrictedParentInTrash",
      details: { formerParent: null, parentEntries: 0 },
    });
    expect(await test.services.trash.get(own.id)).not.toBeNull();

    expect(
      await test.services.trash.restore(administrator, own.id, { withParents: true, mayRestore: anyEntry }),
    ).toMatchObject({ parentId: hr.id, parentEntries: 1 });
  });

  it("restores at the top level when no inherited restriction is lost", async () => {
    const { reader, as, page } = await setup();
    const open = await page("Open");
    const notes = await page("Notes", open.id);
    await test.services.archive.archive(as, notes.id);
    const own = await test.services.trash.deleteItem(as, notes.id);
    await test.services.trash.deleteItem(as, open.id);
    await test.services.trash.restore(as, own.id);
    expect(await test.services.archive.unarchive(as, notes.id)).toEqual({ parentId: null, parentEntries: 0 });
    expect(await parentOf(notes.id)).toBeNull();
    expect(await canView(reader, notes.id)).toBe(true);
  });

  it("takes archived descendants into the trash entry of a deleted page and brings them back archived", async () => {
    const { reader, wiki, as, page, hr } = await setup();
    const team = await page("Team", hr.id);
    const old = await page("Old salaries", team.id);
    const below = await page("Below", old.id);
    await test.services.archive.archive(as, old.id);

    const entry = await test.services.trash.deleteItem(as, hr.id);
    expect(entry.descendants).toBe(3);
    expect((await test.services.archive.list(as, wiki.id)).map((item) => item.id)).not.toContain(old.id);
    await expect(test.services.archive.unarchive(as, old.id)).rejects.toMatchObject({ code: "notArchived" });

    await test.services.trash.restore(as, entry.id);
    expect((await test.services.archive.list(as, wiki.id)).map((item) => item.id)).toContain(old.id);
    expect(await test.services.archive.unarchive(as, old.id)).toEqual({
      parentId: team.id,
      parentEntries: 0,
    });
    expect(await parentOf(below.id)).toBe(old.id);
    expect(await canView(reader, below.id)).toBe(false);
  });

  it("repairs archived pages that stayed outside the trash entry of their deleted parent", async () => {
    const { as, page, hr } = await setup();
    const old = await page("Old salaries", hr.id);
    const below = await page("Below", old.id);
    await test.services.archive.archive(as, old.id);
    const entry = await test.services.trash.deleteItem(as, hr.id);
    await test.database.execute(sql`
      update tree_items set trash_entry_id = null where id in (${old.id}, ${below.id})`);
    await test.database.execute(sql`update trash_entries set descendants = 0 where id = ${entry.id}`);

    const migration = readFileSync(
      fileURLToPath(new URL("../../drizzle/0049_trash_archived_descendants.sql", import.meta.url)),
      "utf8",
    );
    for (const statement of migration.split("--> statement-breakpoint")) await test.pool.query(statement);

    const repaired = await test.database.execute<{ trash_entry_id: string | null }>(
      sql`select trash_entry_id from tree_items where id in (${old.id}, ${below.id})`,
    );
    expect(repaired.rows.map((row) => row.trash_entry_id)).toEqual([entry.id, entry.id]);
    expect((await test.services.trash.get(entry.id))?.descendants).toBe(2);
  });

  it("deletes the older trash entries of pages below an entry that is deleted for good", async () => {
    const { as, page, hr } = await setup();
    const team = await page("Team", hr.id);
    const salaries = await page("Salaries", team.id);
    const own = await test.services.trash.deleteItem(as, salaries.id);
    const middle = await test.services.trash.deleteItem(as, team.id);
    const top = await test.services.trash.deleteItem(as, hr.id);

    await test.services.trash.deleteImmediately(as, top.id, "Erasure request");
    for (const entry of [top, middle, own]) expect(await test.services.trash.get(entry.id)).toBeNull();
    const left = await test.database.execute<{ count: string }>(
      sql`select count(*) as count from tree_items where id in (${hr.id}, ${team.id}, ${salaries.id})`,
    );
    expect(Number(left.rows[0]?.count)).toBe(0);
  });

  it("deletes the trash entries below an entry whose retention ended, even when they are not due", async () => {
    const { as, page, hr } = await setup();
    const salaries = await page("Salaries", hr.id);
    const own = await test.services.trash.deleteItem(as, salaries.id);
    const parent = await test.services.trash.deleteItem(as, hr.id);
    await test.database.execute(
      sql`update trash_entries set stage = 2, stage_two_at = now() - interval '1000 days' where id = ${parent.id}`,
    );

    await test.services.trash.applyRetention();
    expect(await test.services.trash.get(parent.id)).toBeNull();
    expect(await test.services.trash.get(own.id)).toBeNull();
    const audited = await test.database.execute<{ target_id: string }>(
      sql`select target_id from audit_events where name = 'trash.deletedPermanently'
        and target_id in (${own.id}, ${parent.id})`,
    );
    expect(audited.rows.map((row) => row.target_id).sort()).toEqual([own.id, parent.id].sort());
  });

  it("does not restore an entry below one whose permanent deletion has started", async () => {
    const { as, page, hr } = await setup();
    const salaries = await page("Salaries", hr.id);
    const own = await test.services.trash.deleteItem(as, salaries.id);
    const parent = await test.services.trash.deleteItem(as, hr.id);
    await test.database.execute(sql`update trash_entries set purging = true where id = ${parent.id}`);

    await expect(
      test.services.trash.restore(as, own.id, { withParents: true, mayRestore: anyEntry }),
    ).rejects.toMatchObject({ code: "restrictedParentInTrash", details: { parentEntries: 0 } });
    await test.services.trash.applyRetention();
    expect(await test.services.trash.get(own.id)).toBeNull();
  });
});
