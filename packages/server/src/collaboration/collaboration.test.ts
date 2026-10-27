import { randomUUID } from "node:crypto";
import type { DocumentJson, NodeJson } from "@lunedo/editor-schema";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, type Principal } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { reactionsEnabledSetting } from "./settings.js";

const baseUrl = testDatabaseBaseUrl();

function text(value: string): NodeJson {
  return { type: "text", text: value };
}

function paragraph(...content: (NodeJson | string)[]): NodeJson {
  return {
    type: "paragraph",
    content: content.map((part) => (typeof part === "string" ? text(part) : part)),
  };
}

function mention(id: string): NodeJson {
  return { type: "mention", attrs: { id } };
}

function task(id: string, label: string, attrs: { assignee?: string; dueDate?: string } = {}): NodeJson {
  return {
    type: "taskList",
    content: [{ type: "taskItem", attrs: { id, ...attrs }, content: [paragraph(label)] }],
  };
}

function doc(...content: NodeJson[]): DocumentJson {
  return { type: "doc", content };
}

function comment(...content: (NodeJson | string)[]): DocumentJson {
  return doc(paragraph(...content));
}

function daysFromToday(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

describe.skipIf(!baseUrl)("collaboration on pages", () => {
  let test: TestServices;
  const { organization, member, space, account } = spaceFixtures(() => test);

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
    const commenterId = await member(org.id, "member", "Commenter");
    const readerId = await member(org.id, "member", "Reader");
    const outsiderId = await member(org.id, "member", "Outsider");
    const created = await space(org.id, editorId, {
      grants: [
        { principalKind: "account", principalId: commenterId, role: "commenter" },
        { principalKind: "account", principalId: readerId, role: "reader" },
      ],
    });
    return {
      org,
      space: created,
      editorId,
      commenterId,
      readerId,
      outsiderId,
      editor: accountPrincipal(editorId),
      commenter: accountPrincipal(commenterId),
      reader: accountPrincipal(readerId),
      outsider: accountPrincipal(outsiderId),
    };
  }

  type Context = Awaited<ReturnType<typeof setup>>;

  async function page(context: Context, content: DocumentJson, options: { mode?: "publish" | "live" } = {}) {
    const created = await test.services.tree.create(context.editor, context.space.id, {
      kind: "page",
      title: `Page ${randomUUID().slice(0, 6)}`,
      mode: options.mode ?? "publish",
      placement: { parentId: null },
    });
    await test.services.documents.replace(context.editor, created.id, content);
    return created;
  }

  async function publishedPage(context: Context, content: DocumentJson) {
    const created = await page(context, content);
    await test.services.versions.publish(context.editor, created.id);
    return created;
  }

  async function notificationsOf(accountId: string) {
    return (await test.services.notifications.list(accountId, { limit: 50 })).items;
  }

  async function threadsOf(viewer: Principal, itemId: string) {
    return (await test.services.comments.list(viewer, itemId)).threads;
  }

  async function can(viewer: Principal, action: string, resource: { type: string; id: string }) {
    return (await test.services.authorization.explain(viewer, action, resource, { fresh: true })).allowed;
  }

  describe("comments", () => {
    it("allow replies one level deep and keep a placeholder for a deleted comment with replies", async () => {
      const context = await setup();
      const created = await publishedPage(context, doc(paragraph("Runbook")));
      const rootId = await test.services.comments.create(context.commenter, created.id, {
        body: comment("Is this current?"),
      });
      const replyId = await test.services.comments.reply(context.editor, rootId, { body: comment("Yes") });
      const nestedId = await test.services.comments.reply(context.commenter, replyId, {
        body: comment("Thanks"),
      });
      let threads = await threadsOf(context.reader, created.id);
      expect(threads).toHaveLength(1);
      expect(threads[0]?.replies.map((reply) => [reply.id, reply.parentId])).toEqual([
        [replyId, rootId],
        [nestedId, rootId],
      ]);

      await test.services.comments.update(context.commenter, rootId, {
        body: comment("Is this still current?"),
      });
      await test.services.comments.delete(context.commenter, rootId);
      threads = await threadsOf(context.reader, created.id);
      expect(threads[0]).toMatchObject({ id: rootId, deleted: true, body: null, author: null });
      expect(threads[0]?.replies).toHaveLength(2);

      await test.services.comments.restore(context.commenter, rootId);
      threads = await threadsOf(context.reader, created.id);
      expect(threads[0]).toMatchObject({ deleted: false, editedAt: expect.any(Date) });
    });

    it("let authors change their own comments and space admins delete any comment, recorded in the audit log", async () => {
      const context = await setup();
      const created = await publishedPage(context, doc(paragraph("Runbook")));
      const id = await test.services.comments.create(context.commenter, created.id, {
        body: comment("Mine"),
      });
      const resource = { type: "comment", id };
      expect(await can(context.commenter, "comment.update", resource)).toBe(true);
      expect(await can(context.editor, "comment.update", resource)).toBe(false);
      expect(await can(context.reader, "comment.update", resource)).toBe(false);
      expect(await can(context.reader, "comment.reply", resource)).toBe(false);
      expect(await can(context.reader, "item.comment", { type: "item", id: created.id })).toBe(false);
      expect(await can(context.commenter, "item.comment", { type: "item", id: created.id })).toBe(true);
      expect(await can(context.commenter, "comment.delete", resource)).toBe(true);
      expect(await can(context.editor, "comment.delete", resource)).toBe(true);
      expect(await can(context.reader, "comment.delete", resource)).toBe(false);

      await test.services.comments.delete(context.editor, id);
      const events = await test.database.execute<{ name: string }>(
        sql`select name from audit_events where target_id = ${created.id} and name = 'comment.deletedByModerator'`,
      );
      expect(events.rows).toHaveLength(1);
      const own = await test.services.comments.create(context.commenter, created.id, {
        body: comment("Again"),
      });
      await test.services.comments.delete(context.commenter, own);
      const all = await test.database.execute<{ count: string }>(
        sql`select count(*) as count from audit_events where name = 'comment.deletedByModerator'
          and target_id = ${created.id}`,
      );
      expect(Number(all.rows[0]?.count)).toBe(1);
    });

    it("refuse content outside the reduced schema", async () => {
      const context = await setup();
      const created = await publishedPage(context, doc(paragraph("Runbook")));
      await expect(
        test.services.comments.create(context.commenter, created.id, {
          body: doc({ type: "heading", attrs: { level: 1 }, content: [text("Big")] }),
        }),
      ).rejects.toMatchObject({ name: "CommentInvalidError" });
    });
  });

  describe("inline comments", () => {
    it("anchor in the draft at the text the commenter saw in the published version", async () => {
      const context = await setup();
      const created = await publishedPage(context, doc(paragraph("Hotel Wi-Fi blocks UDP 51820.")));
      await test.services.documents.replace(
        context.editor,
        created.id,
        doc(paragraph("Intro added in the draft."), paragraph("Hotel Wi-Fi blocks UDP 51820.")),
      );
      const id = await test.services.comments.create(context.commenter, created.id, {
        body: comment("Happened twice"),
        anchor: { exact: "blocks UDP", prefix: "Hotel Wi-Fi ", suffix: " 51820." },
      });
      const thread = (await threadsOf(context.reader, created.id))[0];
      expect(thread).toMatchObject({ id, quote: "blocks UDP", anchor: "inline" });
      const draft = await test.services.versions.draft(created.id);
      expect(JSON.stringify(draft.document)).toContain(id);
      const published = await test.services.documents.readable(created.id);
      expect(JSON.stringify(published?.document)).not.toContain(id);

      await test.services.versions.publish(context.editor, created.id);
      expect(JSON.stringify((await test.services.documents.readable(created.id))?.document)).toContain(id);
    });

    it("go into the current content directly in live mode", async () => {
      const context = await setup();
      const created = await page(context, doc(paragraph("Live text to discuss.")), { mode: "live" });
      const id = await test.services.comments.create(context.commenter, created.id, {
        body: comment("Discuss"),
        anchor: { exact: "discuss", prefix: "Live text to ", suffix: "." },
      });
      expect(JSON.stringify((await test.services.documents.readable(created.id))?.document)).toContain(id);
      expect((await threadsOf(context.reader, created.id))[0]).toMatchObject({ id, anchor: "inline" });
    });

    it("keep their anchor through edits by others and move to the page comments when the text is deleted", async () => {
      const context = await setup();
      const created = await page(context, doc(paragraph("Keep this part. Change that part.")), {
        mode: "live",
      });
      const id = await test.services.comments.create(context.editor, created.id, {
        body: comment("Note"),
        anchor: { exact: "this part", prefix: "Keep ", suffix: ". Change" },
      });
      const marked = (await test.services.documents.snapshot(created.id))?.document as DocumentJson;
      const first = marked.content?.[0]?.content ?? [];
      await test.services.documents.replace(
        context.editor,
        created.id,
        doc(paragraph(...first.slice(0, -1), text(". Changed the rest entirely.")), paragraph("More")),
      );
      expect((await threadsOf(context.reader, created.id))[0]).toMatchObject({ id, anchor: "inline" });

      await test.services.documents.replace(context.editor, created.id, doc(paragraph("All new text.")));
      expect((await threadsOf(context.reader, created.id))[0]).toMatchObject({
        id,
        anchor: "detached",
        quote: "this part",
      });
    });

    it("survive restore and discard, moving to the page comments when their text is gone", async () => {
      const context = await setup();
      const created = await publishedPage(context, doc(paragraph("Version one text.")));
      await test.services.documents.replace(
        context.editor,
        created.id,
        doc(paragraph("Version one text."), paragraph("Draft only sentence.")),
      );
      const draftComment = await test.services.comments.create(context.editor, created.id, {
        body: comment("About the draft"),
        anchor: { exact: "Draft only", prefix: "", suffix: " sentence." },
      });
      const publishedComment = await test.services.comments.create(context.commenter, created.id, {
        body: comment("About the published text"),
        anchor: { exact: "one text", prefix: "Version ", suffix: "." },
      });

      await test.services.versions.discard(context.editor, created.id);
      let threads = await threadsOf(context.editor, created.id);
      expect(threads.find((thread) => thread.id === draftComment)).toMatchObject({ anchor: "detached" });
      expect(threads.find((thread) => thread.id === publishedComment)).toMatchObject({ anchor: "detached" });

      const [discarded] = await test.services.versions.discardedDrafts(created.id);
      await test.services.versions.restoreDiscarded(context.editor, created.id, discarded?.id ?? "");
      threads = await threadsOf(context.editor, created.id);
      expect(threads.map((thread) => thread.anchor)).toEqual(["inline", "inline"]);

      await test.services.versions.publish(context.editor, created.id);
      await test.services.documents.replace(context.editor, created.id, doc(paragraph("Rewritten.")));
      await test.services.versions.publish(context.editor, created.id);
      threads = await threadsOf(context.editor, created.id);
      expect(threads.map((thread) => thread.anchor)).toEqual(["detached", "detached"]);

      await test.services.versions.restore(context.editor, created.id, 2);
      await test.services.versions.publish(context.editor, created.id);
      threads = await threadsOf(context.editor, created.id);
      expect(threads.map((thread) => thread.anchor)).toEqual(["inline", "inline"]);
      expect(threads).toHaveLength(2);
    });

    it("can be resolved and reopened", async () => {
      const context = await setup();
      const created = await page(context, doc(paragraph("Resolve me.")), { mode: "live" });
      const id = await test.services.comments.create(context.commenter, created.id, {
        body: comment("Fix"),
        anchor: { exact: "Resolve", prefix: "", suffix: " me." },
      });
      await test.services.comments.resolve(context.commenter, id, true);
      expect((await threadsOf(context.reader, created.id))[0]?.resolvedBy?.id).toBe(context.commenterId);
      await test.services.comments.resolve(context.editor, id, false);
      expect((await threadsOf(context.reader, created.id))[0]?.resolvedAt).toBeNull();
      const pageComment = await test.services.comments.create(context.commenter, created.id, {
        body: comment("x"),
      });
      await test.services.comments.resolve(context.commenter, pageComment, true);
      const resolvedPageThread = (await threadsOf(context.reader, created.id)).find(
        (thread) => thread.id === pageComment,
      );
      expect(resolvedPageThread?.resolvedBy?.id).toBe(context.commenterId);
      const reply = await test.services.comments.reply(context.commenter, pageComment, {
        body: comment("y"),
      });
      await expect(test.services.comments.resolve(context.commenter, reply, true)).rejects.toMatchObject({
        code: "notInlineComment",
      });
    });
  });

  describe("the read view", () => {
    it("marks open comments made on published text after publishing, but not resolved ones", async () => {
      const context = await setup();
      const created = await publishedPage(context, doc(paragraph("Public text.")));
      const open = await test.services.comments.create(context.commenter, created.id, {
        body: comment("Check"),
        anchor: { exact: "Public", prefix: "", suffix: " text." },
      });
      const done = await test.services.comments.create(context.commenter, created.id, {
        body: comment("Done"),
        anchor: { exact: "text", prefix: "Public ", suffix: "." },
      });
      await test.services.comments.resolve(context.commenter, done, true);
      const readable = await test.services.documents.readable(created.id);
      if (!readable) throw new Error("The page has no published version");
      expect(JSON.stringify(readable.document)).not.toContain(open);
      const marked = JSON.stringify(
        await test.services.comments.markOpenThreads(created.id, readable.document),
      );
      expect(marked).toContain(open);
      expect(marked).not.toContain(done);
    });

    it("does not mark comments on text that exists only in the draft", async () => {
      const context = await setup();
      const created = await publishedPage(context, doc(paragraph("Public text.")));
      await test.services.documents.replace(
        context.editor,
        created.id,
        doc(paragraph("Public text. Secret plan.")),
      );
      const draftOnly = await test.services.comments.create(context.editor, created.id, {
        body: comment("Draft"),
        anchor: { exact: "Secret plan", prefix: "Public text. ", suffix: "." },
      });
      const readable = await test.services.documents.readable(created.id);
      if (!readable) throw new Error("The page has no published version");
      const marked = JSON.stringify(
        await test.services.comments.markOpenThreads(created.id, readable.document),
      );
      expect(marked).not.toContain(draftOnly);
      expect(marked).not.toContain("Secret plan");
    });

    it("counts the comments of a blog post that are not deleted", async () => {
      const context = await setup();
      const post = await test.services.blog.create(context.editor, context.space.id, {
        title: "Office move",
      });
      const first = await test.services.comments.create(context.editor, post.id, { body: comment("When?") });
      await test.services.comments.reply(context.editor, first, { body: comment("Monday") });
      expect((await test.services.blog.get(context.editor, post.id))?.commentCount).toBe(2);
      await test.services.comments.delete(context.editor, first);
      expect((await test.services.blog.get(context.editor, post.id))?.commentCount).toBe(1);
    });

    it("names who published the version readers see in the list of children", async () => {
      const context = await setup();
      const created = await publishedPage(context, doc(paragraph("Public text.")));
      const children = await test.services.tree.children(context.reader, context.space.id, null);
      const child = children.items.find((item) => item.id === created.id);
      expect(child?.updatedBy?.id).toBe(context.editorId);
      expect(child?.updatedBy?.name).toBe("Editor");
    });

    it("leaves comments on draft-only text out of the blog count for readers", async () => {
      const context = await setup();
      const post = await test.services.blog.create(context.editor, context.space.id, {
        title: "Office move",
      });
      await test.services.documents.replace(context.editor, post.id, doc(paragraph("Public text.")));
      await test.services.versions.publish(context.editor, post.id);
      await test.services.documents.replace(
        context.editor,
        post.id,
        doc(paragraph("Public text. Secret plan.")),
      );
      await test.services.comments.create(context.editor, post.id, {
        body: comment("Draft"),
        anchor: { exact: "Secret plan", prefix: "Public text. ", suffix: "." },
      });
      await test.services.comments.create(context.editor, post.id, { body: comment("Nice") });
      expect((await test.services.blog.get(context.editor, post.id))?.commentCount).toBe(2);
      expect((await test.services.blog.get(context.reader, post.id))?.commentCount).toBe(1);
    });

    it("lists the people editing a page until they leave", async () => {
      const context = await setup();
      const created = await publishedPage(context, doc(paragraph("Public text.")));
      await test.services.versions.touchEditor(created.id, "node-a", context.editorId, 1);
      await test.services.versions.touchEditor(created.id, "node-b", context.editorId, 1);
      expect(
        (await test.services.versions.editors(context.reader, created.id)).map((person) => person.id),
      ).toEqual([context.editorId]);
      await test.services.versions.touchEditor(created.id, "node-a", context.editorId, -1);
      expect(await test.services.versions.editors(context.reader, created.id)).toHaveLength(1);
      await test.services.versions.endSession(created.id, "node-b");
      expect(await test.services.versions.editors(context.reader, created.id)).toEqual([]);
    });
  });

  describe("readers never see draft content", () => {
    it("through inline comments and their quotes on text that exists only in the draft", async () => {
      const context = await setup();
      const created = await publishedPage(context, doc(paragraph("Public text.")));
      await test.services.documents.replace(
        context.editor,
        created.id,
        doc(paragraph("Public text."), paragraph("Secret merger plan.")),
      );
      const id = await test.services.comments.create(context.editor, created.id, {
        body: comment("Sensitive"),
        anchor: { exact: "Secret merger", prefix: "", suffix: " plan." },
      });
      expect(await threadsOf(context.reader, created.id)).toEqual([]);
      expect(await threadsOf(context.commenter, created.id)).toEqual([]);
      expect(await can(context.reader, "comment.view", { type: "comment", id })).toBe(false);
      expect((await threadsOf(context.editor, created.id)).map((thread) => thread.quote)).toEqual([
        "Secret merger",
      ]);

      await test.services.versions.publish(context.editor, created.id);
      expect((await threadsOf(context.reader, created.id)).map((thread) => thread.quote)).toEqual([
        "Secret merger",
      ]);
    });

    it("through the anchor state of inline comments whose text was changed only in the draft", async () => {
      const context = await setup();
      const created = await publishedPage(context, doc(paragraph("Keep the old VPN gateway.")));
      const id = await test.services.comments.create(context.commenter, created.id, {
        body: comment("Still needed?"),
        anchor: { exact: "old VPN gateway", prefix: "Keep the ", suffix: "." },
      });
      await test.services.documents.replace(
        context.editor,
        created.id,
        doc(paragraph("Rewritten in the draft.")),
      );
      expect((await threadsOf(context.editor, created.id))[0]).toMatchObject({ id, anchor: "detached" });
      expect((await threadsOf(context.reader, created.id))[0]).toMatchObject({ id, anchor: "inline" });
      expect((await threadsOf(context.commenter, created.id))[0]).toMatchObject({ id, anchor: "inline" });

      await test.services.versions.publish(context.editor, created.id);
      expect((await threadsOf(context.reader, created.id))[0]).toMatchObject({ id, anchor: "detached" });
    });

    it("through comments on a page that was never published", async () => {
      const context = await setup();
      const created = await page(context, doc(paragraph("Draft page.")));
      await test.services.comments.create(context.editor, created.id, { body: comment("Draft talk") });
      expect(await can(context.reader, "item.view", { type: "item", id: created.id })).toBe(false);
      await expect(
        test.services.comments.create(context.commenter, created.id, {
          body: comment("Guess"),
          anchor: { exact: "Draft", prefix: "", suffix: " page." },
        }),
      ).rejects.toMatchObject({ code: "anchorNotFound" });
    });

    it("through mentions in a draft, which notify nobody until published", async () => {
      const context = await setup();
      const created = await publishedPage(context, doc(paragraph("Hello")));
      await test.services.documents.replace(
        context.editor,
        created.id,
        doc(paragraph("Ask ", mention(context.readerId), " about it")),
      );
      expect(await notificationsOf(context.readerId)).toEqual([]);
      expect(await notificationsOf(context.readerId)).toEqual([]);

      await test.services.versions.publish(context.editor, created.id);
      const notifications = await notificationsOf(context.readerId);
      expect(notifications.map((entry) => entry.type)).toEqual(["content.mentioned"]);
    });

    it("through tasks in a draft, in My tasks and the task report", async () => {
      const context = await setup();
      const taskId = randomUUID();
      const created = await publishedPage(context, doc(paragraph("Plan")));
      await test.services.documents.replace(
        context.editor,
        created.id,
        doc(task(taskId, "Secret task", { assignee: context.readerId, dueDate: daysFromToday(2) })),
      );
      expect((await test.services.tasks.list(context.reader, { assignee: "me" })).items).toEqual([]);
      expect((await test.services.tasks.list(context.reader, { spaceId: context.space.id })).items).toEqual(
        [],
      );
      expect(await test.services.tasks.statuses(context.reader, created.id)).toEqual([]);
      expect(await notificationsOf(context.readerId)).toEqual([]);

      await test.services.versions.publish(context.editor, created.id);
      const mine = await test.services.tasks.list(context.reader, { assignee: "me" });
      expect(mine.items.map((entry) => [entry.id, entry.text])).toEqual([[taskId, "Secret task"]]);
      expect((await notificationsOf(context.readerId)).map((entry) => entry.type)).toEqual(["task.assigned"]);
    });

    it("through home pages: recently viewed, starred, mentions and the organization home page", async () => {
      const context = await setup();
      const created = await page(context, doc(paragraph("Unpublished")));
      await test.services.home.recordView(context.reader, created.id);
      await test.services.home.star(context.reader, { itemId: created.id }, true);
      await test.services.home.setOrganizationHomePage(context.editor, context.org.id, created.id);
      const home = await test.services.home.forYou(context.reader);
      expect(home.recent).toEqual([]);
      expect(home.starred.items).toEqual([]);
      expect(await test.services.home.organizationHomePage(context.reader, context.org.id)).toBeNull();
      expect((await test.services.home.organizationHomePage(context.editor, context.org.id))?.id).toBe(
        created.id,
      );
    });

    it("through notifications whose page became unpublished later", async () => {
      const context = await setup();
      const parent = await page(context, doc(paragraph("Parent")), { mode: "live" });
      const child = await test.services.tree.create(context.editor, context.space.id, {
        kind: "page",
        title: "Child",
        mode: "live",
        placement: { parentId: parent.id },
      });
      await test.services.documents.replace(
        context.editor,
        child.id,
        doc(paragraph("Hi ", mention(context.readerId))),
      );
      expect(await notificationsOf(context.readerId)).toHaveLength(1);
      await test.services.versions.changeMode(context.editor, parent.id, "publish");
      await test.database.execute(
        sql`update tree_items set published_version_id = null where id = ${parent.id}`,
      );
      await test.database.execute(
        sql`update tree_items set reader_visible = false where id in (${parent.id}, ${child.id})`,
      );
      expect(await notificationsOf(context.readerId)).toEqual([]);
    });
  });

  describe("mentions", () => {
    it("notify exactly once per mention, also over later publications", async () => {
      const context = await setup();
      const created = await page(context, doc(paragraph("Hi ", mention(context.readerId))));
      await test.services.versions.publish(context.editor, created.id);
      await test.services.documents.replace(
        context.editor,
        created.id,
        doc(paragraph("Hi ", mention(context.readerId), " again")),
      );
      await test.services.versions.publish(context.editor, created.id);
      expect(await notificationsOf(context.readerId)).toHaveLength(1);
    });

    it("in a comment notify at once and never people without read access", async () => {
      const context = await setup();
      const created = await publishedPage(context, doc(paragraph("Text")));
      const id = await test.services.comments.create(context.commenter, created.id, {
        body: comment("Look ", mention(context.readerId), " and ", mention(context.outsiderId)),
      });
      expect((await notificationsOf(context.readerId)).map((entry) => entry.params)).toEqual([
        expect.objectContaining({ commentId: id }),
      ]);
      expect(await notificationsOf(context.outsiderId)).toEqual([]);
      await test.services.comments.update(context.commenter, id, {
        body: comment("Look ", mention(context.readerId), "!"),
      });
      expect(await notificationsOf(context.readerId)).toHaveLength(1);
    });

    it("in live mode notify once the change is stored, and a draft that is never published notifies nobody", async () => {
      const context = await setup();
      const live = await page(context, doc(paragraph("Hi ", mention(context.readerId))), { mode: "live" });
      expect((await notificationsOf(context.readerId)).map((entry) => entry.target.id)).toEqual([live.id]);
      await page(context, doc(paragraph("Hi ", mention(context.commenterId))));
      expect(await notificationsOf(context.commenterId)).toEqual([]);
    });

    it("never reach people without read access, also not after they gain it", async () => {
      const context = await setup();
      const created = await publishedPage(
        context,
        doc(
          paragraph("Hi ", mention(context.outsiderId)),
          task(randomUUID(), "Review", { assignee: context.outsiderId }),
        ),
      );
      expect(await notificationsOf(context.outsiderId)).toEqual([]);
      await test.services.spacePermissions.apply(context.editor, context.space.id, {
        action: "grant",
        principalKind: "account",
        principalId: context.outsiderId,
        role: "reader",
      });
      await test.services.documents.replace(
        context.editor,
        created.id,
        doc(
          paragraph("Hi ", mention(context.outsiderId), " again"),
          task(randomUUID(), "Second review", { assignee: context.readerId }),
        ),
      );
      await test.services.versions.publish(context.editor, created.id);
      expect(await notificationsOf(context.outsiderId)).toEqual([]);
      expect((await notificationsOf(context.readerId)).map((entry) => entry.type)).toEqual(["task.assigned"]);
    });

    it("in published pages notify when the last unpublished ancestor is published, however late", async () => {
      const context = await setup();
      const parent = await page(context, doc(paragraph("Parent")));
      const child = await test.services.tree.create(context.editor, context.space.id, {
        kind: "page",
        title: "Child",
        mode: "publish",
        placement: { parentId: parent.id },
      });
      const grandchild = await test.services.tree.create(context.editor, context.space.id, {
        kind: "page",
        title: "Grandchild",
        mode: "live",
        placement: { parentId: child.id },
      });
      await test.services.documents.replace(
        context.editor,
        child.id,
        doc(
          paragraph("Hi ", mention(context.readerId)),
          task(randomUUID(), "Check", { assignee: context.commenterId }),
        ),
      );
      await test.services.versions.publish(context.editor, child.id);
      await test.services.documents.replace(
        context.editor,
        grandchild.id,
        doc(paragraph("Also ", mention(context.commenterId))),
      );
      expect(await notificationsOf(context.readerId)).toEqual([]);
      expect(await notificationsOf(context.commenterId)).toEqual([]);
      await test.database.execute(sql`
        update content_mentions set created_at = now() - interval '400 days'
        where item_id in (${child.id}, ${grandchild.id})`);
      await test.database.execute(
        sql`update tasks set updated_at = now() - interval '400 days' where item_id = ${child.id}`,
      );

      await test.services.versions.publish(context.editor, parent.id);
      expect((await notificationsOf(context.readerId)).map((entry) => entry.target.id)).toEqual([child.id]);
      expect(
        (await notificationsOf(context.commenterId)).map((entry) => [entry.type, entry.target.id]).sort(),
      ).toEqual(
        [
          ["content.mentioned", grandchild.id],
          ["task.assigned", child.id],
        ].sort(),
      );
      await test.services.versions.publish(context.editor, parent.id);
      await test.services.versions.publish(context.editor, child.id);
      expect(await notificationsOf(context.readerId)).toHaveLength(1);
      expect(await notificationsOf(context.commenterId)).toHaveLength(2);
    });
  });

  describe("tasks", () => {
    it("keep their status apart from the content, the same in draft and published version", async () => {
      const context = await setup();
      const taskId = randomUUID();
      const created = await publishedPage(
        context,
        doc(task(taskId, "Rotate keys", { assignee: context.readerId })),
      );
      await test.services.documents.replace(
        context.editor,
        created.id,
        doc(paragraph("Draft change"), task(taskId, "Rotate keys", { assignee: context.readerId })),
      );
      expect(await can(context.reader, "task.update", { type: "task", id: taskId })).toBe(true);
      expect(await can(context.commenter, "task.update", { type: "task", id: taskId })).toBe(false);
      await test.services.tasks.setStatus(context.reader, taskId, true);
      expect(await test.services.tasks.statuses(context.reader, created.id)).toEqual([
        expect.objectContaining({ id: taskId, done: true }),
      ]);
      expect(await test.services.tasks.statuses(context.editor, created.id)).toEqual([
        expect.objectContaining({ id: taskId, done: true }),
      ]);
      const markdown = await test.services.versions.draft(created.id);
      expect(JSON.stringify(markdown.document)).not.toContain("checked");
      expect(
        (await test.services.tasks.history(taskId)).map((change) => [change.done, change.changedBy?.id]),
      ).toEqual([[true, context.readerId]]);
    });

    it("can be created with a status before the content that holds them is stored", async () => {
      const context = await setup();
      const created = await page(context, doc(paragraph("Checklist")));
      const pasted = randomUUID();
      const status = await test.services.tasks.setStatusOnPage(context.editor, created.id, pasted, true);
      expect(status).toMatchObject({ id: pasted, done: true, changedBy: { id: context.editorId } });
      await test.services.documents.replace(
        context.editor,
        created.id,
        doc(paragraph("Checklist"), task(pasted, "Order badges", { assignee: context.readerId })),
      );
      await test.services.versions.publish(context.editor, created.id);
      expect(await test.services.tasks.statuses(context.reader, created.id)).toEqual([
        expect.objectContaining({ id: pasted, done: true }),
      ]);
      expect(
        (await test.services.tasks.list(context.reader, { assignee: "me", status: "done" })).items.map(
          (entry) => entry.id,
        ),
      ).toEqual([pasted]);
      await test.services.tasks.setStatusOnPage(context.editor, created.id, pasted, false);
      expect((await test.services.tasks.history(pasted)).map((change) => change.done)).toEqual([false, true]);

      const other = await page(context, doc(paragraph("Other")));
      await expect(
        test.services.tasks.setStatusOnPage(context.editor, other.id, pasted, true),
      ).rejects.toMatchObject({ code: "taskNotFound" });
      expect(await test.services.tasks.statuses(context.editor, created.id)).toEqual([
        expect.objectContaining({ id: pasted, done: false }),
      ]);
    });

    it("never lose concurrent changes from the editor and the read view", async () => {
      const context = await setup();
      const first = randomUUID();
      const second = randomUUID();
      const created = await page(
        context,
        doc(task(first, "First", { assignee: context.readerId }), task(second, "Second")),
        { mode: "live" },
      );
      await Promise.all([
        test.services.tasks.setStatus(context.reader, first, true),
        test.services.tasks.setStatus(context.editor, second, true),
        test.services.documents.replace(
          context.editor,
          created.id,
          doc(
            paragraph("Edited"),
            task(first, "First", { assignee: context.readerId }),
            task(second, "Second"),
          ),
        ),
      ]);
      expect(
        (await test.services.tasks.statuses(context.reader, created.id)).map((status) => status.done),
      ).toEqual([true, true]);
      await Promise.all([
        test.services.tasks.setStatus(context.reader, first, false),
        test.services.tasks.setStatus(context.editor, first, false),
      ]);
      expect((await test.services.tasks.history(first)).map((change) => change.done)).toEqual([false, true]);
    });

    it("show the names of assignees and of who reacted only to people who may see them", async () => {
      const context = await setup();
      const stranger = await account({ name: "Stranger" });
      const taskId = randomUUID();
      const created = await publishedPage(
        context,
        doc(task(taskId, "Hidden person", { assignee: stranger })),
      );
      const report = await test.services.tasks.list(context.reader, { spaceId: context.space.id });
      expect(report.items.map((entry) => entry.assignee)).toEqual([null]);
      const references = await test.services.documents.references(
        context.reader,
        doc(
          task(taskId, "Hidden person", { assignee: stranger }),
          task(randomUUID(), "Known", { assignee: context.editorId }),
        ),
      );
      expect(Object.keys(references.people)).toEqual([context.editorId]);
      await test.database.execute(
        sql`insert into reactions (item_id, account_id, emoji) values (${created.id}, ${stranger}, '👍')`,
      );
      const summary = await test.services.reactions.forItem(context.reader, created.id);
      expect(summary.reactions[0]?.people).toEqual([{ id: stranger, name: null }]);
    });

    it("get a new ID when the same ID already belongs to another page", async () => {
      const context = await setup();
      const shared = randomUUID();
      await page(context, doc(task(shared, "Original")), { mode: "live" });
      const copy = await page(context, doc(task(shared, "Copy")), { mode: "live" });
      const stored = (await test.services.documents.snapshot(copy.id))?.document;
      expect(JSON.stringify(stored)).not.toContain(shared);
      expect(await test.services.tasks.statuses(context.editor, copy.id)).toHaveLength(1);
    });

    it("list my tasks across spaces with filters and live counts, overdue first", async () => {
      const context = await setup();
      const overdue = randomUUID();
      const soon = randomUUID();
      const later = randomUUID();
      const other = randomUUID();
      await page(
        context,
        doc(
          task(later, "Later", { assignee: context.readerId, dueDate: daysFromToday(40) }),
          task(soon, "Soon", { assignee: context.readerId, dueDate: daysFromToday(3) }),
          task(overdue, "Overdue", { assignee: context.readerId, dueDate: daysFromToday(-2) }),
          task(other, "Someone else's", { assignee: context.editorId }),
        ),
        { mode: "live" },
      );
      const mine = await test.services.tasks.list(context.reader, { assignee: "me" });
      expect(mine.items.map((entry) => [entry.text, entry.overdue])).toEqual([
        ["Overdue", true],
        ["Soon", false],
        ["Later", false],
      ]);
      expect(mine.counts).toEqual({ open: 3, done: 0, overdue: 1 });
      await test.services.tasks.setStatus(context.reader, soon, true);
      expect(
        (await test.services.tasks.list(context.reader, { assignee: "me", status: "done" })).items,
      ).toHaveLength(1);
      expect(
        (await test.services.tasks.list(context.reader, { assignee: "me", due: "overdue" })).items.map(
          (entry) => entry.id,
        ),
      ).toEqual([overdue]);
      const report = await test.services.tasks.list(context.editor, {
        spaceId: context.space.id,
        status: "all",
      });
      expect(report.counts).toEqual({ open: 3, done: 1, overdue: 1 });
    });

    it("list tasks by who assigned them, sorted by any column and paged in that order", async () => {
      const context = await setup();
      await page(
        context,
        doc(
          task(randomUUID(), "beta", { assignee: context.readerId, dueDate: daysFromToday(5) }),
          task(randomUUID(), "Alpha", { assignee: context.readerId, dueDate: daysFromToday(9) }),
          task(randomUUID(), "gamma", { assignee: context.readerId }),
        ),
        { mode: "live" },
      );
      const mine = await test.services.tasks.list(context.reader, { assignee: "me" });
      expect(mine.items.map((entry) => entry.assignedBy)).toEqual([
        { id: context.editorId, name: "Editor" },
        { id: context.editorId, name: "Editor" },
        { id: context.editorId, name: "Editor" },
      ]);
      expect(
        (await test.services.tasks.list(context.editor, { assignedBy: "me" })).items.map(
          (entry) => entry.text,
        ),
      ).toEqual(["beta", "Alpha", "gamma"]);
      expect((await test.services.tasks.list(context.reader, { assignedBy: "me" })).items).toEqual([]);
      const first = await test.services.tasks.list(context.reader, {
        assignee: "me",
        sort: "text",
        direction: "desc",
        limit: 2,
      });
      expect(first.items.map((entry) => entry.text)).toEqual(["gamma", "beta"]);
      const rest = await test.services.tasks.list(context.reader, {
        assignee: "me",
        sort: "text",
        direction: "desc",
        after: first.next ?? undefined,
      });
      expect(rest.items.map((entry) => entry.text)).toEqual(["Alpha"]);
      expect(
        (await test.services.tasks.list(context.reader, { assignee: "me", sort: "text" })).items.map(
          (entry) => entry.text,
        ),
      ).toEqual(["Alpha", "beta", "gamma"]);
    });
  });

  describe("reactions", () => {
    it("on pages and comments, with who reacted, and turned off per space", async () => {
      const context = await setup();
      const created = await publishedPage(context, doc(paragraph("Nice")));
      await test.services.reactions.add(context.reader, { itemId: created.id }, "👍");
      await test.services.reactions.add(context.editor, { itemId: created.id }, "👍");
      await test.services.reactions.add(context.reader, { itemId: created.id }, "👍");
      const summary = await test.services.reactions.forItem(context.reader, created.id);
      expect(summary.reactions).toEqual([
        {
          emoji: "👍",
          count: 2,
          reacted: true,
          people: [
            { id: context.readerId, name: "Reader" },
            { id: context.editorId, name: "Editor" },
          ],
        },
      ]);
      const commentId = await test.services.comments.create(context.commenter, created.id, {
        body: comment("Hi"),
      });
      await test.services.reactions.add(context.reader, { commentId }, "🎉");
      expect((await threadsOf(context.reader, created.id))[0]?.reactions.map((entry) => entry.emoji)).toEqual(
        ["🎉"],
      );
      await expect(
        test.services.reactions.add(context.reader, { itemId: created.id }, "x"),
      ).rejects.toMatchObject({
        code: "invalidEmoji",
      });

      await test.settings.set(
        reactionsEnabledSetting,
        { organization: context.org.id, space: context.space.id },
        "space",
        false,
      );
      expect(await test.services.reactions.forItem(context.reader, created.id)).toEqual({
        enabled: false,
        reactions: [],
      });
      await expect(
        test.services.reactions.add(context.reader, { itemId: created.id }, "👀"),
      ).rejects.toMatchObject({
        code: "reactionsDisabled",
      });
      await test.services.reactions.remove(context.reader, { itemId: created.id }, "👍");
    });
  });

  describe("blog posts", () => {
    it("publish exactly once when scheduled, with two nodes, and after a restart", async () => {
      const context = await setup();
      const post = await test.services.blog.create(context.editor, context.space.id, {
        title: "New VPN client",
        excerpt: "From Monday",
      });
      await test.services.documents.replace(context.editor, post.id, doc(paragraph("Details")));
      await test.services.blog.schedule(context.editor, post.id, {
        at: new Date(Date.now() + 3_600_000),
        timeZone: "Europe/Vienna",
      });
      expect(await test.services.blog.publishDue()).toBe(0);
      const restarted = test.anotherNode();
      await test.database.execute(
        sql`update blog_posts set scheduled_at = now() - interval '1 second' where item_id = ${post.id}`,
      );
      const results = await Promise.all([
        restarted.blog.publishDue(),
        test.anotherNode().blog.publishDue(),
        test.services.blog.publishDue(),
      ]);
      expect(results.reduce((sum, count) => sum + count, 0)).toBe(1);
      expect(await test.services.versions.list(post.id)).toHaveLength(1);
      const published = await test.services.blog.get(context.reader, post.id);
      expect(published).toMatchObject({ published: true, scheduledAt: null, excerpt: "From Monday" });
      const events = await test.database.execute<{ name: string }>(
        sql`select name from audit_events where target_id = ${post.id} and name = 'blogPost.publishedBySchedule'`,
      );
      expect(events.rows).toHaveLength(1);
    });

    async function duePost(
      context: Context,
      lose: (authorId: string, permissionId: string) => Promise<void>,
    ) {
      const authorId = await member(context.org.id, "member", "Author");
      const [entry] = await test.services.spacePermissions
        .apply(context.editor, context.space.id, {
          action: "grant",
          principalKind: "account",
          principalId: authorId,
          role: "editor",
        })
        .then((entries) => entries.filter((candidate) => candidate.principalId === authorId));
      const author = accountPrincipal(authorId);
      const post = await test.services.blog.create(author, context.space.id, { title: "Office move" });
      expect(post.commentCount).toBe(0);
      await test.services.documents.replace(author, post.id, doc(paragraph("We move on Friday.")));
      await test.services.blog.schedule(author, post.id, {
        at: new Date(Date.now() + 3_600_000),
        timeZone: "Europe/Vienna",
      });
      await lose(authorId, entry?.id ?? "");
      await test.database.execute(
        sql`update blog_posts set scheduled_at = now() - interval '1 second' where item_id = ${post.id}`,
      );
      return { post, authorId };
    }

    async function auditNames(itemId: string) {
      const events = await test.database.execute<{ name: string }>(
        sql`select name from audit_events where target_id = ${itemId} and name like 'blogPost.%' order by occurred_at`,
      );
      return events.rows.map((row) => row.name);
    }

    it("are held for approval when the author can no longer edit them, and a space admin publishes them", async () => {
      const context = await setup();
      const { post, authorId } = await duePost(context, async (_authorId, permissionId) => {
        await test.services.spacePermissions.apply(context.editor, context.space.id, {
          action: "change",
          permissionId,
          role: "reader",
        });
      });
      expect(await test.services.blog.publishDue()).toBe(0);
      expect(await test.services.blog.publishDue()).toBe(0);
      const held = await test.services.blog.get(context.editor, post.id);
      expect(held).toMatchObject({ published: false, held: true, scheduledBy: { id: authorId } });
      expect(held?.scheduledAt).not.toBeNull();
      expect(await test.services.blog.get(context.reader, post.id)).toBeNull();
      expect((await notificationsOf(authorId)).map((entry) => [entry.type, entry.actor?.id])).toEqual([
        ["blogPost.scheduleHeld", authorId],
      ]);
      expect((await notificationsOf(context.editorId)).map((entry) => entry.type)).toEqual([
        "blogPost.scheduleHeld",
      ]);
      expect(await notificationsOf(context.readerId)).toEqual([]);
      expect(
        (await test.services.blog.listScheduled(context.editor, context.space.id)).map((entry) => [
          entry.id,
          entry.held,
        ]),
      ).toEqual([[post.id, true]]);
      expect(await test.services.blog.listScheduled(context.reader, context.space.id)).toEqual([]);
      expect(await test.services.blog.listScheduled(accountPrincipal(authorId), context.space.id)).toEqual(
        [],
      );
      expect(
        await can(accountPrincipal(authorId), "item.approveSchedule", { type: "item", id: post.id }),
      ).toBe(false);
      expect(await can(context.editor, "item.approveSchedule", { type: "item", id: post.id })).toBe(true);

      const published = await test.services.blog.publishHeld(context.editor, post.id);
      expect(published).toMatchObject({ published: true, held: false, scheduledAt: null });
      expect(await test.services.blog.get(context.reader, post.id)).toMatchObject({ published: true });
      await expect(test.services.blog.publishHeld(context.editor, post.id)).rejects.toMatchObject({
        code: "notHeld",
      });
      expect(await auditNames(post.id)).toEqual(["blogPost.scheduleHeld", "blogPost.heldPublished"]);
    });

    it("are held when the author was deactivated, and a space admin cancels the schedule", async () => {
      const context = await setup();
      const { post, authorId } = await duePost(context, async (authorId) => {
        await test.database.execute(sql`update accounts set state = 'deactivated' where id = ${authorId}`);
      });
      expect(await test.services.blog.publishDue()).toBe(0);
      expect(await test.services.blog.get(context.editor, post.id)).toMatchObject({ held: true });
      expect(await notificationsOf(authorId)).toEqual([]);
      expect((await notificationsOf(context.editorId)).map((entry) => entry.type)).toEqual([
        "blogPost.scheduleHeld",
      ]);
      const cancelled = await test.services.blog.cancelHeld(context.editor, post.id);
      expect(cancelled).toMatchObject({
        published: false,
        held: false,
        scheduledAt: null,
        scheduledBy: null,
      });
      expect(await test.services.blog.listScheduled(context.editor, context.space.id)).toEqual([]);
      expect(await auditNames(post.id)).toEqual(["blogPost.scheduleHeld", "blogPost.heldCancelled"]);
    });

    it("tell an author who lost all access to the space nothing about the post", async () => {
      const context = await setup();
      const { post, authorId } = await duePost(context, async (_authorId, permissionId) => {
        await test.services.spacePermissions.apply(context.editor, context.space.id, {
          action: "remove",
          permissionId,
        });
      });
      expect(await test.services.blog.publishDue()).toBe(0);
      expect(await test.services.blog.get(context.editor, post.id)).toMatchObject({ held: true });
      expect(await notificationsOf(authorId)).toEqual([]);
      expect((await notificationsOf(context.editorId)).map((entry) => entry.type)).toEqual([
        "blogPost.scheduleHeld",
      ]);
    });

    it("are published as planned when the author can still edit them", async () => {
      const context = await setup();
      const { post, authorId } = await duePost(context, async () => {});
      expect(await test.services.blog.publishDue()).toBe(1);
      expect(await test.services.blog.get(context.reader, post.id)).toMatchObject({
        published: true,
        held: false,
      });
      expect(await notificationsOf(authorId)).toEqual([]);
      expect(await auditNames(post.id)).toEqual(["blogPost.publishedBySchedule"]);
    });

    it("can be rescheduled and cancelled, and refuse a time in the past", async () => {
      const context = await setup();
      const post = await test.services.blog.create(context.editor, context.space.id, {
        title: "Maintenance",
      });
      await expect(
        test.services.blog.schedule(context.editor, post.id, {
          at: new Date(Date.now() - 1000),
          timeZone: "UTC",
        }),
      ).rejects.toMatchObject({ code: "scheduleInPast" });
      await test.services.blog.schedule(context.editor, post.id, {
        at: new Date(Date.now() + 60_000),
        timeZone: "UTC",
      });
      const cancelled = await test.services.blog.schedule(context.editor, post.id, null);
      expect(cancelled.scheduledAt).toBeNull();
      await test.database.execute(sql`update blog_posts set scheduled_at = null where item_id = ${post.id}`);
      expect(await test.services.blog.publishDue()).toBe(0);
      expect(await test.services.blog.get(context.reader, post.id)).toBeNull();
    });

    it("stay out of the page tree and are pinned in the space and the organization overview", async () => {
      const context = await setup();
      const first = await test.services.blog.create(context.editor, context.space.id, { title: "First" });
      const second = await test.services.blog.create(context.editor, context.space.id, { title: "Second" });
      await test.services.versions.publish(context.editor, first.id);
      await test.services.versions.publish(context.editor, second.id);
      const tree = await test.services.tree.children(context.editor, context.space.id, null);
      expect(tree.items.map((item) => item.id)).not.toContain(first.id);

      await test.services.blog.pin(context.editor, first.id, "organization", true);
      let overview = await test.services.blog.listOrganization(context.reader, context.org.id);
      expect(overview.posts.map((post) => post.title)).toEqual(["First", "Second"]);
      expect(overview.posts[0]?.pinnedInOrganization).toBe(true);
      await test.services.blog.pin(context.editor, first.id, "organization", false);
      overview = await test.services.blog.listOrganization(context.reader, context.org.id);
      expect(overview.posts.map((post) => post.title)).toEqual(["Second", "First"]);
      await test.services.documents.addLabel(context.editor, second.id, "Security");
      overview = await test.services.blog.listOrganization(context.reader, context.org.id, {
        label: "security",
      });
      expect(overview.posts.map((post) => post.title)).toEqual(["Second"]);
      const pins = await test.database.execute<{ name: string }>(
        sql`select name from audit_events where target_id = ${first.id} order by sequence`,
      );
      expect(pins.rows.map((row) => row.name)).toEqual(
        expect.arrayContaining(["blogPost.pinned", "blogPost.unpinned"]),
      );
      expect(
        await can(context.editor, "organization.blog.pin", { type: "organization", id: context.org.id }),
      ).toBe(false);
      expect(await can(context.editor, "space.manage", { type: "space", id: context.space.id })).toBe(true);
    });

    it("show drafts only to editors", async () => {
      const context = await setup();
      const post = await test.services.blog.create(context.editor, context.space.id, { title: "Draft post" });
      expect((await test.services.blog.listSpace(context.reader, context.space.id)).posts).toEqual([]);
      expect(
        (await test.services.blog.listSpace(context.editor, context.space.id)).posts.map((entry) => entry.id),
      ).toEqual([post.id]);
      await expect(test.services.versions.changeMode(context.editor, post.id, "live")).rejects.toMatchObject({
        code: "blogPostMode",
      });
    });
  });

  describe("home pages", () => {
    it("show recent pages, starred items and spaces, tasks, mentions and new posts", async () => {
      const context = await setup();
      const taskId = randomUUID();
      const created = await publishedPage(
        context,
        doc(
          paragraph("Hi ", mention(context.readerId)),
          task(taskId, "Due soon", { assignee: context.readerId, dueDate: daysFromToday(1) }),
        ),
      );
      const post = await test.services.blog.create(context.editor, context.space.id, { title: "News" });
      await test.services.versions.publish(context.editor, post.id);
      await test.services.home.recordView(context.reader, created.id);
      await test.services.home.star(context.reader, { itemId: created.id }, true);
      await test.services.home.star(context.reader, { spaceId: context.space.id }, true);
      const home = await test.services.home.forYou(context.reader);
      const postNumber = (await test.services.tree.get(context.editor, post.id))?.number;
      expect(home.recent.map((entry) => [entry.id, entry.number])).toEqual([[created.id, created.number]]);
      expect(home.starred.items.map((entry) => [entry.id, entry.number])).toEqual([
        [created.id, created.number],
      ]);
      expect(home.starred.spaces.map((entry) => entry.id)).toEqual([context.space.id]);
      expect(home.tasks.map((entry) => entry.id)).toEqual([taskId]);
      expect(home.mentions.map((entry) => [entry.item.id, entry.item.number])).toEqual([
        [created.id, created.number],
      ]);
      expect(home.posts.map((entry) => [entry.id, entry.number])).toEqual([[post.id, postNumber]]);
      expect((await test.services.home.forYou(context.editor)).recent).toEqual([]);

      await test.database.execute(
        sql`update recent_views set viewed_at = now() - interval '91 days' where item_id = ${created.id}`,
      );
      expect(await test.services.home.removeOldViews()).toBe(1);
      expect((await test.services.home.forYou(context.reader)).recent).toEqual([]);
    });

    it("let organization admins choose an existing page as the organization home page", async () => {
      const context = await setup();
      const created = await publishedPage(context, doc(paragraph("Welcome")));
      const owner = accountPrincipal(context.org.owner);
      await expect(
        test.services.home.setOrganizationHomePage(owner, context.org.id, randomUUID()),
      ).rejects.toMatchObject({ code: "invalidHomePage" });
      await test.services.home.setOrganizationHomePage(context.editor, context.org.id, created.id);
      expect(await test.services.home.organizationHomePage(context.reader, context.org.id)).toMatchObject({
        id: created.id,
        number: created.number,
      });
      expect(await test.services.home.organizationHomePage(context.outsider, context.org.id)).toBeNull();
      const events = await test.database.execute<{ target_id: string }>(
        sql`select target_id from audit_events where name = 'settings.changed' and target_id = 'home.organizationPage'
          and scope_id = ${context.org.id}`,
      );
      expect(events.rows).toHaveLength(1);
    });
  });
});
