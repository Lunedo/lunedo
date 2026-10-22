import { randomUUID } from "node:crypto";
import type { DocumentJson, NodeJson } from "@lunedo/editor-schema";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, SYSTEM } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import {
  digestTimeSetting,
  notificationEventSettings,
  notificationRetentionSetting,
  watchAutomaticallySetting,
} from "./types.js";

const baseUrl = testDatabaseBaseUrl();

function paragraph(...content: (NodeJson | string)[]): NodeJson {
  return {
    type: "paragraph",
    content: content.map((part) => (typeof part === "string" ? { type: "text", text: part } : part)),
  };
}

function mention(id: string): NodeJson {
  return { type: "mention", attrs: { id } };
}

function task(label: string, assignee: string): NodeJson {
  return {
    type: "taskList",
    content: [{ type: "taskItem", attrs: { id: randomUUID(), assignee }, content: [paragraph(label)] }],
  };
}

function doc(...content: NodeJson[]): DocumentJson {
  return { type: "doc", content };
}

function settingsOf(event: string) {
  const settings = notificationEventSettings.get(event);
  if (!settings) throw new Error(`No settings for ${event}`);
  return settings;
}

describe.skipIf(!baseUrl)("watching", () => {
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
    const secondEditorId = await member(org.id, "member", "Second editor");
    const readerId = await member(org.id, "member", "Reader");
    const adminId = await member(org.id, "member", "Space admin");
    const commenterId = await member(org.id, "member", "Commenter");
    const created = await space(org.id, adminId, {
      grants: [
        { principalKind: "account", principalId: commenterId, role: "commenter" },
        { principalKind: "account", principalId: editorId, role: "editor" },
        { principalKind: "account", principalId: secondEditorId, role: "editor" },
        { principalKind: "account", principalId: readerId, role: "reader" },
      ],
    });
    return {
      org,
      space: created,
      editorId,
      secondEditorId,
      readerId,
      adminId,
      commenterId,
      editor: accountPrincipal(editorId),
      secondEditor: accountPrincipal(secondEditorId),
      reader: accountPrincipal(readerId),
      admin: accountPrincipal(adminId),
    };
  }

  type Context = Awaited<ReturnType<typeof setup>>;

  async function publishedPage(context: Context, content: DocumentJson = doc(paragraph("Runbook"))) {
    const created = await test.services.tree.create(context.editor, context.space.id, {
      kind: "page",
      title: `Page ${randomUUID().slice(0, 6)}`,
      mode: "publish",
      placement: { parentId: null },
    });
    await test.services.documents.replace(context.editor, created.id, content);
    await test.services.versions.publish(context.editor, created.id);
    return created;
  }

  async function edit(actor: ReturnType<typeof accountPrincipal>, itemId: string, words: string) {
    await test.services.documents.replace(actor, itemId, doc(paragraph(words)));
    await test.services.versions.publish(actor, itemId);
  }

  async function notificationsOf(accountId: string, type?: string) {
    const items = (await test.services.notifications.list(accountId, { limit: 100 })).items;
    return type ? items.filter((item) => item.type === type) : items;
  }

  async function storedRows(accountId: string, type: string) {
    const result = await test.database.execute<{ id: string }>(
      sql`select id from notifications where recipient_id = ${accountId} and type = ${type}`,
    );
    return result.rows.length;
  }

  describe("automatically", () => {
    it("watches what people create, edit and comment on", async () => {
      const context = await setup();
      const page = await publishedPage(context);
      expect(
        (await test.services.watches.status(context.editorId, { type: "item", id: page.id })).own,
      ).toEqual({
        state: "watching",
        keepActionable: true,
        automatic: true,
      });

      await edit(context.secondEditor, page.id, "Second edit");
      const second = await test.services.watches.status(context.secondEditorId, {
        type: "item",
        id: page.id,
      });
      expect(second.own?.state).toBe("watching");
    });

    it("watches as a commenter and stays off for people who turned it off", async () => {
      const context = await setup();
      const commenterId = context.commenterId;
      const page = await publishedPage(context);
      await test.services.comments.create(accountPrincipal(commenterId), page.id, {
        body: doc(paragraph("Looks good")),
      });
      expect(
        (await test.services.watches.status(commenterId, { type: "item", id: page.id })).own?.state,
      ).toBe("watching");

      await test.settings.set(watchAutomaticallySetting, { user: context.secondEditorId }, "user", false);
      await edit(context.secondEditor, page.id, "Quiet edit");
      expect(
        (await test.services.watches.status(context.secondEditorId, { type: "item", id: page.id })).own,
      ).toBeNull();
    });

    it("never overrides a state the person chose", async () => {
      const context = await setup();
      const page = await publishedPage(context);
      await test.services.watches.set(
        context.secondEditorId,
        { type: "item", id: page.id },
        { state: "notWatching" },
      );
      await edit(context.secondEditor, page.id, "Edit");
      expect(
        (await test.services.watches.status(context.secondEditorId, { type: "item", id: page.id })).own,
      ).toMatchObject({ state: "notWatching", automatic: false });
    });
  });

  describe("changes", () => {
    it("combine several edits on one item into one notification with all people who took part", async () => {
      const context = await setup();
      const page = await publishedPage(context);
      await test.services.watches.set(context.readerId, { type: "item", id: page.id }, { state: "watching" });
      await edit(context.editor, page.id, "First");
      await edit(context.secondEditor, page.id, "Second");
      await edit(context.editor, page.id, "Third");
      const changes = await notificationsOf(context.readerId, "content.changed");
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({ count: 3, actorCount: 2, actor: { id: context.editorId } });
      expect(changes[0]?.params).toMatchObject({ itemTitle: page.title, version: 4 });
    });

    it("start a new notification once the last one is read or older than the window", async () => {
      const context = await setup();
      const page = await publishedPage(context);
      await test.services.watches.set(context.readerId, { type: "item", id: page.id }, { state: "watching" });
      await edit(context.editor, page.id, "First");
      const [first] = await notificationsOf(context.readerId, "content.changed");
      await test.services.notifications.markRead(context.readerId, first?.id ?? "");
      await edit(context.editor, page.id, "Second");
      expect(await notificationsOf(context.readerId, "content.changed")).toHaveLength(2);

      await test.database.execute(sql`
        update notifications set updated_at = now() - interval '31 minutes'
        where recipient_id = ${context.readerId} and read_at is null`);
      await edit(context.editor, page.id, "Third");
      expect(await notificationsOf(context.readerId, "content.changed")).toHaveLength(3);

      await test.database.execute(sql`
        update notifications set created_at = now() - interval '25 hours', updated_at = now() - interval '1 minute'
        where recipient_id = ${context.readerId} and read_at is null`);
      await edit(context.editor, page.id, "Fourth");
      expect(await notificationsOf(context.readerId, "content.changed")).toHaveLength(4);
    });

    it("never notify people about their own actions", async () => {
      const context = await setup();
      const page = await publishedPage(context, doc(paragraph("Ask ", mention(context.editorId))));
      await edit(context.editor, page.id, "Own edit");
      await test.services.comments.create(context.editor, page.id, { body: doc(paragraph("Own comment")) });
      await test.services.documents.replace(context.editor, page.id, doc(task("Own task", context.editorId)));
      await test.services.versions.publish(context.editor, page.id);
      expect(await notificationsOf(context.editorId)).toEqual([]);

      await edit(context.secondEditor, page.id, "Someone else");
      expect(await notificationsOf(context.editorId, "content.changed")).toHaveLength(1);
    });

    it("reach watchers of the space unless the item says otherwise", async () => {
      const context = await setup();
      await test.services.watches.set(
        context.readerId,
        { type: "space", id: context.space.id },
        { state: "watching" },
      );
      const page = await publishedPage(context);
      await edit(context.secondEditor, page.id, "Change");
      expect(await notificationsOf(context.readerId, "content.changed")).toHaveLength(1);

      const quiet = await publishedPage(context);
      await test.services.watches.set(
        context.readerId,
        { type: "item", id: quiet.id },
        { state: "notWatching" },
      );
      await edit(context.secondEditor, quiet.id, "Change");
      const changed = await notificationsOf(context.readerId, "content.changed");
      expect(changed.find((item) => item.target.id === quiet.id)?.count).toBe(1);
    });

    it("reach watchers of a meeting series for each meeting in it", async () => {
      const context = await setup();
      const seriesId = await test.services.meetings.createSeries(context.editor, context.space.id, {
        name: "Jour fixe",
        parentId: null,
        members: [context.editorId],
        templateId: "builtin:team-meeting",
        rhythm: { frequency: "weekly", interval: 1, weekdays: ["MO"] },
        startsOn: "2030-03-18",
        startTime: "09:30",
        timeZone: "Europe/Vienna",
        durationMinutes: 45,
      });
      await test.services.watches.set(
        context.readerId,
        { type: "item", id: seriesId },
        { state: "watching" },
      );
      const meetingId = (await test.services.meetings.details(context.editor, seriesId)).upcoming?.id ?? "";
      await test.services.documents.replace(context.secondEditor, meetingId, doc(paragraph("Agenda")));
      await test.services.versions.versionLiveSession(meetingId);
      const changes = await notificationsOf(context.readerId, "content.changed");
      expect(changes.map((item) => [item.target.id, item.actor?.id])).toEqual([
        [meetingId, context.secondEditorId],
      ]);
    });

    it("tell watchers about status and owner changes and the new owner about the transfer", async () => {
      const context = await setup();
      const page = await publishedPage(context);
      await test.services.watches.set(context.readerId, { type: "item", id: page.id }, { state: "watching" });
      const [value] = await test.services.pageStatus.values(SYSTEM, context.space.id);
      await test.services.pageStatus.set(context.editor, page.id, value?.id ?? "");
      const [status] = await notificationsOf(context.readerId, "page.statusChanged");
      expect(status?.params).toMatchObject({ statusBuiltIn: "roughDraft", statusName: null });

      await test.services.ownership.transfer(context.editor, page.id, context.secondEditorId);
      expect(await notificationsOf(context.secondEditorId, "ownership.transferred")).toHaveLength(1);
      const [transfer] = await notificationsOf(context.readerId, "ownership.transferred");
      expect(transfer?.params).toEqual({
        itemTitle: page.title,
        itemKind: "page",
        spaceKey: context.space.key,
        ownerId: context.secondEditorId,
      });
      expect(await notificationsOf(context.editorId, "ownership.transferred")).toEqual([]);
    });

    it("notify watchers about comments and leave the mention to the mention notification", async () => {
      const context = await setup();
      const page = await publishedPage(context);
      await test.services.watches.set(context.readerId, { type: "item", id: page.id }, { state: "watching" });
      await test.services.comments.create(context.secondEditor, page.id, {
        body: doc(paragraph("Hello ", mention(context.editorId))),
      });
      expect(await notificationsOf(context.readerId, "comment.created")).toHaveLength(1);
      expect(await notificationsOf(context.editorId, "comment.created")).toEqual([]);
      expect(await notificationsOf(context.editorId, "content.mentioned")).toHaveLength(1);
    });

    it("never come from imports", async () => {
      const context = await setup();
      const page = await publishedPage(context);
      await test.services.watches.set(context.readerId, { type: "item", id: page.id }, { state: "watching" });
      await test.database.transaction((tx) =>
        test.services.versions.importVersion(tx, {
          itemId: page.id,
          title: page.title,
          document: doc(paragraph("Imported ", mention(context.readerId))),
          authorId: context.secondEditorId,
          apply: true,
        }),
      );
      expect(await notificationsOf(context.readerId)).toEqual([]);
      expect(
        (await test.services.watches.status(context.secondEditorId, { type: "item", id: page.id })).own,
      ).toBeNull();
    });
  });

  describe("muting", () => {
    it("silences a space but keeps mentions and assigned tasks by default", async () => {
      const context = await setup();
      const page = await publishedPage(context);
      await test.services.watches.set(context.readerId, { type: "item", id: page.id }, { state: "watching" });
      await test.services.watches.set(
        context.editorId,
        { type: "space", id: context.space.id },
        { state: "muted" },
      );
      await test.services.watches.set(
        context.readerId,
        { type: "space", id: context.space.id },
        { state: "muted" },
      );

      await test.services.documents.replace(
        context.secondEditor,
        page.id,
        doc(paragraph("Ask ", mention(context.editorId)), task("Check", context.editorId)),
      );
      await test.services.versions.publish(context.secondEditor, page.id);
      await test.services.comments.create(context.secondEditor, page.id, { body: doc(paragraph("Comment")) });
      expect((await notificationsOf(context.editorId)).map((item) => item.type).sort()).toEqual([
        "content.mentioned",
        "task.assigned",
      ]);
      expect((await notificationsOf(context.readerId)).map((item) => item.type).sort()).toEqual([
        "comment.created",
        "content.changed",
      ]);
    });

    it("silences mentions and tasks too when the person chooses so", async () => {
      const context = await setup();
      const page = await publishedPage(context);
      await test.services.watches.set(
        context.editorId,
        { type: "item", id: page.id },
        { state: "muted", keepActionable: false },
      );
      await test.services.documents.replace(
        context.secondEditor,
        page.id,
        doc(paragraph("Ask ", mention(context.editorId)), task("Check", context.editorId)),
      );
      await test.services.versions.publish(context.secondEditor, page.id);
      expect(await notificationsOf(context.editorId)).toEqual([]);
    });

    it("keeps access requests the person can decide from a muted space by default", async () => {
      const context = await setup();
      const requesterId = await member(context.org.id, "member", "Requester");
      await test.services.watches.set(
        context.adminId,
        { type: "space", id: context.space.id },
        { state: "muted" },
      );
      const page = await publishedPage(context);
      await test.services.accessRequests.requestPage(accountPrincipal(requesterId), page.id, "Please");
      expect(await notificationsOf(context.adminId, "access.requested")).toHaveLength(1);
    });

    it("keeps shares with the person from a muted space by default", async () => {
      const context = await setup();
      const guestId = await member(context.org.id, "member", "Shared person");
      await test.services.watches.set(guestId, { type: "space", id: context.space.id }, { state: "muted" });
      const page = await publishedPage(context);
      await test.services.pageAccess.change(context.editor, page.id, [
        { action: "share", holderKind: "account", holderId: guestId, role: "reader" },
      ]);
      expect(await notificationsOf(guestId, "page.shared")).toHaveLength(1);
    });

    it("silences access requests for a muted space when the person chooses so", async () => {
      const context = await setup();
      const requesterId = await member(context.org.id, "member", "Requester");
      await test.services.watches.set(
        context.adminId,
        { type: "space", id: context.space.id },
        { state: "muted", keepActionable: false },
      );
      const page = await publishedPage(context);
      await test.services.accessRequests.requestPage(accountPrincipal(requesterId), page.id, "Please");
      expect(await notificationsOf(context.adminId, "access.requested")).toEqual([]);
    });
  });

  describe("access", () => {
    it("never grants access: losing it stops delivery and hides old notifications until it returns", async () => {
      const context = await setup();
      const page = await publishedPage(context);
      await test.services.watches.set(context.readerId, { type: "item", id: page.id }, { state: "watching" });
      await edit(context.secondEditor, page.id, "Visible change");
      expect(await test.services.notifications.unreadCount(context.readerId)).toBe(1);

      await test.services.pageAccess.change(context.editor, page.id, [{ action: "restrict", kind: "view" }]);
      expect(await notificationsOf(context.readerId)).toEqual([]);
      expect(await test.services.notifications.unreadCount(context.readerId)).toBe(0);
      await test.database.execute(
        sql`update notifications set read_at = now() where recipient_id = ${context.readerId}`,
      );
      await edit(context.secondEditor, page.id, "Secret change");
      expect(await storedRows(context.readerId, "content.changed")).toBe(1);
      expect(
        (await test.services.watches.status(context.readerId, { type: "item", id: page.id })).own?.state,
      ).toBe("watching");
      expect(
        (await test.services.watches.list(context.readerId)).map((entry) => entry.target.id),
      ).not.toContain(page.id);

      await test.services.pageAccess.change(context.editor, page.id, [
        { action: "unrestrict", kind: "view" },
      ]);
      expect(await notificationsOf(context.readerId, "content.changed")).toHaveLength(1);
      await edit(context.secondEditor, page.id, "Open again");
      expect(await notificationsOf(context.readerId, "content.changed")).toHaveLength(2);
      expect(await test.services.notifications.unreadCount(context.readerId)).toBe(1);
    });

    it("follows shares: a person with a share watches and loses delivery when the share ends", async () => {
      const context = await setup();
      const guestId = await member(context.org.id, "member", "Shared person");
      const page = await publishedPage(context);
      const shared = await test.services.pageAccess.change(context.editor, page.id, [
        { action: "share", holderKind: "account", holderId: guestId, role: "reader" },
      ]);
      await test.services.watches.set(guestId, { type: "item", id: page.id }, { state: "watching" });
      await edit(context.secondEditor, page.id, "Change");
      expect(await notificationsOf(guestId, "content.changed")).toHaveLength(1);

      const share = shared.shares.find((entry) => entry.holder.id === guestId);
      await test.services.pageAccess.change(context.editor, page.id, [
        { action: "removeShare", shareId: share?.id ?? "" },
      ]);
      expect(await notificationsOf(guestId)).toEqual([]);
      expect(await test.services.notifications.unreadCount(guestId)).toBe(0);
    });

    it("stops delivery when the membership ends and keeps confidential spaces closed to administrators", async () => {
      const context = await setup();
      const page = await publishedPage(context);
      await test.services.watches.set(context.readerId, { type: "item", id: page.id }, { state: "watching" });
      await edit(context.secondEditor, page.id, "Before");
      await test.services.memberships.remove(SYSTEM, context.org.id, context.readerId, "removed", {
        releaseHome: true,
      });
      expect(await notificationsOf(context.readerId)).toEqual([]);
      await edit(context.editor, page.id, "After");
      expect(await storedRows(context.readerId, "content.changed")).toBe(1);

      const council = await test.services.spaces.create(
        context.editor,
        context.org.id,
        {
          name: `Council ${randomUUID().slice(0, 6)}`,
          key: `C${randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`,
          visibility: "private",
          confidential: true,
          grants: [{ principalKind: "account", principalId: context.secondEditorId, role: "editor" }],
        },
        test.services.spacePermissions.holders,
      );
      await test.database.execute(sql`
        insert into watches (id, account_id, space_id, state) values (gen_random_uuid(), ${context.org.owner}, ${council.id}, 'watching')`);
      const notes = await test.services.tree.create(context.editor, council.id, {
        kind: "page",
        title: "Notes",
        mode: "publish",
        placement: { parentId: null },
      });
      await test.services.versions.publish(context.editor, notes.id);
      await edit(context.secondEditor, notes.id, "Confidential change");
      expect(await storedRows(context.org.owner, "content.changed")).toBe(0);
      const notesChanges = await notificationsOf(context.editorId, "content.changed");
      expect(notesChanges.filter((item) => item.target.id === notes.id)).toHaveLength(1);
    });
  });

  describe("preferences", () => {
    it("follow organization defaults and the person's own choice, with a reset", async () => {
      const context = await setup();
      const changes = settingsOf("changes");
      const page = await publishedPage(context);
      await test.services.watches.set(context.readerId, { type: "item", id: page.id }, { state: "watching" });
      await test.settings.set(changes.inApp, { organization: context.org.id }, "organization", false);
      await edit(context.secondEditor, page.id, "Org default off");
      expect(await storedRows(context.readerId, "content.changed")).toBe(0);

      const own = { organization: context.org.id, user: context.readerId };
      await test.settings.set(changes.inApp, own, "user", true);
      await test.settings.set(changes.inApp, { organization: context.org.id }, "organization", false);
      await edit(context.secondEditor, page.id, "Own choice on");
      expect(await storedRows(context.readerId, "content.changed")).toBe(1);
      expect(await test.settings.get(changes.email, own)).toBe("off");

      await test.settings.clear(changes.inApp, own, "user");
      await test.database.execute(
        sql`update notifications set read_at = now() where recipient_id = ${context.readerId}`,
      );
      await edit(context.secondEditor, page.id, "Back to the default");
      expect(await storedRows(context.readerId, "content.changed")).toBe(1);
    });

    it("inherit the digest time from the instance through the organization", async () => {
      const context = await setup();
      const own = { organization: context.org.id, user: context.readerId };
      expect(await test.settings.get(digestTimeSetting, own)).toBe("08:00");
      await test.settings.set(digestTimeSetting, { organization: context.org.id }, "organization", "07:00");
      expect(await test.settings.get(digestTimeSetting, own)).toBe("07:00");
      await test.settings.set(digestTimeSetting, own, "user", "17:00");
      await test.settings.set(digestTimeSetting, { organization: context.org.id }, "organization", "12:00");
      expect(await test.settings.get(digestTimeSetting, own)).toBe("17:00");
    });
  });

  describe("retention", () => {
    it("deletes notifications older than the period of their organization", async () => {
      const short = await setup();
      const long = await setup();
      await test.settings.set(
        notificationRetentionSetting,
        { organization: short.org.id },
        "organization",
        30,
      );
      for (const context of [short, long]) {
        const page = await publishedPage(context);
        await test.services.watches.set(
          context.readerId,
          { type: "item", id: page.id },
          { state: "watching" },
        );
        await edit(context.secondEditor, page.id, "Old change");
        await test.database.execute(sql`
          update notifications set updated_at = now() - interval '40 days' where recipient_id = ${context.readerId}`);
      }
      await test.services.notifications.applyRetention();
      expect(await storedRows(short.readerId, "content.changed")).toBe(0);
      expect(await storedRows(long.readerId, "content.changed")).toBe(1);
    });
  });

  describe("watched items", () => {
    it("list watched and muted items", async () => {
      const context = await setup();
      const page = await publishedPage(context);
      await test.services.watches.set(context.readerId, { type: "item", id: page.id }, { state: "watching" });
      await test.services.watches.set(
        context.readerId,
        { type: "space", id: context.space.id },
        { state: "muted" },
      );
      const entries = await test.services.watches.list(context.readerId);
      expect(entries.map((entry) => [entry.target.type, entry.state])).toEqual([
        ["space", "muted"],
        ["item", "watching"],
      ]);
      await test.services.watches.set(
        context.readerId,
        { type: "space", id: context.space.id },
        { state: null },
      );
      expect((await test.services.watches.list(context.readerId)).map((entry) => entry.target.id)).toEqual([
        page.id,
      ]);
    });
  });
});
