import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { positionBetween } from "./fractional-index.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("moving content", () => {
  let test: TestServices;
  const { organization, join, member, group, space } = spaceFixtures(() => test);

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

  async function page(creator: string, spaceId: string, title: string, parentId: string | null = null) {
    return test.services.tree.create(accountPrincipal(creator), spaceId, {
      kind: "page",
      title,
      mode: "live",
      placement: { parentId },
    });
  }

  async function setup() {
    const org = await organization();
    const editor = await member(org.id, "member", "Edda Editor");
    const reader = await member(org.id, "member", "Rita Reader");
    const wiki = await space(org.id, editor, {
      grants: [{ principalKind: "account", principalId: reader, role: "reader" }],
    });
    const hr = await page(editor, wiki.id, "HR");
    await test.services.pageAccess.change(accountPrincipal(editor), hr.id, [
      { action: "restrict", kind: "view" },
    ]);
    const salaries = await page(editor, wiki.id, "Salaries", hr.id);
    return { org, editor, reader, wiki, hr, salaries, as: accountPrincipal(editor) };
  }

  describe("a move that changes inherited view restrictions", () => {
    it("is refused until the actor confirms who gains access when a page leaves a restricted parent", async () => {
      const { reader, salaries, as } = await setup();
      expect(await canView(reader, salaries.id)).toBe(false);

      const impact = await test.services.tree.moveImpact(as, salaries.id, { parentId: null });
      expect(impact).toMatchObject({ gaining: 1, losing: 0, unlisted: 0 });
      expect(impact.changes).toEqual([
        { accountId: reader, name: "Rita Reader", before: null, after: "reader" },
      ]);
      expect(impact.confirmation).toEqual(expect.any(String));

      await expect(test.services.tree.move(as, salaries.id, { parentId: null })).rejects.toMatchObject({
        code: "moveChangesAccess",
        details: { impact: expect.objectContaining({ gaining: 1 }) },
      });
      await expect(
        test.services.tree.move(as, salaries.id, { parentId: null, confirmation: "1.forged" }),
      ).rejects.toMatchObject({ code: "moveChangesAccess" });
      expect(await canView(reader, salaries.id)).toBe(false);

      await test.services.tree.move(as, salaries.id, {
        parentId: null,
        confirmation: impact.confirmation ?? "",
      });
      expect(await canView(reader, salaries.id)).toBe(true);
    });

    it("is refused until the actor confirms who loses access when a page goes below a restricted page", async () => {
      const { editor, reader, wiki, hr, as } = await setup();
      const plan = await page(editor, wiki.id, "Plan");
      expect(await canView(reader, plan.id)).toBe(true);

      const impact = await test.services.tree.moveImpact(as, plan.id, { parentId: hr.id });
      expect(impact).toMatchObject({ gaining: 0, losing: 1 });
      expect(impact.changes).toEqual([
        { accountId: reader, name: "Rita Reader", before: "reader", after: null },
      ]);
      await expect(test.services.tree.move(as, plan.id, { parentId: hr.id })).rejects.toMatchObject({
        code: "moveChangesAccess",
      });
      expect(await canView(reader, plan.id)).toBe(true);

      await test.services.tree.move(as, plan.id, {
        parentId: hr.id,
        confirmation: impact.confirmation ?? "",
      });
      expect(await canView(reader, plan.id)).toBe(false);
    });

    it("needs a new confirmation when the access changes between preview and move", async () => {
      const { org, reader, wiki, salaries, as } = await setup();
      const impact = await test.services.tree.moveImpact(as, salaries.id, { parentId: null });
      const late = await member(org.id, "member", "Lara Late");
      await test.services.spacePermissions.apply(as, wiki.id, {
        action: "grant",
        principalKind: "account",
        principalId: late,
        role: "reader",
      });

      const refused = test.services.tree.move(as, salaries.id, {
        parentId: null,
        confirmation: impact.confirmation ?? "",
      });
      await expect(refused).rejects.toMatchObject({
        code: "moveChangesAccess",
        details: { impact: expect.objectContaining({ gaining: 2 }) },
      });
      expect(await canView(late, salaries.id)).toBe(false);
      expect(await canView(reader, salaries.id)).toBe(false);
    });

    it("counts people who reach only a page below the moved one", async () => {
      const { org, editor, wiki, hr, as } = await setup();
      const guest = await member(org.id, "member", "Gil Guest");
      const team = await page(editor, wiki.id, "Team");
      const notes = await page(editor, wiki.id, "Notes", team.id);
      await test.services.pageAccess.change(as, notes.id, [
        { action: "share", holderKind: "account", holderId: guest, role: "reader" },
      ]);
      expect(await canView(guest, notes.id)).toBe(true);
      expect(await canView(guest, team.id)).toBe(false);

      const impact = await test.services.tree.moveImpact(as, team.id, { parentId: hr.id });
      expect(impact.changes).toEqual(
        expect.arrayContaining([{ accountId: guest, name: "Gil Guest", before: "reader", after: null }]),
      );
      await test.services.tree.move(as, team.id, {
        parentId: hr.id,
        confirmation: impact.confirmation ?? "",
      });
      expect(await canView(guest, notes.id)).toBe(false);
    });

    it("shows the lost restriction when the page moves into another space", async () => {
      const { org, editor, reader, salaries, as } = await setup();
      const archive = await space(org.id, editor, {
        grants: [{ principalKind: "account", principalId: reader, role: "reader" }],
      });
      const impact = await test.services.tree.moveImpact(as, salaries.id, {
        spaceId: archive.id,
        parentId: null,
      });
      expect(impact.changes).toEqual([
        { accountId: reader, name: "Rita Reader", before: null, after: "reader" },
      ]);
      await expect(
        test.services.tree.move(as, salaries.id, { spaceId: archive.id, parentId: null }),
      ).rejects.toMatchObject({ code: "moveChangesAccess" });
      expect(await canView(reader, salaries.id)).toBe(false);
    });

    it("runs at once without a preview when nobody gains or loses access", async () => {
      const { editor, reader, wiki, hr, salaries, as } = await setup();
      const plan = await page(editor, wiki.id, "Plan");
      const other = await page(editor, wiki.id, "Other");

      const impact = await test.services.tree.moveImpact(as, plan.id, { parentId: other.id });
      expect(impact).toMatchObject({
        gaining: 0,
        losing: 0,
        raised: 0,
        lowered: 0,
        changes: [],
        confirmation: null,
      });
      await test.services.tree.move(as, plan.id, { parentId: other.id });
      await test.services.tree.move(as, salaries.id, { parentId: hr.id });
      expect(await canView(reader, plan.id)).toBe(true);
      expect(await canView(reader, salaries.id)).toBe(false);
    });
  });

  describe("moving into a confidential space", () => {
    async function confidential(organizationId: string, creator: string) {
      return test.services.spaces.create(
        accountPrincipal(creator),
        organizationId,
        {
          name: `Council ${randomUUID().slice(0, 6)}`,
          key: `C${randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`,
          visibility: "private",
          confidential: true,
          grants: [],
        },
        test.services.spacePermissions.holders,
      );
    }

    it("is refused while a link names a group, and names how many pages are affected", async () => {
      const { org, editor, wiki, as } = await setup();
      const council = await confidential(org.id, editor);
      const sales = await group(org.id, [editor]);
      const plan = await page(editor, wiki.id, "Plan");
      await page(editor, wiki.id, "Child", plan.id);
      const created = await test.services.shareLinks.create(as, plan.id, {
        scope: "people",
        people: [{ kind: "group", id: sales }],
      });

      await expect(
        test.services.tree.move(as, plan.id, { spaceId: council.id, parentId: null }),
      ).rejects.toMatchObject({ code: "confidentialSharing", details: { pages: 1 } });

      await test.services.shareLinks.revoke(as, created.link.id);
      const impact = await test.services.tree.moveImpact(as, plan.id, {
        spaceId: council.id,
        parentId: null,
      });
      await test.services.tree.move(as, plan.id, {
        spaceId: council.id,
        parentId: null,
        confirmation: impact.confirmation ?? "",
      });
    });

    it("is refused while a restriction lists a group", async () => {
      const { org, editor, wiki, as } = await setup();
      const council = await confidential(org.id, editor);
      const board = await group(org.id, [editor]);
      const plan = await page(editor, wiki.id, "Plan");
      const minutes = await page(editor, wiki.id, "Minutes", plan.id);
      await test.services.pageAccess.change(as, minutes.id, [
        { action: "restrict", kind: "view" },
        { action: "listHolder", kind: "view", holderKind: "group", holderId: board },
      ]);

      await expect(
        test.services.tree.move(as, plan.id, { spaceId: council.id, parentId: null }),
      ).rejects.toMatchObject({ code: "confidentialSharing", details: { pages: 1 } });
      const placed = await test.database.execute<{ space_id: string }>(
        sql`select space_id from tree_items where id = ${minutes.id}`,
      );
      expect(placed.rows[0]?.space_id).toBe(wiki.id);
    });

    it("is refused while an archived page below lists a group", async () => {
      const { org, editor, wiki, as } = await setup();
      const council = await confidential(org.id, editor);
      const board = await group(org.id, [editor]);
      const plan = await page(editor, wiki.id, "Plan");
      const minutes = await page(editor, wiki.id, "Minutes", plan.id);
      await test.services.pageAccess.change(as, minutes.id, [
        { action: "restrict", kind: "view" },
        { action: "listHolder", kind: "view", holderKind: "group", holderId: board },
      ]);
      await test.services.archive.archive(as, minutes.id);

      await expect(
        test.services.tree.move(as, plan.id, { spaceId: council.id, parentId: null }),
      ).rejects.toMatchObject({ code: "confidentialSharing", details: { pages: 1 } });
    });
  });

  describe("a move that would take content out of reach of its restriction holders", () => {
    async function hiddenSetup() {
      const org = await organization();
      const editor = await member(org.id, "member", "Edda Editor");
      const wiki = await space(org.id, org.owner, {
        grants: [{ principalKind: "account", principalId: editor, role: "editor" }],
      });
      const owner = accountPrincipal(org.owner);
      const parent = await page(org.owner, wiki.id, "Handbook");
      const hidden = await page(org.owner, wiki.id, "Board minutes", parent.id);
      await test.services.pageAccess.change(owner, hidden.id, [{ action: "restrict", kind: "view" }]);
      return { org, editor, wiki, owner, parent, hidden, as: accountPrincipal(editor) };
    }

    async function placeOf(itemId: string) {
      const result = await test.database.execute<{ space_id: string }>(
        sql`select space_id from tree_items where id = ${itemId}`,
      );
      return result.rows[0]?.space_id;
    }

    it("is refused into a space of another organization", async () => {
      const { editor, wiki, parent, hidden, as } = await hiddenSetup();
      const elsewhere = await organization();
      await join(elsewhere.id, editor);
      const foreign = await space(elsewhere.id, elsewhere.owner, {
        grants: [{ principalKind: "account", principalId: editor, role: "editor" }],
      });
      const lone = await page(editor, wiki.id, "Notes");

      for (const itemId of [parent.id, lone.id]) {
        await expect(
          test.services.tree.moveImpact(as, itemId, { spaceId: foreign.id, parentId: null }),
        ).rejects.toMatchObject({ code: "otherOrganization" });
        await expect(
          test.services.tree.move(as, itemId, { spaceId: foreign.id, parentId: null, confirmation: "" }),
        ).rejects.toMatchObject({ code: "otherOrganization" });
        expect(await placeOf(itemId)).toBe(wiki.id);
      }
      expect(await placeOf(hidden.id)).toBe(wiki.id);
    });

    it("is refused into a personal space, so its owner cannot lift the restriction there", async () => {
      const { editor, wiki, parent, hidden, as } = await hiddenSetup();
      const personal = await test.services.personalSpaces.ensure(as, "Overview");
      const lone = await page(editor, wiki.id, "Notes");

      for (const itemId of [parent.id, lone.id]) {
        await expect(
          test.services.tree.moveImpact(as, itemId, { spaceId: personal.id, parentId: null }),
        ).rejects.toMatchObject({ code: "otherOrganization" });
        await expect(
          test.services.tree.move(as, itemId, { spaceId: personal.id, parentId: null, confirmation: "" }),
        ).rejects.toMatchObject({ code: "otherOrganization" });
      }
      expect(await placeOf(hidden.id)).toBe(wiki.id);
      await expect(
        test.services.pageAccess.removeRestrictionAsAdministrator(as, personal.id, hidden.id, "view"),
      ).rejects.toThrow();
      expect(await canView(editor, hidden.id)).toBe(false);
    });

    it("is refused into a space the actor administers while a page below is restricted from their edits", async () => {
      const { org, editor, wiki, parent, owner, as } = await hiddenSetup();
      const minutes = await page(org.owner, wiki.id, "Approved minutes", parent.id);
      await test.services.pageAccess.change(owner, minutes.id, [{ action: "restrict", kind: "edit" }]);
      const own = await space(org.id, editor);
      const restrictedOnly = await page(org.owner, wiki.id, "Policy");
      const locked = await page(org.owner, wiki.id, "Signed policy", restrictedOnly.id);
      await test.services.pageAccess.change(owner, locked.id, [{ action: "restrict", kind: "edit" }]);

      await expect(
        test.services.tree.moveImpact(as, restrictedOnly.id, { spaceId: own.id, parentId: null }),
      ).rejects.toMatchObject({ code: "hiddenContent", details: { pages: 1 } });
      await expect(
        test.services.tree.move(as, restrictedOnly.id, { spaceId: own.id, parentId: null, confirmation: "" }),
      ).rejects.toMatchObject({ code: "hiddenContent" });
      expect(await placeOf(locked.id)).toBe(wiki.id);
      await expect(
        test.services.pageAccess.removeRestrictionAsAdministrator(as, wiki.id, locked.id, "edit"),
      ).rejects.toThrow();
    });

    it("is refused between personal spaces", async () => {
      const { org, editor, as } = await hiddenSetup();
      const other = await member(org.id, "member", "Otto Other");
      const theirs = await test.services.personalSpaces.ensure(accountPrincipal(other), "Overview");
      const mine = await test.services.personalSpaces.ensure(as, "Overview");
      await test.services.spacePermissions.grant(
        accountPrincipal(other),
        theirs.id,
        [{ principalKind: "account", principalId: editor }],
        "editor",
      );
      const draft = await page(editor, mine.id, "Draft");
      await expect(
        test.services.tree.moveImpact(as, draft.id, { spaceId: theirs.id, parentId: null }),
      ).rejects.toMatchObject({ code: "otherOrganization" });
      await expect(
        test.services.tree.move(as, draft.id, { spaceId: theirs.id, parentId: null, confirmation: "" }),
      ).rejects.toMatchObject({ code: "otherOrganization" });
      expect(await placeOf(draft.id)).toBe(mine.id);
    });

    it("is refused into another space of the organization while a page below is hidden from the actor", async () => {
      const { org, editor, wiki, parent, hidden, as } = await hiddenSetup();
      const other = await space(org.id, editor);

      await expect(
        test.services.tree.moveImpact(as, parent.id, { spaceId: other.id, parentId: null }),
      ).rejects.toMatchObject({ code: "hiddenContent", details: { pages: 1 } });
      await expect(
        test.services.tree.move(as, parent.id, { spaceId: other.id, parentId: null, confirmation: "" }),
      ).rejects.toMatchObject({ code: "hiddenContent" });
      expect(await placeOf(parent.id)).toBe(wiki.id);
      expect(await placeOf(hidden.id)).toBe(wiki.id);
      expect(await canView(editor, hidden.id)).toBe(false);

      const shelf = await page(editor, wiki.id, "Shelf");
      const impact = await test.services.tree.moveImpact(as, parent.id, { parentId: shelf.id });
      await test.services.tree.move(as, parent.id, {
        parentId: shelf.id,
        confirmation: impact.confirmation ?? "",
      });
      expect(await placeOf(hidden.id)).toBe(wiki.id);
    });
  });

  it("takes archived pages and trash entries below the moved page into the other space", async () => {
    const { org, editor, reader, wiki, hr, salaries, as } = await setup();
    const other = await space(org.id, editor, {
      grants: [{ principalKind: "account", principalId: reader, role: "reader" }],
    });
    const team = await page(editor, wiki.id, "Team", hr.id);
    await test.services.archive.archive(as, salaries.id);
    const entry = await test.services.trash.deleteItem(as, team.id);

    const impact = await test.services.tree.moveImpact(as, hr.id, { spaceId: other.id, parentId: null });
    await test.services.tree.move(as, hr.id, {
      spaceId: other.id,
      parentId: null,
      confirmation: impact.confirmation ?? "",
    });
    const placed = await test.database.execute<{ id: string; space_id: string }>(
      sql`select id, space_id from tree_items where id in (${salaries.id}, ${team.id})`,
    );
    expect(placed.rows.map((row) => row.space_id)).toEqual([other.id, other.id]);
    expect((await test.services.trash.get(entry.id))?.spaceId).toBe(other.id);

    expect(await test.services.archive.unarchive(as, salaries.id)).toEqual({
      parentId: hr.id,
      parentEntries: 0,
    });
    expect(await test.services.trash.restore(as, entry.id)).toMatchObject({ parentId: hr.id });
    expect(await canView(reader, salaries.id)).toBe(false);
    expect(await canView(reader, team.id)).toBe(false);
  });

  it("moves into another space when the new position is taken in the old space", async () => {
    const { org, editor, wiki, as } = await setup();
    const other = await space(org.id, editor);
    await page(editor, other.id, "First there");
    await page(editor, other.id, "Second there");
    const moving = await page(editor, wiki.id, "Moving");
    const blocker = await page(editor, wiki.id, "Staying");
    const last = await test.database.execute<{ position: string | null }>(sql`
      select max(position) as position from tree_items where space_id = ${other.id} and parent_id is null`);
    const next = positionBetween(last.rows[0]?.position ?? null, null);
    expect(blocker.position).toBe(next);

    const impact = await test.services.tree.moveImpact(as, moving.id, { spaceId: other.id, parentId: null });
    await test.services.tree.move(as, moving.id, {
      spaceId: other.id,
      parentId: null,
      confirmation: impact.confirmation ?? "",
    });
    const moved = await test.database.execute<{ space_id: string; position: string }>(
      sql`select space_id, position from tree_items where id = ${moving.id}`,
    );
    expect(moved.rows[0]).toEqual({ space_id: other.id, position: next });
  });
});
