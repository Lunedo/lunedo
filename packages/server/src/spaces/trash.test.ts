import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal } from "../accounts/principal.js";
import { SettingBelowMinimumError } from "../settings/service.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import {
  trashFirstStageDaysSetting,
  trashFirstStageMinimumSetting,
  trashSecondStageDaysSetting,
} from "./settings.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("trash and archive", () => {
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
    const editorId = await member(org.id);
    const readerId = await member(org.id);
    const created = await space(org.id, editorId, {
      grants: [{ principalKind: "account", principalId: readerId, role: "reader" }],
    });
    return {
      org,
      admin: accountPrincipal(org.owner),
      editor: accountPrincipal(editorId),
      reader: accountPrincipal(readerId),
      space: created,
    };
  }

  async function item(
    context: Awaited<ReturnType<typeof setup>>,
    title: string,
    parentId: string | null = null,
    kind: "page" | "folder" = "page",
  ) {
    return test.services.tree.create(context.editor, context.space.id, {
      kind,
      title,
      mode: "live",
      placement: { parentId },
    });
  }

  async function rootTitles(context: Awaited<ReturnType<typeof setup>>, parentId: string | null = null) {
    return (await test.services.tree.children(context.editor, context.space.id, parentId)).items.map(
      (entry) => entry.title,
    );
  }

  async function allowed(principal: ReturnType<typeof accountPrincipal>, action: string, id: string) {
    const type = action.startsWith("space.") ? "space" : "item";
    return (await test.services.authorization.explain(principal, action, { type, id })).allowed;
  }

  describe("deleting", () => {
    it("moves an item with its descendants into the trash as one entry and restores it with undo", async () => {
      const context = await setup();
      const folder = await item(context, "Folder", null, "folder");
      const child = await item(context, "Child", folder.id);
      await item(context, "Grandchild", child.id);
      const entry = await test.services.trash.deleteItem(context.editor, folder.id);
      expect(entry).toMatchObject({ title: "Folder", descendants: 2, stage: 1, itemKind: "folder" });
      expect(entry.deletedBy?.id).toBe(context.editor.type === "account" ? context.editor.id : null);
      expect(await rootTitles(context)).not.toContain("Folder");
      expect(await allowed(context.editor, "item.view", child.id)).toBe(false);
      expect(await allowed(context.editor, "item.edit", child.id)).toBe(false);
      expect(
        (await test.services.trash.listSpace(context.editor, context.space.id)).map((listed) => listed.id),
      ).toEqual([entry.id]);

      await test.services.trash.restore(context.editor, entry.id);
      expect(await rootTitles(context)).toContain("Folder");
      expect(await rootTitles(context, child.id)).toEqual(["Grandchild"]);
      expect(await test.services.trash.listSpace(context.editor, context.space.id)).toEqual([]);
    });

    it("restores to the old place, or to the top level when that place is gone", async () => {
      const context = await setup();
      const parent = await item(context, "Parent");
      const first = await item(context, "First", parent.id);
      await item(context, "Second", parent.id);
      const entry = await test.services.trash.deleteItem(context.editor, first.id);
      expect(await rootTitles(context, parent.id)).toEqual(["Second"]);
      expect(await test.services.trash.restore(context.editor, entry.id)).toEqual({
        itemId: first.id,
        parentId: parent.id,
      });
      expect(await rootTitles(context, parent.id)).toEqual(["First", "Second"]);

      const again = await test.services.trash.deleteItem(context.editor, first.id);
      const parentEntry = await test.services.trash.deleteItem(context.editor, parent.id);
      expect(await test.services.trash.restore(context.editor, again.id)).toEqual({
        itemId: first.id,
        parentId: null,
      });
      expect(await rootTitles(context)).toContain("First");
      expect(parentEntry.descendants).toBe(1);
    });

    it("shows links to pages in the trash as in trash to readers who could open them", async () => {
      const context = await setup();
      const target = await item(context, "Printer list");
      await test.services.trash.deleteItem(context.editor, target.id);
      const link = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "pageLink", attrs: { pageId: target.id, spaceId: null, title: null } }],
          },
        ],
      };
      const forReader = await test.services.documents.references(context.reader, link as never);
      expect(forReader.pages[target.id]).toMatchObject({
        title: "Printer list",
        inTrash: true,
        accessible: false,
      });
      const outsider = accountPrincipal(await member(context.org.id));
      const forOutsider = await test.services.documents.references(outsider, link as never);
      expect(forOutsider.pages[target.id]).toMatchObject({ title: "", inTrash: false, accessible: false });
    });

    it("refuses to delete the overview page", async () => {
      const context = await setup();
      await expect(
        test.services.trash.deleteItem(context.editor, context.space.overviewItemId ?? ""),
      ).rejects.toMatchObject({ code: "overviewPage" });
    });

    it("lets editors delete and restore, but only space admins empty the trash", async () => {
      const context = await setup();
      const page = await item(context, "Page");
      expect(await allowed(context.editor, "item.delete", page.id)).toBe(true);
      expect(await allowed(context.reader, "item.delete", page.id)).toBe(false);
      expect(await allowed(context.reader, "space.trash", context.space.id)).toBe(false);
      expect(await allowed(context.editor, "space.trash", context.space.id)).toBe(true);
      const plainEditorId = await member(context.org.id);
      await test.services.spacePermissions.apply(context.editor, context.space.id, {
        action: "grant",
        principalKind: "account",
        principalId: plainEditorId,
        role: "editor",
      });
      expect(await allowed(accountPrincipal(plainEditorId), "space.manage", context.space.id)).toBe(false);
      expect(await allowed(context.editor, "space.manage", context.space.id)).toBe(true);
    });
  });

  describe("stages", () => {
    it("moves emptied entries to the second stage, restorable only by organization administrators", async () => {
      const context = await setup();
      const page = await item(context, "Old");
      const entry = await test.services.trash.deleteItem(context.editor, page.id);
      expect(await test.services.trash.empty(context.editor, context.space.id)).toBe(1);
      expect(await test.services.trash.listSpace(context.editor, context.space.id)).toEqual([]);
      const listed = await test.services.trash.listOrganization(context.org.id);
      expect(listed.find((candidate) => candidate.id === entry.id)?.stage).toBe(2);
      expect(
        (
          await test.services.authorization.explain(context.editor, "organization.trash.manage", {
            type: "organization",
            id: context.org.id,
          })
        ).allowed,
      ).toBe(false);
      expect(
        (
          await test.services.authorization.explain(context.admin, "organization.trash.manage", {
            type: "organization",
            id: context.org.id,
          })
        ).allowed,
      ).toBe(true);
      const events = await test.database.execute<{ name: string }>(
        sql`select name from audit_events where target_id in (${entry.id}, ${context.space.id})`,
      );
      expect(events.rows.map((row) => row.name)).toEqual(
        expect.arrayContaining(["trash.itemsDeleted", "trash.movedToStageTwo", "trash.emptied"]),
      );
    });

    it("moves expired entries to the second stage and deletes them for good after it", async () => {
      const context = await setup();
      await test.settings.set(
        trashFirstStageDaysSetting,
        { organization: context.org.id },
        "organization",
        10,
      );
      await test.settings.set(
        trashSecondStageDaysSetting,
        { organization: context.org.id },
        "organization",
        5,
      );
      const page = await item(context, "Expiring");
      const child = await item(context, "Child", page.id);
      await test.services.documents.addLabel(context.editor, child.id, "gone");
      const entry = await test.services.trash.deleteItem(context.editor, page.id);
      await test.services.trash.applyRetention();
      expect((await test.services.trash.get(entry.id))?.stage).toBe(1);
      await test.database.execute(
        sql`update trash_entries set deleted_at = now() - interval '11 days' where id = ${entry.id}`,
      );
      await test.services.trash.applyRetention();
      expect((await test.services.trash.get(entry.id))?.stage).toBe(2);
      await test.database.execute(
        sql`update trash_entries set stage_two_at = now() - interval '6 days' where id = ${entry.id}`,
      );
      await test.services.trash.applyRetention();
      expect(await test.services.trash.get(entry.id)).toBeNull();
      for (const table of ["tree_items", "page_documents", "page_versions", "page_labels", "page_links"]) {
        const column = table === "tree_items" ? "id" : table === "page_links" ? "source_item_id" : "item_id";
        const left = await test.database.execute<{ count: string }>(
          sql`select count(*) as count from ${sql.identifier(table)}
            where ${sql.identifier(column)} in (${page.id}, ${child.id})`,
        );
        expect(Number(left.rows[0]?.count), table).toBe(0);
      }
    });

    it("finishes a permanent deletion that stopped in the middle", async () => {
      const context = await setup();
      const root = await item(context, "Big", null, "folder");
      for (let index = 0; index < 5; index += 1) await item(context, `Child ${index}`, root.id);
      const entry = await test.services.trash.deleteItem(context.editor, root.id);
      await test.services.trash.empty(context.editor, context.space.id);
      await test.database.execute(
        sql`update trash_entries set stage_two_at = now() - interval '100 days' where id = ${entry.id}`,
      );
      const controller = new AbortController();
      let batches = 0;
      const original = test.database.transaction.bind(test.database);
      const spy = (async (work: Parameters<typeof original>[0]) => {
        const result = await original(work);
        batches += 1;
        if (batches === 3) controller.abort();
        return result;
      }) as typeof original;
      test.database.transaction = spy;
      try {
        await expect(
          test.services.trash.applyRetention({ signal: controller.signal, batchSize: 2 }),
        ).rejects.toThrow();
      } finally {
        test.database.transaction = original;
      }
      const remaining = await test.database.execute<{ count: string }>(
        sql`select count(*) as count from tree_items where trash_entry_id = ${entry.id}`,
      );
      expect(Number(remaining.rows[0]?.count)).toBeGreaterThan(0);
      expect(Number(remaining.rows[0]?.count)).toBeLessThan(6);
      await expect(test.services.trash.restore(context.admin, entry.id)).rejects.toMatchObject({
        code: "trashEntryNotFound",
      });
      await test.services.trash.applyRetention();
      expect(await test.services.trash.get(entry.id)).toBeNull();
      const left = await test.database.execute<{ count: string }>(
        sql`select count(*) as count from tree_items where id = ${root.id} or parent_id = ${root.id}`,
      );
      expect(Number(left.rows[0]?.count)).toBe(0);
    });

    it("does not let lower levels undercut the minimum of the instance", async () => {
      const context = await setup();
      await test.settings.set(trashFirstStageMinimumSetting, {}, "instance", 30);
      try {
        await expect(
          test.settings.set(trashFirstStageDaysSetting, { organization: context.org.id }, "organization", 10),
        ).rejects.toBeInstanceOf(SettingBelowMinimumError);
        await expect(
          test.settings.set(
            trashFirstStageDaysSetting,
            { organization: context.org.id, space: context.space.id },
            "space",
            29,
          ),
        ).rejects.toBeInstanceOf(SettingBelowMinimumError);
        await test.settings.set(
          trashFirstStageDaysSetting,
          { organization: context.org.id, space: context.space.id },
          "space",
          31,
        );
        await test.settings.set(trashFirstStageMinimumSetting, {}, "instance", 60);
        expect(
          await test.settings.get(trashFirstStageDaysSetting, {
            organization: context.org.id,
            space: context.space.id,
          }),
        ).toBe(90);
      } finally {
        await test.settings.set(trashFirstStageMinimumSetting, {}, "instance", 1);
      }
    });

    it("deletes at once only with a reason and records it", async () => {
      const context = await setup();
      const page = await item(context, "Personal data");
      const entry = await test.services.trash.deleteItem(context.editor, page.id);
      await expect(
        test.services.trash.deleteImmediately(context.admin, entry.id, "  "),
      ).rejects.toMatchObject({
        code: "reasonRequired",
      });
      expect(await test.services.trash.get(entry.id)).not.toBeNull();
      await test.services.trash.deleteImmediately(context.admin, entry.id, "Erasure request 4711");
      expect(await test.services.trash.get(entry.id)).toBeNull();
      const event = await test.database.execute<{ name: string }>(
        sql`select name from audit_events where target_id = ${entry.id} and name = 'trash.deletedImmediately'`,
      );
      expect(event.rows).toHaveLength(1);
      const left = await test.database.execute<{ count: string }>(
        sql`select count(*) as count from tree_items where id = ${page.id}`,
      );
      expect(Number(left.rows[0]?.count)).toBe(0);
    });
  });

  describe("spaces", () => {
    it("deletes a space only with its name, into the second stage, and restores it", async () => {
      const context = await setup();
      await expect(
        test.services.trash.deleteSpace(context.editor, context.space.id, "wrong"),
      ).rejects.toMatchObject({
        code: "confirmationMismatch",
      });
      const entry = await test.services.trash.deleteSpace(
        context.editor,
        context.space.id,
        context.space.name,
      );
      expect(entry).toMatchObject({ kind: "space", stage: 2 });
      expect(await allowed(context.editor, "space.view", context.space.id)).toBe(false);
      expect(
        (await test.services.spaces.list(context.editor, { organizationId: context.org.id })).items.map(
          (s) => s.id,
        ),
      ).not.toContain(context.space.id);
      await test.services.trash.restore(context.admin, entry.id);
      expect(await allowed(context.editor, "space.view", context.space.id)).toBe(true);
    });

    it("removes a deleted space completely after the second stage", async () => {
      const context = await setup();
      const page = await item(context, "Inside");
      await test.settings.set(
        trashFirstStageDaysSetting,
        { organization: context.org.id, space: context.space.id },
        "space",
        20,
      );
      const entry = await test.services.trash.deleteSpace(
        context.editor,
        context.space.id,
        context.space.name,
      );
      await test.database.execute(
        sql`update trash_entries set stage_two_at = now() - interval '100 days' where id = ${entry.id}`,
      );
      await test.services.trash.applyRetention();
      const left = await test.database.execute<{ spaces: string; items: string; settings: string }>(sql`
        select (select count(*) from spaces where id = ${context.space.id}) as spaces,
          (select count(*) from tree_items where id = ${page.id}) as items,
          (select count(*) from setting_values where scope_id = ${context.space.id}) as settings`);
      expect(left.rows[0]).toEqual({ spaces: "0", items: "0", settings: "0" });
    });
  });

  describe("archive", () => {
    it("makes archived pages read-only, moves them out of the tree and brings them back", async () => {
      const context = await setup();
      const parent = await item(context, "Parent");
      const page = await item(context, "Archived", parent.id);
      const child = await item(context, "Below", page.id);
      await test.services.archive.archive(context.editor, page.id);
      expect(await rootTitles(context, parent.id)).toEqual([]);
      expect(
        (await test.services.archive.list(context.reader, context.space.id)).map((entry) => entry.title),
      ).toEqual(["Archived"]);
      expect(
        (await test.services.tree.children(context.reader, context.space.id, page.id)).items.map(
          (entry) => entry.title,
        ),
      ).toEqual(["Below"]);
      expect(await allowed(context.reader, "item.view", child.id)).toBe(true);
      for (const id of [page.id, child.id]) {
        const decision = await test.services.authorization.explain(context.editor, "item.edit", {
          type: "item",
          id,
        });
        expect(decision).toMatchObject({ allowed: false, denials: ["archived"] });
      }
      expect(await allowed(context.editor, "item.archive", page.id)).toBe(true);

      expect(await test.services.archive.unarchive(context.editor, page.id)).toEqual({ parentId: parent.id });
      expect(await rootTitles(context, parent.id)).toEqual(["Archived"]);
      expect(await allowed(context.editor, "item.edit", child.id)).toBe(true);
    });

    it("brings an archived page back to the top level when its old place is gone", async () => {
      const context = await setup();
      const parent = await item(context, "Gone parent");
      const page = await item(context, "Kept", parent.id);
      await test.services.archive.archive(context.editor, page.id);
      await test.services.trash.deleteItem(context.editor, parent.id);
      expect(await test.services.archive.unarchive(context.editor, page.id)).toEqual({ parentId: null });
      expect(await rootTitles(context)).toContain("Kept");
    });

    it("keeps versions and links of archived pages", async () => {
      const context = await setup();
      const target = await item(context, "Target");
      const page = await item(context, "With link");
      await test.services.documents.replace(context.editor, page.id, {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "pageLink", attrs: { pageId: target.id, spaceId: null, title: null } }],
          },
        ],
      });
      await test.services.versions.versionLiveSession(page.id);
      await test.services.archive.archive(context.editor, page.id);
      expect(await test.services.versions.list(page.id)).toHaveLength(1);
      expect(
        (await test.services.documents.backlinks(context.reader, target.id)).map((link) => link.itemId),
      ).toEqual([page.id]);
    });

    it("makes an archived space read-only and hides it from the default list", async () => {
      const context = await setup();
      const page = await item(context, "In archived space");
      await test.services.archive.setSpaceArchived(context.editor, context.space.id, true);
      expect(await allowed(context.editor, "item.edit", page.id)).toBe(false);
      expect(await allowed(context.editor, "space.edit", context.space.id)).toBe(false);
      expect(await allowed(context.editor, "space.manage", context.space.id)).toBe(true);
      const listed = async (archived: boolean) =>
        (
          await test.services.spaces.list(context.editor, { organizationId: context.org.id, archived })
        ).items.map((entry) => entry.id);
      expect(await listed(false)).not.toContain(context.space.id);
      expect(await listed(true)).toContain(context.space.id);
      await test.services.archive.setSpaceArchived(context.editor, context.space.id, false);
      expect(await allowed(context.editor, "item.edit", page.id)).toBe(true);
    });
  });
});
