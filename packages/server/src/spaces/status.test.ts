import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, type Principal } from "../accounts/principal.js";
import { ForbiddenError } from "../authorization/service.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { pageStatusEnabledSetting } from "./settings.js";
import { nearestStatusColor } from "./status.js";

const baseUrl = testDatabaseBaseUrl();

describe("nearest status color", () => {
  it("maps Confluence colors to the token colors", () => {
    expect(nearestStatusColor("#FFC400")).toBe("warning");
    expect(nearestStatusColor("#2684FF")).toBe("info");
    expect(nearestStatusColor("#57D9A3")).toBe("success");
    expect(nearestStatusColor("#FF5630")).toBe("danger");
    expect(nearestStatusColor("#6554C0")).toBe("accent");
    expect(nearestStatusColor("#97A0AF")).toBe("neutral");
    expect(nearestStatusColor(null)).toBe("neutral");
    expect(nearestStatusColor("blue")).toBe("neutral");
  });
});

describe.skipIf(!baseUrl)("page status", () => {
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
    const editorId = await member(org.id, "member", "Editor");
    const readerId = await member(org.id, "member", "Reader");
    const adminId = await member(org.id, "member", "Space admin");
    const created = await space(org.id, adminId, {
      grants: [
        { principalKind: "account", principalId: editorId, role: "editor" },
        { principalKind: "account", principalId: readerId, role: "reader" },
      ],
    });
    const editor = accountPrincipal(editorId);
    const page = await test.services.tree.create(editor, created.id, {
      kind: "page",
      title: "Runbook",
      mode: "live",
      placement: { parentId: null },
    });
    return {
      org,
      adminId,
      editorId,
      readerId,
      space: created,
      page,
      editor,
      reader: accountPrincipal(readerId),
      admin: accountPrincipal(adminId),
    };
  }

  async function versionCount(itemId: string): Promise<number> {
    const result = await test.database.execute<{ count: number }>(
      sql`select count(*)::int as count from page_versions where item_id = ${itemId}`,
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  it("starts every space with the four default values", async () => {
    const context = await setup();
    const values = await test.services.pageStatus.values(context.admin, context.space.id);
    expect(values.map((value) => [value.builtIn, value.color])).toEqual([
      ["roughDraft", "neutral"],
      ["inProgress", "info"],
      ["readyForReview", "warning"],
      ["verified", "success"],
    ]);
    expect(await test.services.pageStatus.enabled(context.space.id)).toBe(true);
    expect(context.page.status).toBeNull();
  });

  it("lets editors set and remove the status outside the versions and records who changed it", async () => {
    const context = await setup();
    const [, inProgress] = await test.services.pageStatus.values(context.admin, context.space.id);
    const versions = await versionCount(context.page.id);
    const status = await test.services.pageStatus.set(context.editor, context.page.id, inProgress?.id ?? "");
    expect(status).toMatchObject({ builtIn: "inProgress", color: "info" });
    const item = await test.services.tree.get(context.reader, context.page.id);
    expect(item?.status).toMatchObject({ id: inProgress?.id, builtIn: "inProgress" });
    const children = await test.services.tree.children(context.reader, context.space.id, null);
    expect(children.items.find((child) => child.id === context.page.id)?.status?.id).toBe(inProgress?.id);

    await test.services.pageStatus.set(context.editor, context.page.id, null);
    expect((await test.services.tree.get(context.reader, context.page.id))?.status).toBeNull();
    const history = await test.services.pageStatus.history(context.reader, context.page.id);
    expect(history.map((change) => change.removed)).toEqual([true, false]);
    expect(history[1]).toMatchObject({ actor: { id: context.editorId }, status: { builtIn: "inProgress" } });
    expect(await versionCount(context.page.id)).toBe(versions);
  });

  it("keeps readers from changing the status", async () => {
    const context = await setup();
    const [value] = await test.services.pageStatus.values(context.admin, context.space.id);
    await expect(
      test.services.pageStatus.set(context.reader, context.page.id, value?.id ?? ""),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("accepts only values of the page's own space", async () => {
    const context = await setup();
    const other = await setup();
    const [foreign] = await test.services.pageStatus.values(other.admin, other.space.id);
    await expect(
      test.services.pageStatus.set(context.editor, context.page.id, foreign?.id ?? ""),
    ).rejects.toMatchObject({ code: "statusNotFound" });
  });

  it("hides the status and refuses changes while status is turned off", async () => {
    const context = await setup();
    const [value] = await test.services.pageStatus.values(context.admin, context.space.id);
    await test.services.pageStatus.set(context.editor, context.page.id, value?.id ?? "");
    await test.settings.set(pageStatusEnabledSetting, { space: context.space.id }, "space", false);
    expect((await test.services.tree.get(context.reader, context.page.id))?.status).toBeNull();
    await expect(test.services.pageStatus.set(context.editor, context.page.id, null)).rejects.toMatchObject({
      code: "statusDisabled",
    });
    await test.settings.set(pageStatusEnabledSetting, { space: context.space.id }, "space", true);
    expect((await test.services.tree.get(context.reader, context.page.id))?.status?.id).toBe(value?.id);
  });

  it("lets space admins add, rename and reorder values", async () => {
    const context = await setup();
    const added = await test.services.pageStatus.add(context.admin, context.space.id, {
      name: "Outdated",
      color: "danger",
    });
    expect(added).toMatchObject({ builtIn: null, name: "Outdated", position: 4, pages: 0 });
    await expect(
      test.services.pageStatus.add(context.admin, context.space.id, { name: "verified", color: "info" }),
    ).rejects.toMatchObject({ code: "statusExists" });
    await expect(
      test.services.pageStatus.add(context.admin, context.space.id, { name: "  ", color: "info" }),
    ).rejects.toMatchObject({ code: "invalidStatus" });

    const values = await test.services.pageStatus.values(context.admin, context.space.id);
    const verified = values.find((value) => value.builtIn === "verified");
    const renamed = await test.services.pageStatus.update(
      context.admin,
      context.space.id,
      verified?.id ?? "",
      {
        name: "Approved",
        color: "accent",
      },
    );
    expect(renamed).toMatchObject({ builtIn: "verified", name: "Approved", color: "accent" });

    const reversed = values.map((value) => value.id).reverse();
    const reordered = await test.services.pageStatus.reorder(context.admin, context.space.id, reversed);
    expect(reordered.map((value) => value.id)).toEqual(reversed);
    await expect(
      test.services.pageStatus.reorder(context.admin, context.space.id, reversed.slice(1)),
    ).rejects.toMatchObject({ code: "invalidStatus" });

    const audit = await test.database.execute<{ operation: string }>(sql`
      select fields->>'operation' as operation from audit_events
      where name = 'space.pageStatusValuesChanged' and target_id = ${context.space.id} order by sequence`);
    expect(audit.rows.map((row) => row.operation)).toEqual(["added", "changed", "reordered"]);
  });

  it("asks before removing a value that pages use and names how many lose it", async () => {
    const context = await setup();
    const [value] = await test.services.pageStatus.values(context.admin, context.space.id);
    await test.services.pageStatus.set(context.editor, context.page.id, value?.id ?? "");
    await expect(
      test.services.pageStatus.remove(context.admin, context.space.id, value?.id ?? "", 0),
    ).rejects.toMatchObject({ code: "statusInUse", details: { pages: 1 } });
    expect((await test.services.tree.get(context.reader, context.page.id))?.status?.id).toBe(value?.id);

    await test.services.pageStatus.remove(context.admin, context.space.id, value?.id ?? "", 1);
    expect((await test.services.tree.get(context.reader, context.page.id))?.status).toBeNull();
    const remaining = await test.services.pageStatus.values(context.admin, context.space.id);
    expect(remaining.map((entry) => entry.position)).toEqual([0, 1, 2]);
    const history = await test.services.pageStatus.history(context.reader, context.page.id);
    expect(history[0]).toMatchObject({ status: { id: null, builtIn: value?.builtIn } });
  });

  it("keeps everyone but space admins from changing the values", async () => {
    const context = await setup();
    await expect(
      test.services.pageStatus.add(context.editor, context.space.id, { name: "Mine", color: "info" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const [value] = await test.services.pageStatus.values(context.admin, context.space.id);
    await expect(
      test.services.pageStatus.remove(context.editor, context.space.id, value?.id ?? "", 0),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("counts only the pages the viewer can see", async () => {
    const context = await setup();
    const [value] = await test.services.pageStatus.values(context.admin, context.space.id);
    const hidden = await test.services.tree.create(context.editor, context.space.id, {
      kind: "page",
      title: "Salaries",
      mode: "live",
      placement: { parentId: null },
    });
    await test.services.pageStatus.set(context.editor, context.page.id, value?.id ?? "");
    await test.services.pageStatus.set(context.editor, hidden.id, value?.id ?? "");
    await test.services.pageAccess.change(context.editor, hidden.id, [{ action: "restrict", kind: "view" }]);

    const counted = async (viewer: Principal) =>
      (await test.services.pageStatus.values(viewer, context.space.id)).find((entry) => entry.id === value?.id)
        ?.pages;
    expect(await counted(context.reader)).toBe(1);
    expect(await counted(context.editor)).toBe(2);
  });

  describe("moving pages to another space", () => {
    async function target(context: Awaited<ReturnType<typeof setup>>, confidential = false) {
      if (confidential) {
        return test.services.spaces.create(
          context.admin,
          context.org.id,
          {
            name: `Council ${randomUUID().slice(0, 6)}`,
            key: `C${randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`,
            visibility: "private",
            confidential: true,
            grants: [{ principalKind: "account", principalId: context.editorId, role: "editor" }],
          },
          test.services.spacePermissions.holders,
        );
      }
      return space(context.org.id, context.adminId, {
        grants: [
          { principalKind: "account", principalId: context.editorId, role: "editor" },
          { principalKind: "account", principalId: context.readerId, role: "reader" },
        ],
      });
    }

    async function moveTo(actor: Principal, itemId: string, spaceId: string) {
      const impact = await test.services.tree.moveImpact(actor, itemId, { spaceId, parentId: null });
      await test.services.tree.move(actor, itemId, {
        spaceId,
        parentId: null,
        confirmation: impact.confirmation ?? "",
      });
    }

    async function counts(viewer: Principal, spaceId: string) {
      return Object.fromEntries(
        (await test.services.pageStatus.values(viewer, spaceId)).map((value) => [value.id, value.pages]),
      );
    }

    it("takes the value with the same built-in key or name in the target space for the whole subtree", async () => {
      const context = await setup();
      const destination = await target(context);
      const child = await test.services.tree.create(context.editor, context.space.id, {
        kind: "page",
        title: "Escalation",
        mode: "live",
        placement: { parentId: context.page.id },
      });
      const sourceVerified = (await test.services.pageStatus.values(context.admin, context.space.id)).find(
        (value) => value.builtIn === "verified",
      );
      await test.services.pageStatus.update(context.admin, context.space.id, sourceVerified?.id ?? "", {
        name: "Approved",
      });
      const hold = await test.services.pageStatus.add(context.admin, context.space.id, {
        name: "Legal hold",
        color: "danger",
      });
      const targetHold = await test.services.pageStatus.add(context.admin, destination.id, {
        name: "legal HOLD",
        color: "warning",
      });
      const targetVerified = (await test.services.pageStatus.values(context.admin, destination.id)).find(
        (value) => value.builtIn === "verified",
      );
      await test.services.pageStatus.set(context.editor, context.page.id, sourceVerified?.id ?? "");
      await test.services.pageStatus.set(context.editor, child.id, hold.id);

      await moveTo(context.editor, context.page.id, destination.id);

      expect((await test.services.tree.get(context.reader, context.page.id))?.status).toMatchObject({
        id: targetVerified?.id,
        builtIn: "verified",
        name: null,
      });
      const children = await test.services.tree.children(context.reader, destination.id, context.page.id);
      expect(children.items.map((item) => item.status?.id)).toEqual([targetHold.id]);
      const history = await test.services.pageStatus.history(context.reader, child.id);
      expect(history[0]).toMatchObject({
        removed: false,
        status: { id: targetHold.id, name: "legal HOLD", color: "warning" },
        actor: { id: context.editorId },
      });

      expect(await counts(context.admin, context.space.id)).toMatchObject({
        [sourceVerified?.id ?? ""]: 0,
        [hold.id]: 0,
      });
      expect(await counts(context.admin, destination.id)).toMatchObject({
        [targetVerified?.id ?? ""]: 1,
        [targetHold.id]: 1,
      });
      await test.services.pageStatus.remove(context.admin, context.space.id, hold.id, 0);
      expect((await test.services.tree.get(context.reader, child.id))?.status?.id).toBe(targetHold.id);
    });

    it("clears a status the target space has no value for", async () => {
      const context = await setup();
      const destination = await target(context);
      const hold = await test.services.pageStatus.add(context.admin, context.space.id, {
        name: "Legal hold",
        color: "danger",
      });
      await test.services.pageStatus.set(context.editor, context.page.id, hold.id);

      await moveTo(context.editor, context.page.id, destination.id);

      expect((await test.services.tree.get(context.reader, context.page.id))?.status).toBeNull();
      const stored = await test.database.execute<{ status_id: string | null }>(
        sql`select status_id from tree_items where id = ${context.page.id}`,
      );
      expect(stored.rows[0]?.status_id).toBeNull();
      const history = await test.services.pageStatus.history(context.reader, context.page.id);
      expect(history[0]).toMatchObject({ removed: true, actor: { id: context.editorId } });
      expect(await counts(context.admin, context.space.id)).toMatchObject({ [hold.id]: 0 });
    });

    it("leaves no value of a confidential space on pages moved out of it", async () => {
      const context = await setup();
      const council = await target(context, true);
      const destination = await target(context);
      const page = await test.services.tree.create(context.editor, council.id, {
        kind: "page",
        title: "Investigation",
        mode: "live",
        placement: { parentId: null },
      });
      const child = await test.services.tree.create(context.editor, council.id, {
        kind: "page",
        title: "Notes",
        mode: "live",
        placement: { parentId: page.id },
      });
      const hold = await test.services.pageStatus.add(context.admin, council.id, {
        name: "Legal hold",
        color: "danger",
      });
      const [, inProgress] = await test.services.pageStatus.values(context.admin, council.id);
      await test.services.pageStatus.set(context.editor, page.id, hold.id);
      await test.services.pageStatus.set(context.editor, child.id, inProgress?.id ?? "");

      await moveTo(context.editor, page.id, destination.id);

      const leftovers = await test.database.execute<{ id: string }>(sql`
        select t.id from tree_items t join page_status_values v on v.id = t.status_id
        where t.id in (${page.id}, ${child.id}) and v.space_id <> t.space_id`);
      expect(leftovers.rows).toEqual([]);
      expect((await test.services.tree.get(context.reader, page.id))?.status).toBeNull();
      expect((await test.services.tree.get(context.reader, child.id))?.status).toMatchObject({
        builtIn: "inProgress",
      });
      expect(Object.values(await counts(context.admin, council.id)).every((pages) => pages === 0)).toBe(true);
      await test.services.pageStatus.update(context.admin, council.id, hold.id, { name: "Closed case" });
      expect((await test.services.tree.get(context.reader, page.id))?.status).toBeNull();
    });
  });
});
