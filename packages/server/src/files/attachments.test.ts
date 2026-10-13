import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { accountPrincipal, type Principal } from "../accounts/principal.js";
import { SettingAboveMaximumError, SettingLockedError } from "../settings/service.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { FileTooLargeError } from "./files.js";
import { keepVersionsMaximumSetting, keepVersionsSetting, maxFileSizeSetting } from "./settings.js";

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

  async function waitForLockWait() {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const waiting = await test.pool.query<{ count: string }>(
        "select count(*) as count from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
      );
      if (Number(waiting.rows[0]?.count) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("No session waited for a lock");
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

  async function versionNumbers(context: Context, attachmentId: string) {
    return (await test.services.attachments.versions(context.editor, attachmentId)).map(
      (version) => version.number,
    );
  }

  async function withInstanceSettings(run: () => Promise<void>) {
    try {
      await run();
    } finally {
      await test.settings.clear(keepVersionsSetting, {}, "instance");
      await test.settings.clear(keepVersionsMaximumSetting, {}, "instance");
    }
  }

  it("keeps 50 versions by default, at most 500, and the instance alone can allow unlimited", async () => {
    const context = await setup();
    const chain = { organization: context.org.id, space: context.space.id };
    expect(await test.settings.get(keepVersionsSetting, chain)).toBe(50);
    expect(await test.settings.get(keepVersionsMaximumSetting, {})).toBe(500);
    await expect(test.settings.set(keepVersionsSetting, chain, "organization", 501)).rejects.toBeInstanceOf(
      SettingAboveMaximumError,
    );
    await expect(test.settings.set(keepVersionsSetting, chain, "space", "unlimited")).rejects.toBeInstanceOf(
      SettingAboveMaximumError,
    );
    await expect(test.settings.set(keepVersionsSetting, {}, "instance", "unlimited")).rejects.toBeInstanceOf(
      SettingAboveMaximumError,
    );
    await withInstanceSettings(async () => {
      await test.settings.set(keepVersionsMaximumSetting, {}, "instance", "unlimited");
      await test.settings.set(keepVersionsSetting, {}, "instance", "unlimited");
      expect(await test.settings.get(keepVersionsSetting, chain)).toBe("unlimited");
      const file = await upload(context, "all.txt", "1");
      await upload(context, "all.txt", "2");
      await upload(context, "all.txt", "3");
      expect(await versionNumbers(context, file.id)).toEqual([3, 2, 1]);
    });
  });

  it("lets organizations and spaces choose any number up to the maximum unless a level above locks it", async () => {
    const context = await setup();
    const chain = { organization: context.org.id, space: context.space.id };
    await test.settings.set(keepVersionsSetting, chain, "organization", 3);
    await test.settings.set(keepVersionsSetting, chain, "space", 400);
    expect(await test.settings.get(keepVersionsSetting, chain)).toBe(400);
    await test.settings.set(keepVersionsSetting, chain, "space", 2);
    expect(await test.settings.get(keepVersionsSetting, chain)).toBe(2);
    await test.settings.clear(keepVersionsSetting, chain, "space");
    await test.settings.lock(keepVersionsSetting, chain, "organization");
    await expect(test.settings.set(keepVersionsSetting, chain, "space", 10)).rejects.toBeInstanceOf(
      SettingLockedError,
    );
    expect(await test.settings.get(keepVersionsSetting, chain)).toBe(3);
  });

  it("applies a lowered maximum to values set before", async () => {
    const context = await setup();
    const chain = { organization: context.org.id };
    await test.settings.set(keepVersionsSetting, chain, "organization", 300);
    await withInstanceSettings(async () => {
      await test.settings.set(keepVersionsMaximumSetting, {}, "instance", 100);
      expect(await test.settings.get(keepVersionsSetting, chain)).toBe(50);
      await test.settings.set(keepVersionsSetting, {}, "instance", 100);
      await test.settings.set(keepVersionsMaximumSetting, {}, "instance", 20);
      expect(await test.settings.get(keepVersionsSetting, chain)).toBe(20);
      await expect(test.settings.set(keepVersionsSetting, chain, "organization", 21)).rejects.toMatchObject({
        maximum: 20,
      });
    });
  });

  it("removes the oldest unmarked version only when a new version is uploaded", async () => {
    const context = await setup();
    const chain = { organization: context.org.id, space: context.space.id };
    const file = await upload(context, "log.txt", "1");
    await upload(context, "log.txt", "2");
    await upload(context, "log.txt", "3");
    await test.settings.set(keepVersionsSetting, chain, "space", 2);
    expect(await versionNumbers(context, file.id)).toEqual([3, 2, 1]);
    await upload(context, "log.txt", "4");
    expect(await versionNumbers(context, file.id)).toEqual([4, 3]);
  });

  it("never removes versions marked to keep and does not count them", async () => {
    const context = await setup();
    const chain = { organization: context.org.id, space: context.space.id };
    await test.settings.set(keepVersionsSetting, chain, "space", 2);
    const file = await upload(context, "contract.txt", "signed");
    const marked = await test.services.attachments.setKept(context.editor, file.id, 1, true);
    expect(marked).toMatchObject({ number: 1, kept: true });
    await upload(context, "contract.txt", "draft 2");
    await upload(context, "contract.txt", "draft 3");
    await upload(context, "contract.txt", "draft 4");
    expect(await versionNumbers(context, file.id)).toEqual([4, 3, 1]);
    expect(await read(file.id, 1)).toBe("signed");
    await test.services.attachments.setKept(context.editor, file.id, 1, false);
    await upload(context, "contract.txt", "draft 5");
    expect(await versionNumbers(context, file.id)).toEqual([5, 4]);
    const audit = await test.pool.query<{ name: string; fields: Record<string, unknown> }>(
      "select name, fields from audit_events where target_id = $1 and name like 'attachment.%' order by occurred_at",
      [context.page.id],
    );
    expect(audit.rows.map((row) => row.name)).toEqual([
      "attachment.versionKept",
      "attachment.versionReleased",
    ]);
    expect(audit.rows[0]?.fields).toMatchObject({
      attachmentId: file.id,
      fileName: "contract.txt",
      version: 1,
    });
    await expect(test.services.attachments.setKept(context.editor, file.id, 1, true)).rejects.toMatchObject({
      code: "versionNotFound",
    });
  });

  it("does not audit marking a version that is already marked", async () => {
    const context = await setup();
    const file = await upload(context, "note.txt", "x");
    await test.services.attachments.setKept(context.editor, file.id, 1, true);
    await test.services.attachments.setKept(context.editor, file.id, 1, true);
    const audit = await test.pool.query(
      "select 1 from audit_events where target_id = $1 and name = 'attachment.versionKept'",
      [context.page.id],
    );
    expect(audit.rows).toHaveLength(1);
  });

  it("stores identical content of one space once, encrypted, and keeps it while any version uses it", async () => {
    const context = await setup();
    const content = randomBytes(5000).toString("base64");
    const first = await upload(context, "report.txt", content);
    const second = await upload(context, "copy of report.txt", content);
    await upload(context, "report.txt", content);
    const used = await test.pool.query<{ count: string }>(
      `select count(distinct v.file_id) as count from attachment_versions v
       where v.attachment_id = any($1::uuid[])`,
      [[first.id, second.id]],
    );
    expect(Number(used.rows[0]?.count)).toBe(1);
    const firstContent = await test.services.attachments.content(first.id);
    const secondContent = await test.services.attachments.content(second.id);
    expect(secondContent?.fileId).toBe(firstContent?.fileId);
    const row = await test.pool.query<{ content_digest: Buffer }>(
      "select content_digest from stored_files where id = $1",
      [firstContent?.fileId],
    );
    expect(row.rows[0]?.content_digest.toString("hex")).not.toBe(
      createHash("sha256").update(content).digest("hex"),
    );
    await test.settings.set(
      keepVersionsSetting,
      { organization: context.org.id, space: context.space.id },
      "space",
      1,
    );
    await upload(context, "report.txt", "rewritten");
    expect(await versionNumbers(context, first.id)).toEqual([3]);
    await test.services.files.deleteOrphaned();
    expect(await read(second.id)).toBe(content);
  });

  it("never shares stored content between spaces, not even within one organization", async () => {
    const context = await setup();
    const other = await space(context.org.id, context.editorId);
    const otherPage = await test.services.tree.create(context.editor, other.id, {
      kind: "page",
      title: "Elsewhere",
      mode: "live",
      placement: { parentId: null },
    });
    const content = randomBytes(4000);
    const here = await upload(context, "secret.bin", content);
    const there = await test.services.attachments.upload(context.editor, otherPage.id, {
      name: "secret.bin",
      body: Readable.from([content]),
    });
    expect((await test.services.attachments.content(there.id))?.fileId).not.toBe(
      (await test.services.attachments.content(here.id))?.fileId,
    );
  });

  it("handles an upload of existing content exactly like new content", async () => {
    const context = await setup();
    const existing = randomBytes(3000);
    await upload(context, "hidden.bin", existing);
    const trace = async (name: string, content: Buffer) => {
      const deletes = vi.spyOn(test.services.files.store, "delete");
      const rows = async () =>
        Number(
          (await test.pool.query<{ count: string }>("select count(*) as count from stored_files")).rows[0]
            ?.count,
        );
      const before = {
        rows: await rows(),
        usage: await test.services.attachments.usage({ spaceId: context.space.id }),
      };
      const created = await upload(context, name, content);
      const after = {
        rows: await rows(),
        usage: await test.services.attachments.usage({ spaceId: context.space.id }),
      };
      const removed = deletes.mock.calls.length;
      deletes.mockRestore();
      const { id: _id, uploadedAt: _uploadedAt, createdAt: _createdAt, name: _name, ...shape } = created;
      return {
        shape,
        rows: after.rows - before.rows,
        bytes: after.usage.bytes - before.usage.bytes,
        files: after.usage.files - before.usage.files,
        removed,
      };
    };
    const fresh = await trace("fresh.bin", randomBytes(3000));
    const duplicate = await trace("probe.bin", existing);
    expect(duplicate).toEqual(fresh);
    expect(duplicate).toMatchObject({ rows: 1, bytes: 3000, files: 1, removed: 0 });
    expect(await test.services.files.deleteOrphaned()).toBeGreaterThanOrEqual(1);
  });

  it("does not reuse stored content of another type or size", async () => {
    const context = await setup();
    const text = await upload(context, "data.txt", "a,b\n1,2\n");
    const table = await upload(context, "data.csv", "a,b\n1,2\n");
    expect((await test.services.attachments.content(text.id))?.fileId).not.toBe(
      (await test.services.attachments.content(table.id))?.fileId,
    );
  });

  it("returns a still used file to ready instead of removing it", async () => {
    const context = await setup();
    const file = await upload(context, "kept.txt", "still here");
    const content = await test.services.attachments.content(file.id);
    await test.pool.query("update stored_files set state = 'orphaned' where id = $1", [content?.fileId]);
    await test.services.files.deleteOrphaned();
    const row = await test.pool.query<{ state: string }>("select state from stored_files where id = $1", [
      content?.fileId,
    ]);
    expect(row.rows[0]?.state).toBe("ready");
    expect(await read(file.id)).toBe("still here");
  });

  it("keeps at most the configured number of versions and releases the files of removed ones", async () => {
    const context = await setup();
    await test.settings.set(keepVersionsSetting, { organization: context.org.id }, "organization", 2);
    const first = await upload(context, "log.txt", `1 ${randomUUID()}`);
    await upload(context, "log.txt", `2 ${randomUUID()}`);
    await upload(context, "log.txt", `3 ${randomUUID()}`);
    const versions = await test.services.attachments.versions(context.editor, first.id);
    expect(versions.map((version) => version.number)).toEqual([3, 2]);
    expect(await test.services.files.deleteOrphaned()).toBeGreaterThanOrEqual(1);
    expect(await read(first.id)).toMatch(/^3 /);
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
    const file = await upload(context, "plan.txt", randomUUID());
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

  it("remove a stored upload whose attachment was never saved, for example after a crash", async () => {
    const stored = await test.services.files.write(Readable.from([randomBytes(100)]), {
      name: "lost.bin",
      maxBytes: 1000,
    });
    await test.pool.query("update stored_files set updated_at = now() - interval '2 days' where id = $1", [
      stored.id,
    ]);
    await test.services.files.deleteOrphaned(10_000);
    const rows = await test.pool.query("select 1 from stored_files where id = $1", [stored.id]);
    expect(rows.rows).toEqual([]);
    await expect(test.services.files.commit(test.database, stored.id)).rejects.toThrow(
      "The uploaded file was removed before it was saved",
    );
  });

  it("keep a deduplicated file ready when the last other version using it is deleted at the same moment", async () => {
    const context = await setup();
    const content = randomBytes(2000);
    const first = await upload(context, "first.bin", content);
    const firstVersion = await test.services.attachments.content(first.id);
    const stored = await test.services.files.write(Readable.from([content]), {
      name: "second.bin",
      maxBytes: 10_000,
    });
    let deleting: Promise<unknown> | undefined;
    await test.database.transaction(async (tx) => {
      const fileId = await test.services.files.reuse(tx, stored, context.space.id);
      expect(fileId).toBe(firstVersion?.fileId);
      const attachmentId = uuidv7();
      await tx.execute(sql`
        insert into attachments (id, item_id, name, name_key)
        values (${attachmentId}, ${context.page.id}, 'second.bin', 'second.bin')`);
      await tx.execute(sql`
        insert into attachment_versions (id, attachment_id, number, file_id, name)
        values (${uuidv7()}, ${attachmentId}, 1, ${fileId}, 'second.bin')`);
      deleting = test.pool.query("delete from attachment_versions where id = $1", [firstVersion?.versionId]);
      await waitForLockWait();
    });
    await deleting;
    const state = await test.pool.query<{ state: string }>("select state from stored_files where id = $1", [
      firstVersion?.fileId,
    ]);
    expect(state.rows[0]?.state).toBe("ready");
  });

  it("answer bringing back a deleted attachment while a file of the same name is uploaded with nameTaken", async () => {
    const context = await setup();
    const file = await upload(context, "notes.txt", "old");
    await test.services.attachments.delete(context.editor, file.id);
    let restoring: Promise<unknown> | undefined;
    await test.database.transaction(async (tx) => {
      await tx.execute(sql`select id from tree_items where id = ${context.page.id} for update`);
      await tx.execute(sql`
        insert into attachments (id, item_id, name, name_key)
        values (${uuidv7()}, ${context.page.id}, 'notes.txt', 'notes.txt')`);
      restoring = test.services.attachments
        .undelete(context.editor, file.id)
        .catch((error: unknown) => error);
      await waitForLockWait();
    });
    expect(await restoring).toMatchObject({ name: "AttachmentError", code: "nameTaken" });
  });
});
