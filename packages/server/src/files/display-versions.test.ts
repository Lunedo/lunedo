import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { crc32 } from "node:zlib";
import { sql } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { accountPrincipal, type Principal } from "../accounts/principal.js";
import { NotificationListener } from "../database/notifications.js";
import type { JobDefinition, JobHandler, JobQueue } from "../jobs/job-queue.js";
import { createLogger } from "../logging/logger.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { testJobContext } from "../testing/jobs.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { MAX_DISPLAY_VERSION_ATTEMPTS } from "./display-versions.js";
import { displayVersionJob, queueDisplayVersionsJob, startDisplayVersions } from "./jobs.js";

const baseUrl = testDatabaseBaseUrl();
const logger = createLogger({ service: "test", level: "silent" });

class RecordingQueue {
  readonly enqueued: { name: string; payload: unknown; key: string | undefined }[] = [];
  readonly handlers = new Map<string, JobHandler<unknown>>();
  readonly concurrency = new Map<string, number | undefined>();
  readonly schedules: string[] = [];

  async enqueue<T>(definition: JobDefinition<T>, payload: T, options: { idempotencyKey?: string } = {}) {
    this.enqueued.push({ name: definition.name, payload, key: options.idempotencyKey });
    return randomUUID();
  }

  async work<T>(
    definition: JobDefinition<T>,
    handler: JobHandler<T>,
    options: { concurrency?: number } = {},
  ) {
    this.handlers.set(definition.name, handler as JobHandler<unknown>);
    this.concurrency.set(definition.name, options.concurrency);
  }

  async schedule<T>(definition: JobDefinition<T>) {
    this.schedules.push(definition.name);
  }
}

function photo(
  width: number,
  height: number,
  format: "png" | "jpeg" | "gif" | "webp",
  orientation?: number,
): Promise<Buffer> {
  const image = sharp({ create: { width, height, channels: 3, background: "#3366cc" } }).withExif({
    IFD0: { Copyright: "Test", Artist: "Photographer" },
  });
  return (orientation ? image.withMetadata({ orientation }) : image)[format]().toBuffer();
}

function declaredPng(width: number, height: number, small: Buffer): Buffer {
  const patched = Buffer.from(small);
  patched.writeUInt32BE(width, 16);
  patched.writeUInt32BE(height, 20);
  patched.writeUInt32BE(crc32(patched.subarray(12, 29)) >>> 0, 29);
  return patched;
}

