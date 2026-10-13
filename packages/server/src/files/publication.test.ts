import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, type Principal } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { keepVersionsSetting } from "./settings.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("attachments of drafts", () => {
  let test: TestServices;
  const { organization, member, space } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function setup(mode: "publish" | "live" = "publish") {
    const org = await organization();
    const editorId = await member(org.id, "member", "Editor");
    const readerId = await member(org.id, "member", "Reader");
    const created = await space(org.id, editorId, {
      grants: [{ principalKind: "account", principalId: readerId, role: "reader" }],
    });
    const editor = accountPrincipal(editorId);
    const page = await test.services.tree.create(editor, created.id, {
      kind: "page",
      title: "Policy",
      mode,
      placement: { parentId: null },
    });
    if (mode === "publish") await test.services.versions.publish(editor, page.id);
    return { org, space: created, page, editor, reader: accountPrincipal(readerId) };
  }

  type Context = Awaited<ReturnType<typeof setup>>;

  function upload(
    context: Context,
    name: string,
    content: string | Buffer,
    actor: Principal = context.editor,
  ) {
    const bytes = typeof content === "string" ? Buffer.from(content) : content;
    return test.services.attachments.upload(actor, context.page.id, {
      name,
      body: Readable.from([bytes]),
      contentLength: bytes.length,
    });
  }

  async function names(context: Context, view: "draft" | "published") {
    return (await test.services.attachments.list(context.editor, context.page.id, view)).map(
      (attachment) => attachment.name,
    );
  }

  async function can(viewer: Principal, action: string, id: string) {
    return (
      await test.services.authorization.explain(viewer, action, { type: "attachment", id }, { fresh: true })
    ).allowed;
  }

  it("deny readers an attachment added in the draft and allow editors", async () => {
    const context = await setup();
    const added = await upload(context, "draft.txt", "x");
    expect(await can(context.reader, "attachment.view", added.id)).toBe(false);
    expect(await can(context.editor, "attachment.view", added.id)).toBe(true);
    await test.services.versions.publish(context.editor, context.page.id);
    expect(await can(context.reader, "attachment.view", added.id)).toBe(true);
  });

  it("count attachment changes as draft changes, so that the draft can be published and discarded", async () => {
    const context = await setup();
    expect((await test.services.versions.draft(context.page.id)).hasChanges).toBe(false);
    await upload(context, "draft.txt", "x");
    const draft = await test.services.versions.draft(context.page.id);
    expect(draft).toMatchObject({ hasChanges: true, changes: 1 });
    expect(await test.services.versions.publish(context.editor, context.page.id)).toMatchObject({
      created: true,
    });
    expect((await test.services.versions.draft(context.page.id)).hasChanges).toBe(false);
  });

  it("show readers only versions that were published, not those replaced within one draft", async () => {
    const context = await setup();
    const file = await upload(context, "plan.txt", "one");
    await test.services.versions.publish(context.editor, context.page.id);
    await upload(context, "plan.txt", "two");
    await upload(context, "plan.txt", "three");
    await test.services.versions.publish(context.editor, context.page.id);
    const published = await test.services.attachments.versions(context.reader, file.id, "published");
    expect(published.map((version) => version.number)).toEqual([3, 1]);
    expect(await test.services.attachments.content(file.id, "published", 2)).toBeNull();
    expect(await test.services.attachments.content(file.id, "draft", 2)).not.toBeNull();
  });

  it("never remove the published version when old versions are pruned", async () => {
    const context = await setup();
    await test.settings.set(
      keepVersionsSetting,
      { organization: context.org.id, space: context.space.id },
      "space",
      1,
    );
    const file = await upload(context, "rates.txt", "published");
    await test.services.versions.publish(context.editor, context.page.id);
    await upload(context, "rates.txt", "draft 2");
    await upload(context, "rates.txt", "draft 3");
    const content = await test.services.attachments.content(file.id, "published");
    expect(content?.version).toBe(1);
    const versions = await test.services.attachments.versions(context.editor, file.id, "draft");
    expect(versions.map((version) => version.number)).toEqual([3, 1]);
  });

  it("publish the draft's attachments when the page switches to live mode", async () => {
    const context = await setup();
    await upload(context, "draft.txt", "x");
    await expect(
      test.services.versions.changeMode(context.editor, context.page.id, "live"),
    ).rejects.toMatchObject({ code: "draftPending" });
    await test.services.versions.changeMode(context.editor, context.page.id, "live", { confirmDraft: true });
    expect(await names(context, "published")).toEqual(["draft.txt"]);
  });

  it("restore a discarded draft over a changed draft, keeping the replaced draft's attachments with it", async () => {
    const context = await setup();
    await upload(context, "first.txt", "first draft");
    const { discardedDraftId } = await test.services.versions.discard(context.editor, context.page.id);
    expect(await names(context, "draft")).toEqual([]);
    await upload(context, "second.txt", "second draft");
    await test.services.versions.restoreDiscarded(context.editor, context.page.id, discardedDraftId);
    expect(await names(context, "draft")).toEqual(["first.txt"]);
    expect(await names(context, "published")).toEqual([]);
    const [replaced] = await test.services.versions.discardedDrafts(context.page.id);
    expect(replaced?.reason).toBe("replaced");
    await test.services.versions.restoreDiscarded(context.editor, context.page.id, replaced?.id ?? "");
    expect(await names(context, "draft")).toEqual(["second.txt"]);
  });

  it("delete attachments added only for a discarded draft when it expires, and release their files", async () => {
    const context = await setup();
    const added = await upload(context, "draft.txt", randomUUID());
    const fileId = (await test.services.attachments.content(added.id, "draft"))?.fileId;
    const { discardedDraftId } = await test.services.versions.discard(context.editor, context.page.id);
    await test.pool.query(
      "update discarded_drafts set expires_at = now() - interval '1 minute' where id = $1",
      [discardedDraftId],
    );
    await test.services.versions.removeExpiredDrafts();
    const rows = await test.pool.query("select 1 from attachments where id = $1", [added.id]);
    expect(rows.rows).toEqual([]);
    const file = await test.pool.query<{ state: string }>("select state from stored_files where id = $1", [
      fileId,
    ]);
    expect(file.rows[0]?.state).toBe("orphaned");
  });
});
