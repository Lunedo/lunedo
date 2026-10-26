import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, type Principal } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { type ReviewReminder, ReviewService } from "./reviews.js";

const baseUrl = testDatabaseBaseUrl();
const DAY = 24 * 3_600_000;
const PUBLISHED = "2026-01-10T08:00:00.000Z";

describe.skipIf(!baseUrl)("knowledge base reviews", () => {
  let test: TestServices;
  const { organization, join, member, space, deactivate } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  function reviewsAt(now: Date | string) {
    const at = new Date(now);
    return new ReviewService({
      database: test.database,
      authorization: test.services.authorization,
      audit: test.services.audit,
      people: test.services.people,
      notifications: test.services.notifications,
      administrators: (executor, spaceId) => test.services.pageAccess.spaceAdministrators(executor, spaceId),
      clock: () => at,
    });
  }

  async function setup() {
    const org = await organization();
    const adminId = await member(org.id, "member", "Admin");
    const editorId = await member(org.id, "member", "Editor");
    const readerId = await member(org.id, "member", "Reader");
    const admin = accountPrincipal(adminId);
    const editor = accountPrincipal(editorId);
    const name = `Help ${randomUUID().slice(0, 8)}`;
    const kb = await test.services.spaces.create(
      admin,
      org.id,
      {
        name,
        key: await test.services.spaces.suggestKey(name),
        type: "knowledgeBase",
        grants: [
          { principalKind: "account", principalId: editorId, role: "editor" },
          { principalKind: "account", principalId: readerId, role: "reader" },
        ],
      },
      test.services.spacePermissions.holders,
    );
    return { org, adminId, editorId, readerId, admin, editor, reader: accountPrincipal(readerId), kb };
  }

  async function article(actor: Principal, spaceId: string, title = `Article ${randomUUID().slice(0, 6)}`) {
    const created = await test.services.tree.create(actor, spaceId, {
      kind: "page",
      title,
      placement: { parentId: null },
    });
    await test.services.versions.publish(actor, created.id);
    await test.database.execute(
      sql`update article_reviews set published_at = ${PUBLISHED}::timestamptz where item_id = ${created.id}`,
    );
    return created.id;
  }

  async function row(itemId: string) {
    const result = await test.database.execute<{
      due_at: Date | null;
      reminders_queued_at: Date | null;
      lead_reminded_at: Date | null;
      due_reminded_at: Date | null;
      source_changed_at: Date | null;
    }>(sql`
      select due_at, reminders_queued_at, lead_reminded_at, due_reminded_at, source_changed_at
      from article_reviews where item_id = ${itemId}`);
    const found = result.rows[0];
    if (!found) throw new Error("The article has no review row");
    return found;
  }

  async function numberOf(itemId: string): Promise<number> {
    const result = await test.database.execute<{ number: string }>(
      sql`select number from tree_items where id = ${itemId}`,
    );
    return Number(result.rows[0]?.number);
  }

  const dueOf = async (itemId: string) => {
    const due = (await row(itemId)).due_at;
    return due ? new Date(due).toISOString() : null;
  };

  async function notified(type: string, itemId: string): Promise<string[]> {
    const result = await test.database.execute<{ recipient_id: string; count: number }>(sql`
      select recipient_id, count from notifications where type = ${type} and target_id = ${itemId}
      order by recipient_id`);
    return result.rows.flatMap((found) =>
      Array.from({ length: Number(found.count) }, () => found.recipient_id),
    );
  }

  async function auditNames(targetId: string): Promise<string[]> {
    const result = await test.database.execute<{ name: string }>(
      sql`select name from audit_events where target_id = ${targetId} order by sequence`,
    );
    return result.rows.map((found) => found.name);
  }

  async function queued(service: ReviewService) {
    const reminders: { reminder: ReviewReminder; startAfter: string }[] = [];
    await service.queuePending(async (reminder, startAfter) => {
      reminders.push({ reminder, startAfter: startAfter.toISOString() });
    });
    return reminders;
  }

  describe("due dates", () => {
    it("follow the default of the knowledge base, the own interval of the article and switching off", async () => {
      const context = await setup();
      const itemId = await article(context.editor, context.kb.id);
      const reviews = reviewsAt(PUBLISHED);
      expect(await dueOf(itemId)).toBeNull();

      await reviews.updateSettings(context.admin, context.kb.id, { intervalMonths: 6 });
      expect(await dueOf(itemId)).toBe("2026-07-10T08:00:00.000Z");

      await reviews.updateSettings(context.admin, context.kb.id, { intervalMonths: 3 });
      expect(await dueOf(itemId)).toBe("2026-04-10T08:00:00.000Z");

      await reviews.setInterval(context.editor, itemId, 12);
      expect(await dueOf(itemId)).toBe("2027-01-10T08:00:00.000Z");
      expect((await reviews.article(context.editor, itemId)).inherited).toBe(false);

      await reviews.setInterval(context.editor, itemId, 0);
      expect(await dueOf(itemId)).toBeNull();
      expect((await reviews.article(context.editor, itemId)).state).toBe("off");

      await reviews.setInterval(context.editor, itemId, null);
      expect(await dueOf(itemId)).toBe("2026-04-10T08:00:00.000Z");

      await reviews.updateSettings(context.admin, context.kb.id, { intervalMonths: null });
      expect(await dueOf(itemId)).toBeNull();
      expect(await auditNames(context.kb.id)).toContain("knowledgeBase.reviewSettingsChanged");
    });

    it("start at the first publication and only count published articles", async () => {
      const context = await setup();
      await reviewsAt(PUBLISHED).updateSettings(context.admin, context.kb.id, { intervalMonths: 6 });
      const draft = await test.services.tree.create(context.editor, context.kb.id, {
        kind: "page",
        title: "Draft",
        placement: { parentId: null },
      });
      expect(await dueOf(draft.id)).toBeNull();
      const before = Date.now();
      await test.services.versions.publish(context.editor, draft.id);
      const due = await dueOf(draft.id);
      expect(due).not.toBeNull();
      const months = (new Date(due ?? 0).getTime() - before) / DAY;
      expect(months).toBeGreaterThan(180);
      expect(months).toBeLessThan(185);
    });

    it("restart at the last review", async () => {
      const context = await setup();
      const itemId = await article(context.editor, context.kb.id);
      await reviewsAt(PUBLISHED).updateSettings(context.admin, context.kb.id, { intervalMonths: 6 });
      await reviewsAt("2026-08-01T10:00:00.000Z").markReviewed(context.editor, itemId);
      expect(await dueOf(itemId)).toBe("2027-02-01T10:00:00.000Z");
    });
  });

  describe("reminders", () => {
    async function dueArticle() {
      const context = await setup();
      const itemId = await article(context.editor, context.kb.id);
      await reviewsAt(PUBLISHED).updateSettings(context.admin, context.kb.id, { intervalMonths: 6 });
      return { ...context, itemId };
    }

    it("are scheduled for the lead time and the due date when an article gets a due date", async () => {
      const context = await dueArticle();
      const reminders = await queued(reviewsAt("2026-02-01T00:00:00.000Z"));
      const mine = reminders.filter((entry) => entry.reminder.itemId === context.itemId);
      expect(mine).toEqual([
        {
          reminder: { itemId: context.itemId, kind: "lead", dueAt: "2026-07-10T08:00:00.000Z", leadDays: 14 },
          startAfter: "2026-06-26T08:00:00.000Z",
        },
        {
          reminder: { itemId: context.itemId, kind: "due", dueAt: "2026-07-10T08:00:00.000Z", leadDays: 14 },
          startAfter: "2026-07-10T08:00:00.000Z",
        },
      ]);
      expect((await row(context.itemId)).reminders_queued_at).not.toBeNull();
      expect(
        (await queued(reviewsAt("2026-02-01T00:00:00.000Z"))).map((entry) => entry.reminder.itemId),
      ).not.toContain(context.itemId);
    });

    it("are sent once to the owner, at the lead time and on the due date", async () => {
      const context = await dueArticle();
      const lead = {
        itemId: context.itemId,
        kind: "lead" as const,
        dueAt: "2026-07-10T08:00:00.000Z",
        leadDays: 14,
      };
      const due = { ...lead, kind: "due" as const };
      expect(await reviewsAt("2026-06-20T00:00:00.000Z").remind(lead)).toBe(false);
      const atLead = reviewsAt("2026-06-26T08:00:00.000Z");
      expect(await Promise.all([atLead.remind(lead), atLead.remind(lead)])).toEqual(
        expect.arrayContaining([true, false]),
      );
      expect(await atLead.remind(due)).toBe(false);
      const atDue = reviewsAt("2026-07-10T08:00:01.000Z");
      await Promise.all([atDue.remind(due), atDue.remind(due), atDue.remind(lead)]);
      expect(await notified("article.reviewDue", context.itemId)).toEqual([
        context.editorId,
        context.editorId,
      ]);
    });

    it("are rescheduled when the interval or the last review changes, and stale jobs do nothing", async () => {
      const context = await dueArticle();
      await queued(reviewsAt("2026-02-01T00:00:00.000Z"));
      const stale = {
        itemId: context.itemId,
        kind: "due" as const,
        dueAt: "2026-07-10T08:00:00.000Z",
        leadDays: 14,
      };

      await reviewsAt(PUBLISHED).setInterval(context.editor, context.itemId, 12);
      expect((await row(context.itemId)).reminders_queued_at).toBeNull();
      const requeued = (await queued(reviewsAt("2026-02-01T00:00:00.000Z"))).filter(
        (entry) => entry.reminder.itemId === context.itemId,
      );
      expect(requeued.map((entry) => entry.reminder.dueAt)).toEqual([
        "2027-01-10T08:00:00.000Z",
        "2027-01-10T08:00:00.000Z",
      ]);
      expect(await reviewsAt("2026-07-11T00:00:00.000Z").remind(stale)).toBe(false);

      await reviewsAt("2026-03-01T00:00:00.000Z").markReviewed(context.editor, context.itemId);
      expect(await dueOf(context.itemId)).toBe("2027-03-01T00:00:00.000Z");
      expect(await notified("article.reviewDue", context.itemId)).toEqual([]);
    });

    it("are requeued when the lead time changes but not sent again", async () => {
      const context = await dueArticle();
      await queued(reviewsAt("2026-02-01T00:00:00.000Z"));
      const lead = {
        itemId: context.itemId,
        kind: "lead" as const,
        dueAt: "2026-07-10T08:00:00.000Z",
        leadDays: 14,
      };
      await reviewsAt("2026-06-27T00:00:00.000Z").remind(lead);
      await reviewsAt(PUBLISHED).updateSettings(context.admin, context.kb.id, { leadDays: 30 });
      const requeued = (await queued(reviewsAt("2026-06-27T00:00:00.000Z"))).filter(
        (entry) => entry.reminder.itemId === context.itemId,
      );
      expect(requeued.map((entry) => entry.reminder.kind)).toEqual(["due"]);
      expect(await notified("article.reviewDue", context.itemId)).toEqual([context.editorId]);
    });

    it("go to space admins as well when the knowledge base asks for it", async () => {
      const context = await dueArticle();
      await reviewsAt(PUBLISHED).updateSettings(context.admin, context.kb.id, {
        recipients: "ownerAndAdministrators",
      });
      await reviewsAt("2026-07-11T00:00:00.000Z").remind({
        itemId: context.itemId,
        kind: "due",
        dueAt: "2026-07-10T08:00:00.000Z",
        leadDays: 14,
      });
      expect(await notified("article.reviewDue", context.itemId)).toEqual(
        [context.adminId, context.editorId].sort(),
      );
    });

    it("go to space admins when the owner was deactivated", async () => {
      const context = await dueArticle();
      await deactivate(context.editorId);
      await reviewsAt("2026-07-11T00:00:00.000Z").remind({
        itemId: context.itemId,
        kind: "due",
        dueAt: "2026-07-10T08:00:00.000Z",
        leadDays: 14,
      });
      expect(await notified("article.reviewDue", context.itemId)).toEqual([context.adminId]);
    });

    it("are not sent for articles in the trash", async () => {
      const context = await dueArticle();
      await test.services.trash.deleteItem(context.editor, context.itemId);
      expect(
        await reviewsAt("2026-07-11T00:00:00.000Z").remind({
          itemId: context.itemId,
          kind: "due",
          dueAt: "2026-07-10T08:00:00.000Z",
          leadDays: 14,
        }),
      ).toBe(false);
    });

    it("are caught up by the safety net when the queued job was lost", async () => {
      const context = await dueArticle();
      await queued(reviewsAt("2026-02-01T00:00:00.000Z"));
      await reviewsAt("2026-07-10T08:05:00.000Z").remindOverdue();
      expect(await notified("article.reviewDue", context.itemId)).toEqual([]);
      await reviewsAt("2026-07-10T09:00:00.000Z").remindOverdue();
      expect(await notified("article.reviewDue", context.itemId)).toEqual([context.editorId]);
      await reviewsAt("2026-07-10T10:00:00.000Z").remindOverdue();
      expect(await notified("article.reviewDue", context.itemId)).toEqual([context.editorId]);
    });
  });

  describe("review list", () => {
    it("shows only articles the person may edit", async () => {
      const context = await setup();
      const open = await article(context.editor, context.kb.id, "Open article");
      const locked = await article(context.admin, context.kb.id, "Locked article");
      await test.services.pageAccess.change(context.admin, locked, [{ action: "restrict", kind: "edit" }]);
      await reviewsAt(PUBLISHED).updateSettings(context.admin, context.kb.id, { intervalMonths: 3 });
      const now = "2026-05-01T00:00:00.000Z";
      const ids = async (actor: Principal) =>
        (await reviewsAt(now).list(actor, context.kb.id, { page: { limit: 50 } })).items.map(
          (item) => item.id,
        );
      expect(await ids(context.editor)).toEqual([open]);
      expect((await ids(context.admin)).sort()).toEqual([open, locked].sort());
      expect(await ids(context.reader)).toEqual([]);
    });

    it("filters by state and owner and counts every state", async () => {
      const context = await setup();
      const overdue = await article(context.editor, context.kb.id, "Overdue");
      const soon = await article(context.admin, context.kb.id, "Soon");
      const later = await article(context.editor, context.kb.id, "Later");
      await reviewsAt(PUBLISHED).updateSettings(context.admin, context.kb.id, { intervalMonths: 6 });
      await reviewsAt(PUBLISHED).setInterval(context.editor, overdue, 3);
      await reviewsAt(PUBLISHED).setInterval(context.editor, later, 12);
      const reviews = reviewsAt("2026-06-20T00:00:00.000Z");
      const all = await reviews.list(context.admin, context.kb.id, { page: { limit: 50 } });
      expect(all.items.map((item) => [item.title, item.state])).toEqual([
        ["Overdue", "overdue"],
        ["Soon", "dueSoon"],
      ]);
      expect(all.counts).toEqual({ all: 2, due: 1, soon: 1, unowned: 0, translations: 0 });
      const due = await reviews.list(context.admin, context.kb.id, { filter: "due", page: { limit: 50 } });
      expect(due.items.map((item) => [item.id, item.number])).toEqual([[overdue, await numberOf(overdue)]]);
      const mine = await reviews.list(context.admin, context.kb.id, { mine: true, page: { limit: 50 } });
      expect(mine.items.map((item) => item.id)).toEqual([soon]);
      const first = await reviews.list(context.admin, context.kb.id, { page: { limit: 1 } });
      expect(first.items.map((item) => item.id)).toEqual([overdue]);
      const second = await reviews.list(context.admin, context.kb.id, {
        page: { limit: 1, after: first.next ?? undefined },
      });
      expect(second.items.map((item) => item.id)).toEqual([soon]);
      expect(second.next).toBeNull();
    });

    it("lists articles whose owner was deactivated, and notifies the space admins", async () => {
      const context = await setup();
      const itemId = await article(context.editor, context.kb.id, "Orphan");
      await test.services.memberships.deactivate(context.admin, context.editorId);
      const listed = await reviewsAt("2026-02-01T00:00:00.000Z").list(context.admin, context.kb.id, {
        filter: "unowned",
        page: { limit: 50 },
      });
      expect(listed.items).toMatchObject([
        { id: itemId, owner: null, ownerActive: false, formerOwner: { id: context.editorId } },
      ]);
      const orphaned = await test.database.execute<{ recipient_id: string }>(sql`
        select recipient_id from notifications where type = 'ownership.orphaned' and target_id = ${context.kb.id}`);
      expect(orphaned.rows.map((found) => found.recipient_id)).toEqual([context.adminId]);
    });
  });

  describe("marking as reviewed", () => {
    async function overdueArticle() {
      const context = await setup();
      const itemId = await article(context.editor, context.kb.id);
      await reviewsAt(PUBLISHED).updateSettings(context.admin, context.kb.id, { intervalMonths: 3 });
      return { ...context, itemId };
    }

    async function versions(itemId: string): Promise<number> {
      const result = await test.database.execute<{ versions: number }>(
        sql`select count(*)::int as versions from page_versions where item_id = ${itemId}`,
      );
      return Number(result.rows[0]?.versions ?? 0);
    }

    it("records who and when in the history without a new version, and is audited", async () => {
      const context = await overdueArticle();
      const before = await versions(context.itemId);
      const now = "2026-05-01T09:00:00.000Z";
      const record = await reviewsAt(now).markReviewed(context.admin, context.itemId);
      expect(record.dueAt?.toISOString()).toBe("2026-08-01T09:00:00.000Z");
      expect(await versions(context.itemId)).toBe(before);
      expect(await reviewsAt(now).history(context.editor, context.itemId)).toMatchObject([
        { id: record.reviewId, actor: { id: context.adminId, name: "Admin" }, via: "marked" },
      ]);
      expect(await auditNames(context.itemId)).toContain("article.reviewed");
      const listed = await reviewsAt(now).list(context.admin, context.kb.id, { page: { limit: 50 } });
      expect(listed.items).toEqual([]);
    });

    it("can be undone by the same person shortly afterwards", async () => {
      const context = await overdueArticle();
      await reviewsAt("2026-04-11T00:00:00.000Z").remind({
        itemId: context.itemId,
        kind: "due",
        dueAt: "2026-04-10T08:00:00.000Z",
        leadDays: 14,
      });
      const record = await reviewsAt("2026-05-01T09:00:00.000Z").markReviewed(context.editor, context.itemId);
      await expect(
        reviewsAt("2026-05-01T09:00:05.000Z").undoReview(context.admin, context.itemId, record.reviewId),
      ).rejects.toMatchObject({ code: "reviewNotUndoable" });
      await expect(
        reviewsAt("2026-05-01T09:10:00.000Z").undoReview(context.editor, context.itemId, record.reviewId),
      ).rejects.toMatchObject({ code: "reviewNotUndoable" });
      await reviewsAt("2026-05-01T09:00:05.000Z").undoReview(context.editor, context.itemId, record.reviewId);
      expect(await dueOf(context.itemId)).toBe("2026-04-10T08:00:00.000Z");
      expect((await row(context.itemId)).due_reminded_at).not.toBeNull();
      expect(await reviewsAt("2026-05-01T09:00:05.000Z").history(context.editor, context.itemId)).toEqual([]);
      expect(await auditNames(context.itemId)).toEqual(
        expect.arrayContaining(["article.reviewed", "article.reviewUndone"]),
      );
      await reviewsAt("2026-05-01T10:00:00.000Z").remindOverdue();
      expect(await notified("article.reviewDue", context.itemId)).toEqual([context.editorId]);
    });

    it("counts when the author ticks the review while publishing", async () => {
      const context = await overdueArticle();
      await test.services.documents.replace(context.editor, context.itemId, {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Updated" }] }],
      });
      await test.services.versions.publish(context.editor, context.itemId, { reviewed: true });
      const history = await reviewsAt(new Date()).history(context.editor, context.itemId);
      expect(history).toMatchObject([{ via: "published", actor: { id: context.editorId } }]);
    });

    it("does not count a publication without the tick", async () => {
      const context = await overdueArticle();
      await test.services.documents.replace(context.editor, context.itemId, {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Updated" }] }],
      });
      await test.services.versions.publish(context.editor, context.itemId);
      expect(await reviewsAt(new Date()).history(context.editor, context.itemId)).toEqual([]);
      expect(await dueOf(context.itemId)).toBe("2026-04-10T08:00:00.000Z");
    });
  });

  describe("source pages", () => {
    async function withSource() {
      const context = await setup();
      const internal = await space(context.org.id, context.adminId, {
        grants: [{ principalKind: "account", principalId: context.editorId, role: "editor" }],
      });
      const source = await test.services.tree.create(context.admin, internal.id, {
        kind: "page",
        title: "VPN gateway",
        placement: { parentId: null },
      });
      const itemId = await article(context.editor, context.kb.id);
      await reviewsAt(PUBLISHED).addSource(context.editor, itemId, source.id);
      return { ...context, internal, sourceId: source.id, itemId };
    }

    async function changeSource(actor: Principal, sourceId: string, text: string) {
      await test.services.documents.replace(actor, sourceId, {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      });
      await test.services.versions.publish(actor, sourceId);
    }

    it("flags the article and notifies its owner once when the source is published with changes", async () => {
      const context = await withSource();
      await changeSource(context.admin, context.sourceId, "New gateway address");
      expect((await row(context.itemId)).source_changed_at).not.toBeNull();
      await changeSource(context.admin, context.sourceId, "Another change");
      expect(await notified("article.sourceChanged", context.itemId)).toEqual([context.editorId]);
      const listed = await reviewsAt(new Date()).list(context.editor, context.kb.id, { page: { limit: 50 } });
      expect(listed.items).toMatchObject([{ id: context.itemId, state: "sourceChanged" }]);
      await reviewsAt(new Date()).markReviewed(context.editor, context.itemId);
      expect((await row(context.itemId)).source_changed_at).toBeNull();
      expect((await reviewsAt(new Date()).sources(context.editor, context.itemId))[0]?.changedAt).toBeNull();
    });

    it("does not flag the article when the source moved to another organization", async () => {
      const context = await withSource();
      const otherOrg = await organization();
      await test.database.execute(
        sql`update spaces set organization_id = ${otherOrg.id} where id = ${context.internal.id}`,
      );
      await changeSource(context.admin, context.sourceId, "Changed elsewhere");
      expect((await row(context.itemId)).source_changed_at).toBeNull();
      expect(await notified("article.sourceChanged", context.itemId)).toEqual([]);
    });

    it("does not flag the article when a publication changes nothing", async () => {
      const context = await withSource();
      await test.services.versions.publish(context.admin, context.sourceId);
      await test.services.versions.publish(context.admin, context.sourceId);
      expect((await row(context.itemId)).source_changed_at).not.toBeNull();
      await reviewsAt(new Date()).markReviewed(context.editor, context.itemId);
      await test.services.versions.publish(context.admin, context.sourceId);
      expect((await row(context.itemId)).source_changed_at).toBeNull();
    });

    it("shows the source only to people who can read it", async () => {
      const context = await withSource();
      expect(await reviewsAt(new Date()).sources(context.editor, context.itemId)).toMatchObject([
        { id: context.sourceId, number: await numberOf(context.sourceId), title: "VPN gateway" },
      ]);
      expect(await reviewsAt(new Date()).sources(context.reader, context.itemId)).toEqual([]);
      await expect(
        reviewsAt(new Date()).removeSource(context.reader, context.itemId, context.sourceId),
      ).rejects.toMatchObject({ code: "sourceNotFound" });
    });

    it("lets editors remove source pages they cannot read, without showing them", async () => {
      const context = await withSource();
      const colleagueId = await member(context.org.id, "member", "Colleague");
      await test.services.spacePermissions.apply(context.admin, context.kb.id, {
        action: "grant",
        principalKind: "account",
        principalId: colleagueId,
        role: "editor",
      });
      const colleague = accountPrincipal(colleagueId);
      await changeSource(context.admin, context.sourceId, "New gateway address");
      const reviews = reviewsAt(new Date());
      expect(await reviews.sources(colleague, context.itemId)).toEqual([]);
      expect(await reviews.hiddenSources(colleague, context.itemId)).toEqual({ count: 1, changed: true });
      expect(await reviews.hiddenSources(context.editor, context.itemId)).toEqual({
        count: 0,
        changed: false,
      });
      expect(await reviews.removeHiddenSources(colleague, context.itemId)).toEqual({
        count: 0,
        changed: false,
      });
      expect(await reviews.sources(context.editor, context.itemId)).toEqual([]);
      expect((await row(context.itemId)).source_changed_at).toBeNull();
      const audit = await test.database.execute<{ source_id: string }>(sql`
        select fields ->> 'sourceId' as source_id from audit_events
        where name = 'article.sourceRemoved' and target_id = ${context.itemId}`);
      expect(audit.rows).toEqual([{ source_id: context.sourceId }]);
    });

    it("refuses sources the person cannot read, articles and missing pages", async () => {
      const context = await withSource();
      const hidden = await space(context.org.id, context.adminId);
      const secret = await test.services.tree.create(context.admin, hidden.id, {
        kind: "page",
        title: "Secret",
        placement: { parentId: null },
      });
      const other = await article(context.editor, context.kb.id);
      const reviews = reviewsAt(new Date());
      await expect(reviews.addSource(context.editor, context.itemId, secret.id)).rejects.toMatchObject({
        code: "sourceNotFound",
      });
      await expect(reviews.addSource(context.editor, context.itemId, randomUUID())).rejects.toMatchObject({
        code: "sourceNotFound",
      });
      await expect(reviews.addSource(context.editor, context.itemId, other)).rejects.toMatchObject({
        code: "invalidSourcePage",
      });
    });

    it("refuses pages of confidential spaces and of other organizations", async () => {
      const context = await withSource();
      const confidential = await test.services.spaces.create(
        context.editor,
        context.org.id,
        {
          name: `Council ${randomUUID().slice(0, 6)}`,
          key: `C${randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`,
          visibility: "private",
          confidential: true,
          grants: [],
        },
        test.services.spacePermissions.holders,
      );
      const secret = await test.services.tree.create(context.editor, confidential.id, {
        kind: "page",
        title: "One-on-one",
        placement: { parentId: null },
      });
      await expect(
        reviewsAt(new Date()).addSource(context.editor, context.itemId, secret.id),
      ).rejects.toMatchObject({ code: "invalidSourcePage" });
      const otherOrg = await organization();
      await join(otherOrg.id, context.editorId);
      const foreign = await space(otherOrg.id, context.editorId);
      const page = await test.services.tree.create(context.editor, foreign.id, {
        kind: "page",
        title: "Elsewhere",
        placement: { parentId: null },
      });
      await expect(
        reviewsAt(new Date()).addSource(context.editor, context.itemId, page.id),
      ).rejects.toMatchObject({ code: "invalidSourcePage" });
    });

    it("shows the changed source only to editors of the article", async () => {
      const context = await withSource();
      await changeSource(context.admin, context.sourceId, "Changed");
      expect((await reviewsAt(new Date()).article(context.editor, context.itemId)).state).toBe(
        "sourceChanged",
      );
      const read = await reviewsAt(new Date()).article(context.reader, context.itemId);
      expect(read).toMatchObject({ sourceChangedAt: null });
      expect(read.state).not.toBe("sourceChanged");
    });

    it("never appear in the machine-readable article", async () => {
      const context = await withSource();
      const read = await test.services.knowledgeBases.article(context.editor, context.itemId);
      expect(JSON.stringify(read)).not.toContain(context.sourceId);
      expect(JSON.stringify(read)).not.toContain("VPN gateway");
    });

    it("audits adding and removing a source", async () => {
      const context = await withSource();
      await reviewsAt(new Date()).removeSource(context.editor, context.itemId, context.sourceId);
      expect(await auditNames(context.itemId)).toEqual(
        expect.arrayContaining(["article.sourceAdded", "article.sourceRemoved"]),
      );
    });
  });

  describe("personal home page", () => {
    it("lists the person's own due articles", async () => {
      const context = await setup();
      const own = await article(context.editor, context.kb.id, "Own");
      await article(context.admin, context.kb.id, "Someone else's");
      await reviewsAt(PUBLISHED).updateSettings(context.admin, context.kb.id, { intervalMonths: 3 });
      const mine = await reviewsAt("2026-05-01T00:00:00.000Z").mine(context.editor);
      expect(mine).toMatchObject({
        total: 1,
        items: [{ id: own, number: await numberOf(own), state: "overdue", spaceKey: context.kb.key }],
      });
      await reviewsAt("2026-05-01T00:00:00.000Z").markReviewed(context.editor, own);
      expect((await reviewsAt("2026-05-01T00:00:00.000Z").mine(context.editor)).items).toEqual([]);
    });
  });
});
