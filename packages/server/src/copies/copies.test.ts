import { Readable } from "node:stream";
import { emptyScene, yDocFromScene } from "@lunedo/editor-schema/scene";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { accountPrincipal, type Principal } from "../accounts/principal.js";
import { ForbiddenError } from "../authorization/service.js";
import type { PageMode } from "../spaces/schema.js";
import { StorageUsage } from "../storage/usage.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { testJobContext } from "../testing/jobs.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { drawingSceneOf, pageWithDrawing } from "../whiteboards/scene.testing.js";
import { COPY_IN_REQUEST_LIMIT, type CopyImpact, copyTitle } from "./copies.js";

const baseUrl = testDatabaseBaseUrl();

const paragraph = (...content: unknown[]) => ({ type: "paragraph", content });
const text = (value: string, marks?: unknown[]) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const doc = (...content: unknown[]) => ({ type: "doc", content });

describe("copyTitle", () => {
  it("prefixes the title in the language of the person copying and numbers further copies", () => {
    expect(copyTitle("en", "VPN access", 1)).toBe("Copy of VPN access");
    expect(copyTitle("en", "VPN access", 2)).toBe("Copy of VPN access (2)");
    expect(copyTitle("de", "VPN-Zugang", 1)).toBe("Kopie von VPN-Zugang");
  });

  it("stays within the title limit", () => {
    const title = copyTitle("en", "x".repeat(255), 12);
    expect(title).toHaveLength(255);
    expect(title.endsWith(" (12)")).toBe(true);
  });
});