describe.skipIf(!baseUrl)("display versions of images", () => {
  let test: TestServices;
  let listener: NotificationListener;
  const { organization, member, space } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
    listener = new NotificationListener({ connectionString: test.url, logger });
  });

  afterAll(async () => {
    await listener?.close();
    await test?.close();
  });

  async function setup() {
    const org = await organization();
    const editorId = await member(org.id, "member", "Editor");
    const created = await space(org.id, editorId);
    const editor = accountPrincipal(editorId);
    const page = await test.services.tree.create(editor, created.id, {
      kind: "page",
      title: "Photos",
      mode: "live",
      placement: { parentId: null },
    });
    return { org, space: created, page, editor };
  }

  function upload(actor: Principal, itemId: string, name: string, bytes: Buffer) {
    return test.services.attachments.upload(actor, itemId, {
      name,
      body: Readable.from([bytes]),
      contentLength: bytes.length,
    });
  }

  async function sourceOf(attachmentId: string) {
    const content = await test.services.attachments.content(attachmentId, "draft");
    if (!content) throw new Error("The attachment has no content");
    return content;
  }

  async function stateOf(fileId: string) {
    const result = await test.database.execute<{ display_version_state: string | null }>(
      sql`select display_version_state from stored_files where id = ${fileId}`,
    );
    return result.rows[0]?.display_version_state ?? null;
  }

  async function versionsOf(fileId: string) {
    const result = await test.database.execute<{
      size: string;
      width: number;
      height: number;
      file_id: string;
    }>(
      sql`select size, width, height, file_id from display_versions where source_file_id = ${fileId} order by size`,
    );
    return result.rows;
  }

  async function sized(attachmentId: string, size: "display" | "preview") {
    const content = await test.services.displayVersions.apply(await sourceOf(attachmentId), size);
    if (!content) throw new Error("The image is too large to show");
    return content;
  }

  it.each([
    ["png", "image/png"],
    ["jpeg", "image/jpeg"],
    ["gif", "image/gif"],
    ["webp", "image/webp"],
  ] as const)(
    "creates a display version and a preview of a large %s without metadata",
    async (format, type) => {
      const { page, editor } = await setup();
      const attachment = await upload(editor, page.id, `large.${format}`, await photo(3000, 2000, format));
      const source = await sourceOf(attachment.id);
      expect(source.contentType).toBe(type);
      expect(await stateOf(source.fileId)).toBe("pending");

      expect(await test.services.displayVersions.create(source.fileId, { lastAttempt: false })).toBe("done");

      expect(await stateOf(source.fileId)).toBe("done");
      const versions = await versionsOf(source.fileId);
      expect(versions.map(({ size, width, height }) => ({ size, width, height }))).toEqual([
        { size: "display", width: 2048, height: 1365 },
        { size: "preview", width: 400, height: 267 },
      ]);
      for (const size of ["display", "preview"] as const) {
        const content = await sized(attachment.id, size);
        expect(content.displaySize).toBe(size);
        expect(content.contentType).toBe("image/webp");
        expect(content.name).toBe("large.webp");
        const bytes = await test.services.files.readAll(content.fileId, 10 * 1024 * 1024);
        expect(content.size).toBe(bytes.length);
        const metadata = await sharp(bytes).metadata();
        expect(metadata.format).toBe("webp");
        expect(metadata.exif).toBeUndefined();
        expect(metadata.xmp).toBeUndefined();
      }
      const original = await test.services.files.readAll(source.fileId, 10 * 1024 * 1024);
      expect(original.length).toBe(source.size);
    },
  );

  it("turns the display versions of a photo the way its orientation says", async () => {
    const { page, editor } = await setup();
    const attachment = await upload(editor, page.id, "portrait.jpg", await photo(3000, 2000, "jpeg", 6));
    const source = await sourceOf(attachment.id);

    await test.services.displayVersions.create(source.fileId, { lastAttempt: false });

    const display = await sized(attachment.id, "display");
    const metadata = await sharp(
      await test.services.files.readAll(display.fileId, 10 * 1024 * 1024),
    ).metadata();
    expect({ width: metadata.width, height: metadata.height, orientation: metadata.orientation }).toEqual({
      width: 1365,
      height: 2048,
      orientation: undefined,
    });
  });

  it("creates only a preview for images up to the display size and nothing for small ones", async () => {
    const { page, editor } = await setup();
    const medium = await upload(editor, page.id, "medium.png", await photo(1200, 600, "png"));
    const small = await upload(editor, page.id, "small.png", await photo(300, 200, "png"));
    const mediumSource = await sourceOf(medium.id);
    const smallSource = await sourceOf(small.id);

    expect(await test.services.displayVersions.create(mediumSource.fileId, { lastAttempt: false })).toBe(
      "done",
    );
    expect(await test.services.displayVersions.create(smallSource.fileId, { lastAttempt: false })).toBe(
      "none",
    );

    expect((await versionsOf(mediumSource.fileId)).map((row) => [row.size, row.width, row.height])).toEqual([
      ["preview", 400, 200],
    ]);
    expect(await sized(medium.id, "display")).toEqual(mediumSource);
    expect((await sized(medium.id, "preview")).displaySize).toBe("preview");
    expect(await versionsOf(smallSource.fileId)).toEqual([]);
    expect(await stateOf(smallSource.fileId)).toBe("none");
    expect(await sized(small.id, "display")).toEqual(smallSource);
  });

  it("leaves SVG and other files alone and keeps animated images as they are", async () => {
    const { page, editor } = await setup();
    const svg = await upload(
      editor,
      page.id,
      "plan.svg",
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="3000"><rect width="10" height="10"/></svg>',
      ),
    );
    const text = await upload(editor, page.id, "notes.txt", Buffer.from("Large photo below"));
    const frame = (color: string) =>
      sharp({ create: { width: 2600, height: 2200, channels: 3, background: color } })
        .png()
        .toBuffer();
    const animation = await sharp([await frame("#ff0000"), await frame("#00ff00")], {
      join: { animated: true },
    })
      .gif()
      .toBuffer();
    const animated = await upload(editor, page.id, "spinner.gif", animation);

    expect(await stateOf((await sourceOf(svg.id)).fileId)).toBeNull();
    expect(await stateOf((await sourceOf(text.id)).fileId)).toBeNull();
    const animatedSource = await sourceOf(animated.id);
    expect(await test.services.displayVersions.create(animatedSource.fileId, { lastAttempt: false })).toBe(
      "none",
    );
    expect(await versionsOf(animatedSource.fileId)).toEqual([]);
    expect(await sized(animated.id, "display")).toEqual(animatedSource);
    expect(
      (await sharp(await test.services.files.readAll(animatedSource.fileId, 1024 * 1024)).metadata()).pages,
    ).toBe(2);
  });

  it("marks images above the pixel limit at upload and never serves a smaller version of them", async () => {
    const { page, editor } = await setup();
    const huge = declaredPng(20_000, 20_000, await photo(4, 4, "png"));
    const attachment = await upload(editor, page.id, "huge.png", huge);
    const source = await sourceOf(attachment.id);

    expect(attachment.tooLargeForPreview).toBe(true);
    expect(source.tooLargeForPreview).toBe(true);
    expect(await stateOf(source.fileId)).toBe("tooLarge");
    expect(await test.services.displayVersions.create(source.fileId, { lastAttempt: false })).toBe("skipped");
    expect(await versionsOf(source.fileId)).toEqual([]);
    for (const size of ["display", "preview"] as const) {
      expect(await test.services.displayVersions.apply(source, size)).toBeNull();
    }
    expect(await test.services.displayVersions.apply(source, undefined)).toEqual(source);
    const small = await upload(editor, page.id, "small.png", await photo(300, 200, "png"));
    expect(small.tooLargeForPreview).toBe(false);
  });

  it("marks existing images above the pixel limit when their versions are made, without decoding them", async () => {
    const { page, editor } = await setup();
    const attachment = await upload(
      editor,
      page.id,
      "old.png",
      declaredPng(20_000, 20_000, await photo(4, 4, "png")),
    );
    const source = await sourceOf(attachment.id);
    await test.database.execute(
      sql`update stored_files set display_version_state = 'pending' where id = ${source.fileId}`,
    );

    expect(await test.services.displayVersions.create(source.fileId, { lastAttempt: false })).toBe(
      "tooLarge",
    );

    expect(await stateOf(source.fileId)).toBe("tooLarge");
    expect(await versionsOf(source.fileId)).toEqual([]);
  });

  it("names images above the pixel limit in the references only for people who can see them", async () => {
    const org = await organization();
    const editorId = await member(org.id, "member", "Editor");
    const readerId = await member(org.id, "member", "Reader");
    const wiki = await space(org.id, editorId, {
      grants: [{ principalKind: "account", principalId: readerId, role: "reader" }],
    });
    const editor = accountPrincipal(editorId);
    const create = (title: string) =>
      test.services.tree.create(editor, wiki.id, {
        kind: "page",
        title,
        mode: "live",
        placement: { parentId: null },
      });
    const page = await create("Photos");
    const secret = await create("Secret");
    const tooLarge = async () => declaredPng(20_000, 20_000, await photo(4, 4, "png"));
    const huge = await upload(editor, page.id, "huge.png", await tooLarge());
    const normal = await upload(editor, page.id, "normal.png", await photo(300, 200, "png"));
    const hidden = await upload(editor, secret.id, "hidden.png", await tooLarge());
    await test.services.pageAccess.change(editor, secret.id, [{ action: "restrict", kind: "view" }]);
    const document = {
      type: "doc" as const,
      content: [huge, normal, hidden].map((file) => ({
        type: "image",
        attrs: { attachmentId: file.id, alt: "" },
      })),
    };

    expect((await test.services.documents.references(editor, document)).tooLargeImages).toEqual(
      [huge.id, hidden.id].sort(),
    );
    expect(
      (await test.services.documents.references(accountPrincipal(readerId), document)).tooLargeImages,
    ).toEqual([huge.id]);
  });

  it("uses the original while a version is pending and after it failed for good", async () => {
    const { page, editor } = await setup();
    const broken = Buffer.from(await photo(3000, 2000, "png"));
    broken.fill(0, broken.length - 400, broken.length - 20);
    const attachment = await upload(editor, page.id, "broken.png", broken);
    const source = await sourceOf(attachment.id);
    expect(await sized(attachment.id, "display")).toEqual(source);

    for (let attempt = 1; attempt < MAX_DISPLAY_VERSION_ATTEMPTS; attempt++) {
      await expect(
        test.services.displayVersions.create(source.fileId, { lastAttempt: false }),
      ).rejects.toThrow();
      expect(await stateOf(source.fileId)).toBe("pending");
    }
    expect(await test.services.displayVersions.create(source.fileId, { lastAttempt: false })).toBe("failed");

    expect(await stateOf(source.fileId)).toBe("failed");
    expect(await sized(attachment.id, "display")).toEqual(source);
    const leftovers = await test.database.execute(sql`
      select 1 from stored_files where state in ('pending', 'stored') and display_version_state is null
        and created_at > now() - interval '1 minute' and content_type = 'image/webp'`);
    expect(leftovers.rows).toEqual([]);
  });

  it("stops retrying a file whose job never finished", async () => {
    const { page, editor } = await setup();
    const attachment = await upload(editor, page.id, "crashing.png", await photo(3000, 2000, "png"));
    const source = await sourceOf(attachment.id);
    await test.database.execute(sql`
      update stored_files set display_version_attempts = ${MAX_DISPLAY_VERSION_ATTEMPTS} where id = ${source.fileId}`);

    expect(await test.services.displayVersions.create(source.fileId, { lastAttempt: false })).toBe("failed");
    expect(await versionsOf(source.fileId)).toEqual([]);
  });

  it("shares the versions with copies, templates and pages made from them and removes them with the last user", async () => {
    const { page, editor, space: wiki } = await setup();
    const attachment = await upload(editor, page.id, "network.png", await photo(3000, 2000, "png"));
    await test.services.documents.replace(editor, page.id, {
      type: "doc",
      content: [{ type: "image", attrs: { attachmentId: attachment.id, alt: "Network" } }],
    });
    const source = await sourceOf(attachment.id);
    await test.services.displayVersions.create(source.fileId, { lastAttempt: false });
    const [display] = await versionsOf(source.fileId);

    const copy = await test.services.copies.copy(editor, page.id, {
      spaceId: wiki.id,
      parentId: null,
      descendants: false,
    });
    const [copied] = await test.services.attachments.list(editor, copy.item?.id ?? "", "draft");
    expect((await sized(copied?.id ?? "", "display")).fileId).toBe(display?.file_id);

    const template = await test.services.templates.saveFromPage(editor, wiki.id, page.id, {
      name: "Network",
      description: "",
      category: "operations",
    });
    const files = await test.database.execute<{ id: string }>(
      sql`select id from template_files where template_id = ${template.id}`,
    );
    const templateFile = await test.services.templates.files.content(template.id, files.rows[0]?.id ?? "");
    if (!templateFile) throw new Error("The template has no file");
    expect((await test.services.displayVersions.apply(templateFile, "display"))?.fileId).toBe(
      display?.file_id,
    );

    const created = await test.services.templates.instantiate(editor, wiki.id, {
      templateId: template.id,
      values: {},
      placement: { parentId: null },
      mode: "live",
    });
    const [fromTemplate] = await test.services.attachments.list(editor, created.id, "draft");
    expect((await sized(fromTemplate?.id ?? "", "display")).fileId).toBe(display?.file_id);

    const removeAll = async () => {
      for (const itemId of [page.id, copy.item?.id ?? "", created.id]) {
        await test.services.trash.deleteImmediately(
          editor,
          (await test.services.trash.deleteItem(editor, itemId)).id,
          "Test",
        );
      }
    };
    await removeAll();
    while ((await test.services.files.deleteOrphaned()) > 0) {}
    expect((await versionsOf(source.fileId)).length).toBe(2);

    await test.services.templates.delete(editor, template.id);
    while ((await test.services.files.deleteOrphaned()) > 0) {}
    const remaining = await test.database.execute(sql`
      select id from stored_files where id = any(${sql.param([source.fileId, ...(await versionsOf(source.fileId)).map((row) => row.file_id), display?.file_id ?? ""])}::uuid[])`);
    expect(remaining.rows).toEqual([]);
  });

  it("counts the versions in the storage usage of the space but not as files", async () => {
    const { page, editor, space: wiki } = await setup();
    const attachment = await upload(editor, page.id, "usage.png", await photo(3000, 2000, "png"));
    const source = await sourceOf(attachment.id);
    const before = await test.services.attachments.usage({ spaceId: wiki.id });

    await test.services.displayVersions.create(source.fileId, { lastAttempt: false });

    const versions = await versionsOf(source.fileId);
    let added = 0;
    for (const version of versions) {
      added += (await test.services.files.readAll(version.file_id, 10 * 1024 * 1024)).length;
    }
    expect(await test.services.attachments.usage({ spaceId: wiki.id })).toEqual({
      bytes: before.bytes + added,
      files: before.files,
    });
  });

  it("queues new images when they are saved and existing ones at start, and the job creates the versions", async () => {
    const { page, editor } = await setup();
    const existing = await upload(editor, page.id, "existing.png", await photo(3000, 2000, "png"));
    const existingSource = await sourceOf(existing.id);
    const queue = new RecordingQueue();

    await startDisplayVersions({
      jobs: queue as unknown as JobQueue,
      listener,
      displayVersions: test.services.displayVersions,
      logger,
    });

    expect(queue.concurrency.get(displayVersionJob.name)).toBe(2);
    expect(queue.schedules).toEqual([queueDisplayVersionsJob.name]);
    const queuing = queue.handlers.get(queueDisplayVersionsJob.name);
    const creating = queue.handlers.get(displayVersionJob.name);
    if (!queuing || !creating) throw new Error("The display version jobs have no handlers");
    expect(queue.enqueued.map((entry) => entry.name)).toEqual([queueDisplayVersionsJob.name]);
    await queuing(testJobContext(queueDisplayVersionsJob.name, {}));
    expect(queue.enqueued).toContainEqual({
      name: displayVersionJob.name,
      payload: { fileId: existingSource.fileId },
      key: existingSource.fileId,
    });

    queue.enqueued.length = 0;
    await upload(editor, page.id, "new.png", await photo(2500, 2500, "png"));
    await vi.waitFor(
      () => expect(queue.enqueued.map((entry) => entry.name)).toContain(queueDisplayVersionsJob.name),
      {
        timeout: 5000,
      },
    );

    await creating(testJobContext(displayVersionJob.name, { fileId: existingSource.fileId }));
    expect(await stateOf(existingSource.fileId)).toBe("done");
  });
});
