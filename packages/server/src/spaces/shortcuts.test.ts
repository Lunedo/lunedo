import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { MAX_SHORTCUTS } from "./shortcuts.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("space shortcuts", () => {
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
    const adminId = await member(org.id, "member", "Space admin");
    const readerId = await member(org.id, "member", "Reader");
    const insiderId = await member(org.id, "member", "Insider");
    const editorId = await member(org.id, "member", "Editor");
    const created = await space(org.id, adminId, {
      grants: [
        { principalKind: "account", principalId: editorId, role: "editor" },
        { principalKind: "account", principalId: readerId, role: "reader" },
        { principalKind: "account", principalId: insiderId, role: "reader" },
      ],
    });
    const elsewhere = await space(org.id, insiderId, { name: "Elsewhere" });
    const admin = accountPrincipal(adminId);
    const page = (spaceId: string, title: string, actor = admin) =>
      test.services.tree.create(actor, spaceId, {
        kind: "page",
        title,
        mode: "live",
        placement: { parentId: null },
      });
    const rota = await page(created.id, "On-call rota");
    const editor = accountPrincipal(editorId);
    const secret = await page(created.id, "Salaries", editor);
    await test.services.pageAccess.change(editor, secret.id, [
      { action: "share", holderKind: "account", holderId: insiderId, role: "reader" },
      { action: "restrict", kind: "view" },
    ]);
    const remote = await page(elsewhere.id, "Remote runbook", accountPrincipal(insiderId));
    return {
      space: created,
      elsewhere,
      rota,
      secret,
      remote,
      admin,
      adminId,
      reader: accountPrincipal(readerId),
      insider: accountPrincipal(insiderId),
    };
  }

  it("lets space admins add links to content and external addresses, in order", async () => {
    const context = await setup();
    const rota = await test.services.shortcuts.add(context.admin, context.space.id, {
      label: "  On-call   rota ",
      target: { itemId: context.rota.id },
    });
    expect(rota).toMatchObject({
      label: "On-call rota",
      url: null,
      item: { id: context.rota.id, kind: "page", title: "On-call rota", spaceKey: context.space.key },
      hidden: false,
      position: 0,
    });
    const status = await test.services.shortcuts.add(context.admin, context.space.id, {
      label: "Status page",
      target: { url: "https://status.example.org" },
    });
    expect(status).toMatchObject({ url: "https://status.example.org/", item: null, position: 1 });
    expect(
      (await test.services.shortcuts.list(context.reader, context.space.id)).map((s) => s.label),
    ).toEqual(["On-call rota", "Status page"]);

    const reordered = await test.services.shortcuts.reorder(context.admin, context.space.id, [
      status.id,
      rota.id,
    ]);
    expect(reordered.map((shortcut) => shortcut.label)).toEqual(["Status page", "On-call rota"]);
    await expect(
      test.services.shortcuts.reorder(context.admin, context.space.id, [status.id]),
    ).rejects.toMatchObject({ code: "invalidShortcut" });

    const changed = await test.services.shortcuts.update(context.admin, context.space.id, rota.id, {
      label: "Rota",
      target: { url: "http://rota.example.org/today" },
    });
    expect(changed).toMatchObject({ label: "Rota", url: "http://rota.example.org/today", item: null });
    await test.services.shortcuts.remove(context.admin, context.space.id, status.id);
    expect((await test.services.shortcuts.list(context.reader, context.space.id)).map((s) => s.id)).toEqual([
      rota.id,
    ]);
    await expect(
      test.services.shortcuts.remove(context.admin, context.space.id, status.id),
    ).rejects.toMatchObject({ code: "shortcutNotFound" });
  });

  it("hides shortcuts to content a person cannot read, without revealing anything about them", async () => {
    const context = await setup();
    await test.services.shortcuts.add(context.insider, context.space.id, {
      label: "Pay bands",
      target: { itemId: context.secret.id },
    });
    const remote = await test.services.shortcuts.add(context.insider, context.space.id, {
      label: "Remote runbook",
      target: { itemId: context.remote.id },
    });

    const forReader = await test.services.shortcuts.list(context.reader, context.space.id);
    expect(forReader).toEqual([]);
    expect(JSON.stringify(forReader)).not.toContain("Pay bands");

    const forInsider = await test.services.shortcuts.list(context.insider, context.space.id);
    expect(forInsider.map((shortcut) => shortcut.label)).toEqual(["Pay bands", "Remote runbook"]);
    expect(forInsider[1]?.item).toMatchObject({ id: context.remote.id, spaceKey: context.elsewhere.key });

    const managed = await test.services.shortcuts.manage(context.admin, context.space.id);
    expect(managed.map((shortcut) => [shortcut.label, shortcut.hidden, shortcut.item])).toEqual([
      ["Pay bands", true, null],
      ["Remote runbook", true, null],
    ]);
    expect(remote.hidden).toBe(false);
  });

  it("refuses targets the admin cannot open, unknown content and unsafe addresses", async () => {
    const context = await setup();
    for (const itemId of [context.secret.id, context.remote.id, "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a99"]) {
      await expect(
        test.services.shortcuts.add(context.admin, context.space.id, { label: "Open", target: { itemId } }),
      ).rejects.toMatchObject({ code: "shortcutTargetNotFound" });
    }
    for (const url of ["javascript:alert(1)", "data:text/html,hi", "/spaces/X", "mailto:a@example.org"]) {
      await expect(
        test.services.shortcuts.add(context.admin, context.space.id, { label: "Open", target: { url } }),
      ).rejects.toMatchObject({ code: "invalidShortcut" });
    }
    await expect(
      test.services.shortcuts.add(context.admin, context.space.id, {
        label: " ",
        target: { url: "https://example.org" },
      }),
    ).rejects.toMatchObject({ code: "invalidShortcut" });
  });

  it("hides shortcuts to content in the trash and removes them with the content", async () => {
    const context = await setup();
    const shortcut = await test.services.shortcuts.add(context.admin, context.space.id, {
      label: "Rota",
      target: { itemId: context.rota.id },
    });
    const entry = await test.services.trash.deleteItem(context.admin, context.rota.id);
    expect(await test.services.shortcuts.list(context.reader, context.space.id)).toEqual([]);
    expect((await test.services.shortcuts.manage(context.admin, context.space.id))[0]).toMatchObject({
      id: shortcut.id,
      hidden: true,
    });
    await test.database.execute(sql`delete from tree_items where id = ${context.rota.id}`);
    expect(await test.services.shortcuts.manage(context.admin, context.space.id)).toEqual([]);
    expect(entry).toBeDefined();
  });

  it("limits the number of shortcuts and records every change in the audit log", async () => {
    const context = await setup();
    for (let index = 0; index < MAX_SHORTCUTS; index += 1) {
      await test.services.shortcuts.add(context.admin, context.space.id, {
        label: `Link ${index}`,
        target: { url: `https://example.org/${index}` },
      });
    }
    await expect(
      test.services.shortcuts.add(context.admin, context.space.id, {
        label: "One more",
        target: { url: "https://example.org/more" },
      }),
    ).rejects.toMatchObject({ code: "tooManyShortcuts" });
    const events = await test.database.execute<{ count: number }>(sql`
      select count(*)::int as count from audit_events
      where name = 'space.shortcutsChanged' and target_id = ${context.space.id}`);
    expect(events.rows[0]?.count).toBe(MAX_SHORTCUTS);
  });
});