describe.skipIf(!baseUrl)("copying content", () => {
  let test: TestServices;
  const { organization, member, space, account, join, group } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function setup() {
    const org = await organization();
    const editor = await member(org.id, "member", "Edda Editor");
    const reader = await member(org.id, "member", "Rita Reader");
    const wiki = await space(org.id, editor, {
      grants: [{ principalKind: "account", principalId: reader, role: "reader" }],
    });
    const other = await space(org.id, editor, {
      grants: [{ principalKind: "account", principalId: reader, role: "reader" }],
    });
    return { org, editor, reader, wiki, other, as: accountPrincipal(editor) };
  }

  async function page(
    actor: Principal,
    spaceId: string,
    title: string,
    parentId: string | null = null,
    mode: PageMode = "live",
  ) {
    return test.services.tree.create(actor, spaceId, { kind: "page", title, mode, placement: { parentId } });
  }

  async function children(parentId: string) {
    const result = await test.database.execute<{ id: string; title: string; kind: string }>(sql`
      select id, title, kind from tree_items where parent_id = ${parentId} order by position`);
    return result.rows;
  }

  async function itemsIn(spaceId: string) {
    const result = await test.database.execute<{ id: string; title: string }>(
      sql`select id, title from tree_items where space_id = ${spaceId} order by created_at`,
    );
    return result.rows;
  }

  async function snapshot(itemId: string) {
    const result = await test.database.execute<{ snapshot: { content: Record<string, unknown>[] } }>(
      sql`select snapshot from page_documents where item_id = ${itemId}`,
    );
    return result.rows[0]?.snapshot;
  }

  async function attachmentsOf(itemId: string) {
    const result = await test.database.execute<{
      id: string;
      name: string;
      number: number;
      file_id: string;
      published: boolean;
    }>(sql`
      select a.id, a.name, v.number, v.file_id, (a.published_version_id = v.id) as published
      from attachments a join attachment_versions v on v.attachment_id = a.id
      where a.item_id = ${itemId} order by a.name, v.number`);
    return result.rows;
  }

  async function grant(actor: Principal, spaceId: string, accountId: string, role: "reader" | "editor") {
    await test.services.spacePermissions.apply(actor, spaceId, {
      action: "grant",
      principalKind: "account",
      principalId: accountId,
      role,
    });
  }

  async function purgeSource(actor: Principal, ownerId: string, itemId: string, spaceId: string) {
    const entry = await test.services.trash.deleteItem(actor, itemId);
    await test.services.trash.empty(actor, spaceId);
    await test.services.trash.deleteImmediately(accountPrincipal(ownerId), entry.id, "Erasure request");
    await test.services.files.deleteOrphaned();
  }

  function upload(actor: Principal, itemId: string, name: string, content: string) {
    return test.services.attachments.upload(actor, itemId, {
      name,
      body: Readable.from([Buffer.from(content)]),
      contentLength: Buffer.byteLength(content),
    });
  }

  async function copyRoot(actor: Principal, itemId: string, spaceId: string, descendants = false) {
    const copy = await test.services.copies.copy(actor, itemId, { spaceId, parentId: null, descendants });
    if (!copy.item) throw new Error(`The copy is ${copy.state}`);
    return { copy, item: copy.item };
  }

  describe("a single page", () => {
    it("copies the published content, labels, options, properties and owner within the same space", async () => {
      const { org, editor, reader, wiki, as } = await setup();
      const source = await page(as, wiki.id, "Runbook");
      await test.services.tree.update(as, source.id, { width: "full", numberHeadings: true });
      await test.services.documents.replace(
        as,
        source.id,
        doc(
          paragraph(text("Restart the "), text("router")),
          {
            type: "pageProperties",
            attrs: { setId: null },
            content: [
              {
                type: "pageProperty",
                content: [
                  { type: "pagePropertyKey", content: [text("Owner")] },
                  { type: "pagePropertyValue", content: [paragraph(text("Network team"))] },
                ],
              },
            ],
          },
          {
            type: "taskList",
            content: [
              {
                type: "taskItem",
                attrs: { id: "01929b1e-0000-7000-8000-00000000aaaa", assignee: reader, dueDate: null },
                content: [paragraph(text("Check the logs"))],
              },
            ],
          },
        ),
      );
      await test.services.documents.addLabel(as, source.id, "network");
      const copier = await member(org.id, "member", "Cora Copier");
      await grant(as, wiki.id, copier, "editor");

      const { copy, item } = await copyRoot(accountPrincipal(copier), source.id, wiki.id);

      expect(copy).toMatchObject({ state: "done", copied: 1, hidden: 0, skipped: 0, errorCode: null });
      expect(item.title).toBe("Copy of Runbook");
      const details = await test.services.tree.get(accountPrincipal(copier), item.id);
      expect(details).toMatchObject({ kind: "page", width: "full", numberHeadings: true, mode: "live" });
      expect(details?.number).toBeGreaterThan(source.number);
      expect(details).toMatchObject({ ownerId: copier, creatorId: copier });
      expect(await test.services.documents.labels(item.id)).toEqual(["network"]);
      const content = await snapshot(item.id);
      expect(JSON.stringify(content)).toContain("Restart the ");
      const properties = await test.database.execute<{ key: string; text: string }>(
        sql`select key, text from page_properties where item_id = ${item.id}`,
      );
      expect(properties.rows).toEqual([{ key: "Owner", text: "Network team" }]);
      const tasks = await test.database.execute<{ id: string; assignee_id: string | null; item_id: string }>(
        sql`select id, assignee_id, item_id from tasks where item_id in (${source.id}, ${item.id}) order by item_id`,
      );
      expect(tasks.rows).toHaveLength(2);
      expect(new Set(tasks.rows.map((task) => task.id)).size).toBe(2);
      expect(tasks.rows.every((task) => task.assignee_id === reader)).toBe(true);
      expect(editor).not.toBe(copier);
    });

    it("starts the history with one version that notes the source and links it only for people who can read it", async () => {
      const { org, wiki, other, as } = await setup();
      const source = await page(as, wiki.id, "Policy", null, "publish");
      await test.services.documents.replace(as, source.id, doc(paragraph(text("Published text"))));
      await test.services.versions.publish(as, source.id);
      await test.services.documents.replace(as, source.id, doc(paragraph(text("Draft text"))));
      await test.services.versions.publish(as, source.id);
      await test.services.documents.replace(as, source.id, doc(paragraph(text("Unpublished draft"))));

      const { item } = await copyRoot(as, source.id, other.id);

      expect(item.title).toBe("Policy");
      const versions = await test.services.versions.list(item.id);
      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({
        number: 1,
        reason: "copied",
        copiedFrom: { itemId: source.id, title: "Policy" },
      });
      expect(JSON.stringify(await snapshot(item.id))).toContain("Draft text");
      expect(JSON.stringify(await snapshot(item.id))).not.toContain("Unpublished draft");
      const readable = await test.services.documents.readable(item.id);
      expect(JSON.stringify(readable?.document)).toContain("Draft text");

      const outsider = await member(org.id, "member", "Otto Outside");
      await grant(as, other.id, outsider, "reader");
      const shown = await test.services.copies.sources(accountPrincipal(outsider), versions);
      expect(shown[0]?.copiedFrom).toEqual({ itemId: null, title: null, path: null });
      const forEditor = await test.services.copies.sources(as, versions);
      expect(forEditor[0]?.copiedFrom).toEqual({
        itemId: source.id,
        title: "Policy",
        path: `/spaces/${wiki.key}/pages/${source.id}/policy`,
      });
      await purgeSource(as, org.owner, source.id, wiki.id);
      const afterPurge = await test.services.copies.sources(as, await test.services.versions.list(item.id));
      expect(afterPurge[0]?.copiedFrom).toEqual({ itemId: null, title: null, path: null });
    });

    it("numbers titles that already exist at the target and ignores titles the person cannot see", async () => {
      const { org, wiki, as } = await setup();
      const source = await page(as, wiki.id, "Notes");
      await page(as, wiki.id, "Copy of Notes");
      const hidden = await page(as, wiki.id, "Hidden");
      await test.services.pageAccess.change(as, hidden.id, [{ action: "restrict", kind: "view" }]);
      const secret = await page(as, wiki.id, "Copy of Notes (2)", hidden.id);

      const copier = await member(org.id, "member", "Cora Copier");
      await grant(as, wiki.id, copier, "editor");
      const { item } = await copyRoot(accountPrincipal(copier), source.id, wiki.id);
      expect(item.title).toBe("Copy of Notes (2)");
      expect(secret.id).not.toBe(item.id);
    });

    it("leaves comments, reactions, watchers and shares behind", async () => {
      const { org, wiki, other, as } = await setup();
      const source = await page(as, wiki.id, "Discussed");
      const thread = await test.services.comments.create(as, source.id, {
        body: doc(paragraph(text("Looks good"))),
      });
      const friend = await member(org.id, "member", "Fiona Friend");
      await test.services.pageAccess.change(as, source.id, [
        { action: "share", holderKind: "account", holderId: friend, role: "reader" },
      ]);

      const { item } = await copyRoot(as, source.id, other.id);

      const counts = await test.database.execute<{ comments: number; shares: number }>(sql`
        select (select count(*)::int from comments where item_id = ${item.id}) as comments,
          (select count(*)::int from page_shares where item_id = ${item.id}) as shares`);
      expect(counts.rows[0]).toEqual({ comments: 0, shares: 0 });
      expect(thread).toBeTruthy();
    });

    it("refuses a page that was never published and items that are not pages, folders or whiteboards", async () => {
      const { wiki, other, as } = await setup();
      const draft = await page(as, wiki.id, "Draft only", null, "publish");
      await expect(
        test.services.copies.copy(as, draft.id, { spaceId: other.id, parentId: null, descendants: false }),
      ).rejects.toMatchObject({ code: "neverPublished" });
      const link = await test.services.tree.create(as, wiki.id, {
        kind: "link",
        title: "Website",
        link: { url: "https://example.org" },
        placement: { parentId: null },
      });
      await expect(
        test.services.copies.copy(as, link.id, { spaceId: other.id, parentId: null, descendants: false }),
      ).rejects.toMatchObject({ code: "notCopyable" });
    });
  });

  describe("attachments and references", () => {
    it("copies the current attachments, points every block to the copies and leaves old versions behind", async () => {
      const { wiki, other, as } = await setup();
      const source = await page(as, wiki.id, "Floor plan");
      const first = await upload(as, source.id, "plan.txt", "first");
      await upload(as, source.id, "plan.txt", "second");
      const scene = await upload(as, source.id, "drawing.excalidraw", '{"v":1}');
      const sceneV2 = await upload(as, source.id, "drawing.excalidraw", '{"v":2}');
      const preview = await upload(as, source.id, "drawing.svg", "<svg/>");
      await test.services.documents.replace(
        as,
        source.id,
        doc(
          { type: "file", attrs: { attachmentId: first.id, name: "plan.txt" } },
          {
            type: "drawing",
            attrs: {
              id: "01929b1e-0000-7000-8000-00000000d001",
              sceneId: scene.id,
              sceneVersion: 1,
              previewId: preview.id,
              previewVersion: 1,
            },
          },
        ),
      );
      expect(sceneV2.id).toBe(scene.id);

      const { item } = await copyRoot(as, source.id, other.id);

      const copied = await attachmentsOf(item.id);
      const original = await attachmentsOf(source.id);
      expect(copied.map((row) => [row.name, row.number, row.published])).toEqual([
        ["drawing.excalidraw", 1, false],
        ["drawing.excalidraw", 2, true],
        ["drawing.svg", 1, true],
        ["plan.txt", 1, true],
      ]);
      const fileOf = (rows: typeof copied, name: string, number: number) =>
        rows.find((row) => row.name === name && row.number === number)?.file_id;
      expect(fileOf(copied, "plan.txt", 1)).toBe(fileOf(original, "plan.txt", 2));
      expect(fileOf(copied, "drawing.excalidraw", 1)).toBe(fileOf(original, "drawing.excalidraw", 1));
      const content = await snapshot(item.id);
      const [file, drawing] = content?.content ?? [];
      const ids = new Set(copied.map((row) => row.id));
      const fileAttrs = (file?.attrs ?? {}) as Record<string, unknown>;
      expect(ids.has(String(fileAttrs.attachmentId))).toBe(true);
      expect(drawing?.attrs).toMatchObject({ sceneVersion: 1, previewVersion: 1 });
      const drawingAttrs = drawing?.attrs as Record<string, string>;
      expect(ids.has(drawingAttrs.sceneId ?? "")).toBe(true);
      expect(ids.has(drawingAttrs.previewId ?? "")).toBe(true);
    });

    it("keeps a shared stored file while the copy uses it and counts it once in the storage total", async () => {
      const { org, wiki, other, as } = await setup();
      const usage = new StorageUsage({ database: test.database });
      const source = await page(as, wiki.id, "Contract");
      const content = "shared contract text";
      const empty = await usage.total();
      const uploaded = await upload(as, source.id, "contract.txt", content);
      const [original] = await attachmentsOf(source.id);
      const fileId = original?.file_id ?? "";
      const before = await usage.total();
      expect(before).toBeGreaterThan(empty);

      const { item } = await copyRoot(as, source.id, other.id);
      const [copied] = await attachmentsOf(item.id);
      expect(copied?.file_id).toBe(fileId);
      expect(await usage.total()).toBe(before);
      const objects = await test.database.execute<{ count: number }>(sql`
        select count(distinct v.file_id)::int as count from attachment_versions v
        join attachments a on a.id = v.attachment_id where a.item_id in (${source.id}, ${item.id})`);
      expect(objects.rows[0]?.count).toBe(1);

      const fileState = async () => {
        const result = await test.database.execute<{ state: string }>(
          sql`select state from stored_files where id = ${fileId}`,
        );
        return result.rows[0]?.state ?? null;
      };
      const purge = (itemId: string, spaceId: string) => purgeSource(as, org.owner, itemId, spaceId);

      await test.services.attachments.delete(as, uploaded.id);
      await purge(source.id, wiki.id);
      expect(await attachmentsOf(source.id)).toEqual([]);
      expect(await fileState()).toBe("ready");
      expect(await usage.total()).toBe(before);
      const read = await test.services.files.readAll(fileId, 1000);
      expect(read.toString()).toBe(content);

      await purge(item.id, other.id);
      expect(await fileState()).toBeNull();
      expect(await usage.total()).toBe(empty);
    });

    it("rewrites links between copied pages and keeps other links, includes and live references", async () => {
      const { wiki, other, as } = await setup();
      const root = await page(as, wiki.id, "Handbook");
      const child = await page(as, wiki.id, "Onboarding", root.id);
      const outside = await page(as, wiki.id, "Elsewhere");
      const board = await test.services.tree.create(as, wiki.id, {
        kind: "whiteboard",
        title: "Board",
        placement: { parentId: null },
      });
      await test.services.documents.replace(
        as,
        root.id,
        doc(
          paragraph(
            { type: "pageLink", attrs: { pageId: child.id, spaceId: wiki.id, title: null } },
            { type: "pageLink", attrs: { pageId: outside.id, spaceId: wiki.id, title: null } },
            text("child", [
              { type: "link", attrs: { href: `/spaces/${wiki.key}/pages/${child.id}/onboarding` } },
            ]),
          ),
          { type: "includePage", attrs: { pageId: child.id } },
          { type: "whiteboard", attrs: { whiteboardId: board.id } },
        ),
      );

      const { item } = await copyRoot(as, root.id, other.id, true);

      const [copiedChild] = await children(item.id);
      expect(copiedChild?.title).toBe("Onboarding");
      const content = await snapshot(item.id);
      const [links, include, whiteboard] = content?.content ?? [];
      const inline = (links?.content ?? []) as { attrs?: Record<string, unknown>; marks?: unknown[] }[];
      expect(inline[0]?.attrs).toEqual({ pageId: copiedChild?.id, spaceId: other.id, title: null });
      expect(inline[1]?.attrs).toEqual({ pageId: outside.id, spaceId: wiki.id, title: null });
      expect(inline[2]?.marks).toEqual([
        { type: "link", attrs: { href: `/spaces/${other.key}/pages/${copiedChild?.id}/onboarding` } },
      ]);
      expect(include?.attrs).toMatchObject({ pageId: child.id });
      expect(whiteboard?.attrs).toMatchObject({ whiteboardId: board.id });
      const backlinks = await test.database.execute<{ target_item_id: string }>(
        sql`select target_item_id from page_links where source_item_id = ${item.id} order by target_item_id`,
      );
      expect(backlinks.rows.map((row) => row.target_item_id).sort()).toEqual(
        [copiedChild?.id, outside.id].sort(),
      );
    });

    it("never rewrites the drawing scene of another page that a copied block points to", async () => {
      const { wiki, other, as } = await setup();
      const owner = await page(as, wiki.id, "Owner of the drawing");
      const image = await upload(as, owner.id, "router.png", "png");
      const blockId = "01929b1e-0000-7000-8000-00000000d0a2";
      await pageWithDrawing(test, as, owner.id, blockId, image.id);
      const before = await drawingSceneOf(test, owner.id);
      const files = async () =>
        (
          await test.database.execute<{ file_id: string }>(
            sql`select file_id from attachment_versions where attachment_id = ${before.sceneId} order by number`,
          )
        ).rows;
      const stored = await files();
      const borrower = await page(as, wiki.id, "Borrower");
      await test.services.documents.replace(as, borrower.id, {
        type: "doc",
        content: [{ type: "drawing", attrs: { id: blockId, sceneId: before.sceneId, sceneVersion: 1 } }],
      });

      await copyRoot(as, borrower.id, other.id);

      expect(await files()).toEqual(stored);
      expect((await drawingSceneOf(test, owner.id)).images).toEqual([image.id]);
    });

    it("copies the images inside a drawing, so the copy shows and saves them without the source", async () => {
      const { org, wiki, other, as } = await setup();
      const outsider = await member(org.id, "member", "Otto Outsider");
      await grant(as, other.id, outsider, "editor");
      const source = await page(as, wiki.id, "Floor plan");
      const image = await upload(as, source.id, "router.png", "png");
      const blockId = "01929b1e-0000-7000-8000-00000000d0a1";
      await pageWithDrawing(test, as, source.id, blockId, image.id);
      const request = { spaceId: other.id, parentId: null, descendants: false };
      const impact = await test.services.copies.preview(as, source.id, request);
      const done = await test.services.copies.copy(as, source.id, {
        ...request,
        confirmation: impact.confirmation ?? "",
      });
      const item = { id: done.item?.id ?? "" };

      const copied = await drawingSceneOf(test, item.id);
      const own = (await attachmentsOf(item.id)).map((row) => row.id);
      expect(copied.images).toHaveLength(1);
      expect(own).toContain(copied.images[0]);
      expect(copied.images).not.toContain(image.id);
      const outsiderAs = accountPrincipal(outsider);
      const sees = async (id: string) =>
        (await test.services.authorization.explain(outsiderAs, "attachment.view", { type: "attachment", id }))
          .allowed;
      expect(await sees(copied.images[0] ?? "")).toBe(true);
      expect(await sees(image.id)).toBe(false);
      await expect(
        test.services.drawings.saveScene(outsiderAs, item.id, {
          blockId,
          body: Readable.from([Buffer.from(copied.text)]),
        }),
      ).resolves.toMatchObject({ sceneVersion: 2 });
      expect((await drawingSceneOf(test, source.id)).images).toEqual([image.id]);
    });

    it("copies a whiteboard with its images and preview", async () => {
      const { wiki, other, as } = await setup();
      const board = await test.services.tree.create(as, wiki.id, {
        kind: "whiteboard",
        title: "Network map",
        placement: { parentId: null },
      });
      const image = await upload(as, board.id, "router.png", "png");
      const element = {
        id: "router-image",
        type: "image",
        x: 10,
        y: 20,
        width: 100,
        height: 50,
        angle: 0,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roundness: null,
        roughness: 1,
        opacity: 100,
        seed: 1234,
        version: 3,
        versionNonce: 99,
        index: "a0",
        isDeleted: false,
        groupIds: [],
        frameId: null,
        boundElements: null,
        updated: 1_700_000_000_000,
        link: `/spaces/${wiki.key}/whiteboards/${board.id}/network-map`,
        locked: false,
        fileId: "router",
        status: "saved",
        scale: [1, 1],
        crop: null,
      };
      const scene = {
        ...emptyScene(),
        elements: [element] as unknown as ReturnType<typeof emptyScene>["elements"],
        files: { router: { attachmentId: image.id, mimeType: "image/png" as const } },
      };
      await test.services.whiteboards.store(board.id, yDocFromScene(scene), { actorId: as.id });
      const stored = await test.services.whiteboards.scene(board.id);
      await test.services.whiteboards.setPreview(as, board.id, {
        revision: stored?.revision ?? 1,
        body: Readable.from([Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')]),
      });

      const { item } = await copyRoot(as, board.id, other.id);

      expect(item.kind).toBe("whiteboard");
      const copiedScene = await test.services.whiteboards.scene(item.id);
      const [copiedImage] = await attachmentsOf(item.id);
      expect(copiedImage?.name).toBe("router.png");
      expect(copiedScene?.scene.files.router?.attachmentId).toBe(copiedImage?.id);
      expect(copiedScene?.scene.elements[0]?.link).toBe(
        `/spaces/${other.key}/whiteboards/${item.id}/network-map`,
      );
      expect(copiedScene?.preview).toBe(true);
      const previews = await test.database.execute<{ file_id: string; item_id: string }>(
        sql`select file_id, item_id from whiteboard_previews where item_id in (${board.id}, ${item.id})`,
      );
      expect(new Set(previews.rows.map((row) => row.file_id)).size).toBe(1);
      expect(previews.rows).toHaveLength(2);
      const versions = await test.services.whiteboards.list(item.id);
      expect(versions).toMatchObject([
        { number: 1, reason: "copied", preview: true, copiedFrom: { itemId: board.id } },
      ]);
    });

    it("copies a folder with its content and maps page status by name in another space", async () => {
      const { wiki, other, as } = await setup();
      const folder = await test.services.tree.create(as, wiki.id, {
        kind: "folder",
        title: "Guides",
        description: "Everything about setup",
        placement: { parentId: null },
      });
      const guide = await page(as, wiki.id, "Laptop setup", folder.id);
      const statuses = await test.database.execute<{ id: string; space_id: string; built_in: string | null }>(
        sql`select id, space_id, built_in from page_status_values where space_id in (${wiki.id}, ${other.id})`,
      );
      const verified = statuses.rows.find((row) => row.space_id === wiki.id && row.built_in === "verified");
      await test.services.pageStatus.set(as, guide.id, verified?.id ?? null);

      const { item } = await copyRoot(as, folder.id, other.id, true);

      expect((await test.services.tree.get(as, item.id))?.description).toBe("Everything about setup");
      const [copiedGuide] = await children(item.id);
      const status = await test.database.execute<{ space_id: string; built_in: string | null }>(sql`
        select v.space_id, v.built_in from tree_items t join page_status_values v on v.id = t.status_id
        where t.id = ${copiedGuide?.id}`);
      expect(status.rows[0]).toEqual({ space_id: other.id, built_in: "verified" });
    });
  });

  describe("permissions", () => {
    it("leaves out descendants the person cannot read and counts them without titles", async () => {
      const { org, wiki, other, as } = await setup();
      const root = await page(as, wiki.id, "Team");
      await page(as, wiki.id, "Schedule", root.id);
      const salaries = await page(as, wiki.id, "Salaries", root.id);
      await page(as, wiki.id, "Bonus", salaries.id);
      await test.services.pageAccess.change(as, salaries.id, [{ action: "restrict", kind: "view" }]);
      const copier = await member(org.id, "member", "Cora Copier");
      await grant(as, wiki.id, copier, "reader");
      await grant(as, other.id, copier, "editor");

      const impact = await test.services.copies.preview(accountPrincipal(copier), root.id, {
        spaceId: other.id,
        parentId: null,
        descendants: true,
      });
      expect(impact).toMatchObject({ items: 2, hidden: 2, skipped: 0, background: false });
      const { copy, item } = await copyRoot(accountPrincipal(copier), root.id, other.id, true);

      expect(copy).toMatchObject({ copied: 2, hidden: 2 });
      expect((await children(item.id)).map((row) => row.title)).toEqual(["Schedule"]);
      expect(JSON.stringify(copy)).not.toContain("Salaries");
      expect(JSON.stringify(copy)).not.toContain("Bonus");
    });

    it("shows the copy and its titles to the person who copied only while they can read them", async () => {
      const { org, wiki, other, as } = await setup();
      const copier = await member(org.id, "member", "Cora Copier");
      await grant(as, wiki.id, copier, "reader");
      await grant(as, other.id, copier, "editor");
      const source = await page(as, wiki.id, "Payroll plan");
      const readerAs = accountPrincipal(copier);
      const { copy, item } = await copyRoot(readerAs, source.id, other.id);
      expect(await test.services.copies.get(readerAs, copy.id)).toMatchObject({
        title: "Payroll plan",
        sourceItemId: source.id,
        targetSpaceId: other.id,
        item: { id: item.id, title: "Payroll plan", spaceKey: other.key },
      });
      await test.services.pageAccess.change(as, item.id, [{ action: "restrict", kind: "view" }]);
      await test.services.pageAccess.change(as, source.id, [{ action: "restrict", kind: "view" }]);
      await test.services.tree.update(as, item.id, { title: "Payroll cuts 2027" });
      expect(await test.services.copies.get(readerAs, copy.id)).toMatchObject({
        state: "done",
        copied: 1,
        title: "",
        sourceItemId: null,
        targetSpaceId: other.id,
        item: null,
      });
      expect(JSON.stringify(await test.services.copies.get(readerAs, copy.id))).not.toContain("Payroll");
    });

    it("does not copy restrictions; the copies inherit the restrictions of their new place", async () => {
      const { reader, wiki, other, as } = await setup();
      const hr = await page(as, wiki.id, "HR");
      await test.services.pageAccess.change(as, hr.id, [{ action: "restrict", kind: "view" }]);
      const salaries = await page(as, wiki.id, "Salaries", hr.id);
      const locked = await page(as, other.id, "Locked");
      await test.services.pageAccess.change(as, locked.id, [{ action: "restrict", kind: "view" }]);

      const copy = await test.services.copies.copy(as, salaries.id, {
        spaceId: other.id,
        parentId: locked.id,
        descendants: false,
      });

      const restrictions = await test.database.execute<{ count: number }>(
        sql`select count(*)::int as count from page_restrictions where item_id = ${copy.item?.id}`,
      );
      expect(restrictions.rows[0]?.count).toBe(0);
      const readable = await test.services.authorization.explain(
        accountPrincipal(reader),
        "item.view",
        { type: "item", id: copy.item?.id ?? "" },
        { fresh: true },
      );
      expect(readable.allowed).toBe(false);
    });

    it("asks for confirmation when the copy becomes readable by people who cannot read the source", async () => {
      const { reader, wiki, other, as } = await setup();
      const hr = await page(as, wiki.id, "HR");
      await test.services.pageAccess.change(as, hr.id, [{ action: "restrict", kind: "view" }]);
      const request = { spaceId: other.id, parentId: null, descendants: false };

      const impact = await test.services.copies.preview(as, hr.id, request);
      expect(impact).toMatchObject({ widerAccess: true, gaining: 1, leavesConfidential: false });
      expect(impact.changes).toEqual([
        expect.objectContaining({ accountId: reader, before: null, after: "reader" }),
      ]);
      expect(impact.confirmation).toEqual(expect.any(String));

      const before = await itemsIn(other.id);
      let refused: unknown;
      try {
        await test.services.copies.copy(as, hr.id, request);
      } catch (error) {
        refused = error;
      }
      expect(refused).toMatchObject({ code: "copyChangesAccess" });
      expect((refused as { details: { copyImpact: CopyImpact } }).details.copyImpact.gaining).toBe(1);
      expect(await itemsIn(other.id)).toEqual(before);

      const copied = await test.services.copies.copy(as, hr.id, {
        ...request,
        confirmation: impact.confirmation ?? "",
      });
      expect(copied.state).toBe("done");
      const audit = await test.database.execute<{ fields: Record<string, unknown> }>(sql`
        select fields from audit_events where name = 'page.copied' and target_id = ${copied.item?.id}`);
      expect(audit.rows[0]?.fields).toMatchObject({
        itemId: hr.id,
        sourceSpaceId: wiki.id,
        spaceId: other.id,
        widerAccess: true,
        copied: 1,
      });
    });

    it("refuses a parent the person cannot read before saying anything about its access", async () => {
      const { org, wiki, other, as } = await setup();
      const source = await page(as, wiki.id, "Public notes");
      const secret = await page(as, other.id, "Secret");
      await test.services.pageAccess.change(as, secret.id, [{ action: "restrict", kind: "view" }]);
      const copier = await member(org.id, "member", "Cora Copier");
      await grant(as, wiki.id, copier, "reader");
      await grant(as, other.id, copier, "editor");
      const request = { spaceId: other.id, parentId: secret.id, descendants: false };
      await expect(
        test.services.copies.preview(accountPrincipal(copier), source.id, request),
      ).rejects.toMatchObject({
        code: "invalidPlacement",
      });
      await expect(
        test.services.copies.copy(accountPrincipal(copier), source.id, request),
      ).rejects.toMatchObject({
        code: "invalidPlacement",
      });
      const elsewhere = await page(as, wiki.id, "Elsewhere");
      await expect(
        test.services.copies.preview(as, source.id, {
          spaceId: other.id,
          parentId: elsewhere.id,
          descendants: false,
        }),
      ).rejects.toMatchObject({ code: "invalidPlacement" });
    });

    it("needs no confirmation when nobody gains access", async () => {
      const { wiki, as } = await setup();
      const source = await page(as, wiki.id, "Open");
      const impact = await test.services.copies.preview(as, source.id, {
        parentId: null,
        descendants: false,
      });
      expect(impact).toMatchObject({ widerAccess: false, confirmation: null, gaining: 0 });
      const copy = await test.services.copies.copy(as, source.id, { parentId: null, descendants: false });
      expect(copy.state).toBe("done");
    });

    it("lets readers, guests and people without access copy only where they can create content", async () => {
      const { org, reader, wiki, other, as } = await setup();
      const source = await page(as, wiki.id, "Shared");
      await expect(
        test.services.copies.copy(accountPrincipal(reader), source.id, {
          spaceId: other.id,
          parentId: null,
          descendants: false,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const guest = await account({ type: "guest", name: "Gus Guest" });
      await join(org.id, guest, "guest");
      await grant(as, wiki.id, guest, "reader");
      await expect(
        test.services.copies.copy(accountPrincipal(guest), source.id, {
          spaceId: other.id,
          parentId: null,
          descendants: false,
        }),
      ).rejects.toMatchObject({ code: "spaceNotFound" });
      const stranger = await member(org.id, "member", "Stan Stranger");
      await expect(
        test.services.copies.preview(accountPrincipal(stranger), source.id, {
          parentId: null,
          descendants: false,
        }),
      ).rejects.toMatchObject({ code: "itemNotFound" });
    });

    it("refuses targets in another organization", async () => {
      const { wiki, as, editor } = await setup();
      const source = await page(as, wiki.id, "Local");
      const foreign = await organization();
      await join(foreign.id, editor, "member");
      const elsewhere = await space(foreign.id, editor, {});
      await expect(
        test.services.copies.copy(as, source.id, {
          spaceId: elsewhere.id,
          parentId: null,
          descendants: false,
        }),
      ).rejects.toMatchObject({ code: "otherOrganization" });
    });
  });

  describe("confidential spaces", () => {
    async function confidential(orgId: string, creator: string) {
      return test.services.spaces.create(
        accountPrincipal(creator),
        orgId,
        {
          name: "Works council",
          key: `C${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
          confidential: true,
          visibility: "private",
          grants: [],
        },
        test.services.spacePermissions.holders,
      );
    }

    it("needs the editor role in a confidential space to copy out of it, like moving, and says it leaves", async () => {
      const { org, editor, other, as } = await setup();
      const council = await confidential(org.id, editor);
      const minutes = await page(as, council.id, "Minutes");
      const member2 = await member(org.id, "member", "Mia Member");
      await grant(as, council.id, member2, "reader");
      await grant(as, other.id, member2, "editor");
      await expect(
        test.services.copies.preview(accountPrincipal(member2), minutes.id, {
          spaceId: other.id,
          parentId: null,
          descendants: false,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const sameSpace = await test.services.copies.preview(as, minutes.id, {
        parentId: null,
        descendants: false,
      });
      expect(sameSpace.leavesConfidential).toBe(false);
      const out = await test.services.copies.preview(as, minutes.id, {
        spaceId: other.id,
        parentId: null,
        descendants: false,
      });
      expect(out).toMatchObject({ leavesConfidential: true, widerAccess: true });
    });

    it("copies into a confidential space without the shares that would block a move", async () => {
      const { org, editor, wiki, as } = await setup();
      const council = await confidential(org.id, editor);
      const team = await group(org.id, [editor]);
      const source = await page(as, wiki.id, "Shared with a group");
      await test.services.pageAccess.change(as, source.id, [
        { action: "share", holderKind: "group", holderId: team, role: "reader" },
      ]);
      await expect(
        test.services.tree.move(as, source.id, { spaceId: council.id, parentId: null }),
      ).rejects.toMatchObject({ code: "confidentialSharing" });
      const { item } = await copyRoot(as, source.id, council.id);
      const shares = await test.database.execute<{ count: number }>(
        sql`select count(*)::int as count from page_shares where item_id = ${item.id}`,
      );
      expect(shares.rows[0]?.count).toBe(0);
    });
  });

  describe("large copies", () => {
    async function bigTree(as: Principal, spaceId: string) {
      const root = await page(as, spaceId, "Archive");
      const pages = [];
      for (let index = 0; index < COPY_IN_REQUEST_LIMIT + 4; index += 1) {
        pages.push(await page(as, spaceId, `Entry ${String(index).padStart(2, "0")}`, root.id));
      }
      return { root, pages };
    }

    it("runs in the background, reads the source at one point and notifies at the end", async () => {
      const { wiki, other, as, editor } = await setup();
      const { root, pages } = await bigTree(as, wiki.id);
      const last = pages.at(-1);
      if (!last) throw new Error("No pages");
      await test.services.documents.replace(as, last.id, doc(paragraph(text("Before"))));

      const queued = await test.services.copies.copy(as, root.id, {
        spaceId: other.id,
        parentId: null,
        descendants: true,
      });
      expect(queued).toMatchObject({ state: "queued", item: null });
      expect(queued.progress.total).toBe(pages.length + 1);

      const job = testJobContext("copies.run", { copyId: queued.id });
      let edited = false;
      job.reportProgress = async () => {
        if (edited) return;
        edited = true;
        await test.services.documents.replace(as, last.id, doc(paragraph(text("After"))));
        await page(as, wiki.id, "Late child", root.id);
      };
      await test.services.copies.work(job);

      const done = await test.services.copies.get(as, queued.id);
      expect(done).toMatchObject({ state: "done", copied: pages.length + 1 });
      const copiedChildren = await children(done?.item?.id ?? "");
      expect(copiedChildren.map((row) => row.title)).not.toContain("Late child");
      expect(copiedChildren).toHaveLength(pages.length);
      const lastCopy = copiedChildren.find((row) => row.title === last.title);
      expect(JSON.stringify(await snapshot(lastCopy?.id ?? ""))).toContain("Before");
      const notifications = await test.database.execute<{ type: string }>(sql`
        select type from notifications where recipient_id = ${editor} and target_id = ${done?.item?.id}`);
      expect(notifications.rows.map((row) => row.type)).toEqual(["copy.finished"]);
    });

    it("lets people create pages in the target space while the copy runs", async () => {
      const { wiki, other, as } = await setup();
      const { root, pages } = await bigTree(as, wiki.id);
      const queued = await test.services.copies.copy(as, root.id, {
        spaceId: other.id,
        parentId: null,
        descendants: true,
      });
      const job = testJobContext("copies.run", { copyId: queued.id });
      let created: { id: string } | null = null;
      job.reportProgress = async () => {
        if (!created) created = await page(as, other.id, "Written meanwhile");
      };
      await test.services.copies.work(job);
      expect(created).not.toBeNull();
      const done = await test.services.copies.get(as, queued.id);
      expect(done).toMatchObject({ state: "done", copied: pages.length + 1 });
      const top = await test.database.execute<{ title: string }>(sql`
        select title from tree_items where space_id = ${other.id} and parent_id is null order by position`);
      expect(top.rows.map((row) => row.title).slice(-2)).toEqual(["Archive", "Written meanwhile"]);
    });

    it("gives way to a deletion of its place and fails on the retry without leaving anything", async () => {
      const { wiki, other, as } = await setup();
      const { root } = await bigTree(as, wiki.id);
      const place = await page(as, other.id, "Place");
      const queued = await test.services.copies.copy(as, root.id, {
        spaceId: other.id,
        parentId: place.id,
        descendants: true,
      });
      const first = testJobContext("copies.run", { copyId: queued.id });
      let deletion: Promise<unknown> | null = null;
      first.reportProgress = async () => {
        deletion ??= test.services.trash.deleteItem(as, place.id);
      };
      await expect(test.services.copies.work(first)).rejects.toThrow();
      await deletion;
      await test.services.copies.work(testJobContext("copies.run", { copyId: queued.id }, 1));
      expect(await test.services.copies.get(as, queued.id)).toMatchObject({
        state: "failed",
        errorCode: "invalidPlacement",
      });
      expect(await children(place.id)).toEqual([]);
    });

    it("starts again when a parent of its place moves while it runs, so the copy inherits the new place", async () => {
      const { wiki, other, as } = await setup();
      const { root } = await bigTree(as, wiki.id);
      const section = await page(as, other.id, "Section");
      const place = await page(as, other.id, "Place", section.id);
      const locked = await page(as, other.id, "Locked");
      await test.services.pageAccess.change(as, locked.id, [{ action: "restrict", kind: "view" }]);
      const queued = await test.services.copies.copy(as, root.id, {
        spaceId: other.id,
        parentId: place.id,
        descendants: true,
      });
      const first = testJobContext("copies.run", { copyId: queued.id });
      const preview = await test.services.tree.moveImpact(as, section.id, { parentId: locked.id });
      let move: Promise<unknown> | null = null;
      first.reportProgress = async () => {
        move ??= test.services.tree.move(as, section.id, {
          parentId: locked.id,
          confirmation: preview.confirmation ?? "",
        });
      };
      await expect(test.services.copies.work(first)).rejects.toThrow();
      await move;
      await test.services.copies.work(testJobContext("copies.run", { copyId: queued.id }, 1));
      const done = await test.services.copies.get(as, queued.id);
      expect(done?.state).toBe("done");
      const stale = await test.database.execute<{ count: number }>(sql`
        select count(*)::int as count from tree_items
        where ${done?.item?.id ?? ""}::uuid = any(path) and not (${locked.id}::uuid = any(path))`);
      expect(stale.rows[0]?.count).toBe(0);
    });

    it("checks the confirmed access again before it finishes", async () => {
      const { wiki, other, as } = await setup();
      const { root } = await bigTree(as, wiki.id);
      await test.services.pageAccess.change(as, root.id, [{ action: "restrict", kind: "view" }]);
      const place = await page(as, other.id, "Board only");
      await test.services.pageAccess.change(as, place.id, [{ action: "restrict", kind: "view" }]);
      const queued = await test.services.copies.copy(as, root.id, {
        spaceId: other.id,
        parentId: place.id,
        descendants: true,
      });
      const first = testJobContext("copies.run", { copyId: queued.id });
      let opened: Promise<unknown> | null = null;
      first.reportProgress = async () => {
        opened ??= test.services.pageAccess.change(as, place.id, [{ action: "unrestrict", kind: "view" }]);
      };
      await expect(test.services.copies.work(first)).rejects.toThrow();
      await opened;
      expect(await children(place.id)).toEqual([]);
      await test.services.copies.work(testJobContext("copies.run", { copyId: queued.id }, 1));
      expect(await test.services.copies.get(as, queued.id)).toMatchObject({
        state: "failed",
        errorCode: "copyChangesAccess",
      });
    });

    it("leaves nothing behind when the job fails and tells the person", async () => {
      const { wiki, other, as, editor } = await setup();
      const { root } = await bigTree(as, wiki.id);
      const before = await itemsIn(other.id);
      const queued = await test.services.copies.copy(as, root.id, {
        spaceId: other.id,
        parentId: null,
        descendants: true,
      });
      let calls = 0;
      const created = test.services.activity.created.bind(test.services.activity);
      vi.spyOn(test.services.activity, "created").mockImplementation(async (tx, itemId, actorId) => {
        calls += 1;
        if (calls === 15) throw new Error("Disk failure");
        return created(tx, itemId, actorId);
      });

      await test.services.copies.work(testJobContext("copies.run", { copyId: queued.id }));

      expect(await itemsIn(other.id)).toEqual(before);
      expect(await test.services.copies.get(as, queued.id)).toMatchObject({
        state: "failed",
        errorCode: "copyFailed",
      });
      const notifications = await test.database.execute<{ type: string }>(sql`
        select type from notifications where recipient_id = ${editor} and target_id = ${queued.id}`);
      expect(notifications.rows.map((row) => row.type)).toEqual(["copy.failed"]);
    });

    it("fails the job when access changed after the confirmation", async () => {
      const { reader, wiki, other, as } = await setup();
      const { root } = await bigTree(as, wiki.id);
      const queued = await test.services.copies.copy(as, root.id, {
        spaceId: other.id,
        parentId: null,
        descendants: true,
      });
      await test.services.pageAccess.change(as, root.id, [{ action: "restrict", kind: "view" }]);
      await test.services.copies.work(testJobContext("copies.run", { copyId: queued.id }));
      expect(await test.services.copies.get(as, queued.id)).toMatchObject({
        state: "failed",
        errorCode: "copyChangesAccess",
      });
      expect(reader).toBeTruthy();
    });

    it("is refused with the usual message when storage is critically full", async () => {
      const { wiki, other, as } = await setup();
      const source = await page(as, wiki.id, "With file");
      await upload(as, source.id, "notes.txt", "content");
      vi.spyOn(test.services.files.store, "capacity").mockResolvedValue({ free: 1, total: 1000 });
      await expect(
        test.services.copies.copy(as, source.id, { spaceId: other.id, parentId: null, descendants: false }),
      ).rejects.toMatchObject({ refusal: "upload" });
      vi.restoreAllMocks();
      const plain = await page(as, wiki.id, "Without file");
      vi.spyOn(test.services.files.store, "capacity").mockResolvedValue({ free: 1, total: 1000 });
      await expect(
        test.services.copies.copy(as, plain.id, { spaceId: other.id, parentId: null, descendants: false }),
      ).resolves.toMatchObject({ state: "done" });
    });

    it("marks copies whose job was lost as failed", async () => {
      const { wiki, other, as } = await setup();
      const { root } = await bigTree(as, wiki.id);
      const queued = await test.services.copies.copy(as, root.id, {
        spaceId: other.id,
        parentId: null,
        descendants: true,
      });
      await test.database.execute(
        sql`update item_copies set updated_at = now() - interval '6 hours' where id = ${queued.id}`,
      );
      await test.services.copies.watchdog();
      expect(await test.services.copies.get(as, queued.id)).toMatchObject({
        state: "failed",
        errorCode: "copyInterrupted",
      });
    });

    it("does not count maintenance mode as time a copy waited", async () => {
      const { wiki, other, as } = await setup();
      const { root } = await bigTree(as, wiki.id);
      const queued = await test.services.copies.copy(as, root.id, {
        spaceId: other.id,
        parentId: null,
        descendants: true,
      });
      await test.database.execute(
        sql`update item_copies set updated_at = now() - interval '6 hours' where id = ${queued.id}`,
      );
      try {
        await test.database.execute(sql`
          insert into maintenance_state (singleton, enabled, started_at) values (true, true, now() - interval '5 hours')
          on conflict (singleton) do update set enabled = true, started_at = now() - interval '5 hours'`);
        await test.services.copies.watchdog();
        expect(await test.services.copies.get(as, queued.id)).toMatchObject({ state: "queued" });
        await test.database.execute(sql`
          update maintenance_state set enabled = false, started_at = null,
            last_started_at = now() - interval '5 hours', last_ended_at = now() - interval '30 minutes'`);
        await test.services.copies.watchdog();
        expect(await test.services.copies.get(as, queued.id)).toMatchObject({ state: "queued" });
      } finally {
        await test.database.execute(sql`
          update maintenance_state set enabled = false, started_at = null, last_started_at = null,
            last_ended_at = null`);
      }
    });
  });
});
