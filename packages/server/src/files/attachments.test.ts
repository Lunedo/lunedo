import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, type Principal } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { FileTooLargeError } from "./files.js";
import { keepVersionsSetting, maxFileSizeSetting } from "./settings.js";

const baseUrl = testDatabaseBaseUrl();
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]);

describe.skipIf(!baseUrl)("attachments", () => {
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
    const outsiderId = await member(org.id, "member", "Outsider");
    const created = await space(org.id, editorId, {
      grants: [
        { principalKind: "account", principalId: readerId, role: "reader" },
        { principalKind: "account", principalId: outsiderId, role: "reader" },
      ],
    });
    const editor = accountPrincipal(editorId);
    const page = await test.services.tree.create(editor, created.id, {
      kind: "page",
      title: "Handbook",
      mode: "live",
      placement: { parentId: null },
    });
    return {
      org,
      space: created,
      page,
      editor,
      editorId,
      reader: accountPrincipal(readerId),
      outsider: accountPrincipal(outsiderId),
    };
  }

  type Context = Awaited<ReturnType<typeof setup>>;

  function upload(
    context: Context,
    name: string,
    content: Buffer | string,
    actor: Principal = context.editor,
  ) {
    const bytes = typeof content === "string" ? Buffer.from(content) : content;
    return test.services.attachments.upload(actor, context.page.id, {
      name,
      body: Readable.from([bytes]),
      contentLength: bytes.length,
    });
  }

  async function can(viewer: Principal, action: string, id: string) {
    return (
      await test.services.authorization.explain(viewer, action, { type: "attachment", id }, { fresh: true })
    ).allowed;
  }

  async function read(attachmentId: string, number?: number) {
    const content = await test.services.attachments.content(attachmentId, number);
    if (!content) throw new Error("missing");
    return (await buffer(await test.services.files.read(content.fileId))).toString();
  }

  it("lists name, type and size and keeps a new version for the same name", async () => {
    const context = await setup();
    const first = await upload(context, "plan.txt", "version one");
    expect(first).toMatchObject({ name: "plan.txt", size: 11, version: 1, preview: "text" });
    const second = await upload(context, "PLAN.txt", "version two!");
    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({ version: 2, versions: 2, name: "PLAN.txt" });
    const image = await upload(context, "logo.png", PNG);
    expect(image).toMatchObject({ contentType: "image/png", preview: "image", inline: true });
    const listed = await test.services.attachments.list(context.reader, context.page.id);
    expect(listed.map((attachment) => attachment.name)).toEqual(["logo.png", "PLAN.txt"]);
    expect(await read(first.id, 1)).toBe("version one");
  });

  it("restores an earlier version as a new version", async () => {
    const context = await setup();
    const first = await upload(context, "plan.txt", "one");
    await upload(context, "plan.txt", "two");
    const restored = await test.services.attachments.restoreVersion(context.editor, first.id, 1);
    expect(restored.version).toBe(3);
    expect(await read(first.id)).toBe("one");
    const versions = await test.services.attachments.versions(context.editor, first.id);
    expect(versions.map((version) => [version.number, version.restoredFrom])).toEqual([
      [3, 1],
      [2, null],
      [1, null],
    ]);
  });

  it("keeps at most the configured number of versions and releases the files of removed ones", async () => {
    const context = await setup();
    await test.settings.set(keepVersionsSetting, { organization: context.org.id }, "organization", 2);
    const first = await upload(context, "log.txt", "1");
    await upload(context, "log.txt", "2");
    await upload(context, "log.txt", "3");
    const versions = await test.services.attachments.versions(context.editor, first.id);
    expect(versions.map((version) => version.number)).toEqual([3, 2]);
    expect(await test.services.files.deleteOrphaned()).toBeGreaterThanOrEqual(1);
    expect(await read(first.id)).toBe("3");
  });

  it("refuses files above the organization's limit before storing them, naming the limit", async () => {
    const context = await setup();
    await test.settings.set(maxFileSizeSetting, { organization: context.org.id }, "organization", 1);
    const before = await test.pool.query<{ count: string }>("select count(*) as count from stored_files");
    const tooBig = randomBytes(1024 * 1024 + 1);
    await expect(upload(context, "big.bin", tooBig)).rejects.toMatchObject({
      name: "FileTooLargeError",
      limit: 1024 * 1024,
    });
    await expect(
      test.services.attachments.upload(context.editor, context.page.id, {
        name: "big.bin",
        body: Readable.from([tooBig]),
      }),
    ).rejects.toBeInstanceOf(FileTooLargeError);
    const after = await test.pool.query<{ count: string }>("select count(*) as count from stored_files");
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });

  it("can be deleted and brought back", async () => {
    const context = await setup();
    const file = await upload(context, "notes.txt", "x");
    await test.services.attachments.delete(context.editor, file.id);
    expect(await test.services.attachments.list(context.editor, context.page.id)).toEqual([]);
    expect(await can(context.editor, "attachment.view", file.id)).toBe(false);
    await test.services.attachments.undelete(context.editor, file.id);
    expect(
      (await test.services.attachments.list(context.editor, context.page.id)).map((entry) => entry.id),
    ).toEqual([file.id]);
  });

  it("follow the page: readers read, editors change, restricted and trashed pages hide them", async () => {
    const context = await setup();
    const file = await upload(context, "plan.txt", "x");
    expect(await can(context.reader, "attachment.view", file.id)).toBe(true);
    expect(await can(context.reader, "attachment.edit", file.id)).toBe(false);
    expect(await can(context.editor, "attachment.edit", file.id)).toBe(true);
    await test.services.pageAccess.change(context.editor, context.page.id, [
      {
        action: "share",
        holderKind: "account",
        holderId: context.reader.type === "account" ? context.reader.id : "",
        role: "reader",
      },
      { action: "restrict", kind: "view" },
    ]);
    expect(await can(context.outsider, "attachment.view", file.id)).toBe(false);
    expect(await can(context.reader, "attachment.view", file.id)).toBe(true);
    await test.services.trash.deleteItem(context.editor, context.page.id);
    expect(await can(context.editor, "attachment.view", file.id)).toBe(false);
  });

  it("are counted per space and organization", async () => {
    const context = await setup();
    await upload(context, "a.txt", "12345");
    await upload(context, "b.txt", "123");
    expect(await test.services.attachments.usage({ spaceId: context.space.id })).toEqual({
      bytes: 8,
      files: 2,
    });
    expect(await test.services.attachments.usage({ organizationId: context.org.id })).toEqual({
      bytes: 8,
      files: 2,
    });
  });

  it("serve as blog cover with a focal point", async () => {
    const context = await setup();
    const post = await test.services.blog.create(context.editor, context.space.id, { title: "News" });
    const image = await test.services.attachments.upload(context.editor, post.id, {
      name: "cover.png",
      body: Readable.from([PNG]),
    });
    const text = await test.services.attachments.upload(context.editor, post.id, {
      name: "notes.txt",
      body: Readable.from([Buffer.from("x")]),
    });
    await expect(
      test.services.blog.setCover(context.editor, post.id, {
        attachmentId: text.id,
        focusX: 0.5,
        focusY: 0.5,
      }),
    ).rejects.toMatchObject({ code: "invalidCover" });
    const updated = await test.services.blog.setCover(context.editor, post.id, {
      attachmentId: image.id,
      focusX: 0.25,
      focusY: 0.75,
    });
    expect(updated.cover).toEqual({ attachmentId: image.id, focusX: 0.25, focusY: 0.75 });
    await test.services.attachments.delete(context.editor, image.id);
    expect((await test.services.blog.get(context.editor, post.id))?.cover).toBeNull();
  });

  it("are removed with their files when the page is deleted for good", async () => {
    const context = await setup();
    const file = await upload(context, "plan.txt", "x");
    const content = await test.services.attachments.content(file.id);
    const entry = await test.services.trash.deleteItem(context.editor, context.page.id);
    await test.services.trash.deleteImmediately(
      accountPrincipal(context.org.owner),
      entry.id,
      "Erasure request",
    );
    await test.services.files.deleteOrphaned();
    const rows = await test.pool.query("select 1 from stored_files where id = $1", [content?.fileId]);
    expect(rows.rows).toEqual([]);
  });
});
