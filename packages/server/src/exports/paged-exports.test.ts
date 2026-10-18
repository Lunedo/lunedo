import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { crc32 } from "node:zlib";
import mammoth from "mammoth";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { accountPrincipal, type Principal } from "../accounts/principal.js";
import { Secret } from "../config/secret.js";
import { createLogger } from "../logging/logger.js";
import { exportEnabledSetting } from "../spaces/settings.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { testJobContext } from "../testing/jobs.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import {
  ExportBusyError,
  ExportError,
  type ExportRequest,
  MAX_PAGE_EXPORT_IMAGE_BYTES,
  pageExportSlots,
} from "./exports.js";
import {
  bytesOf,
  doc,
  type ExportContext,
  exportFixtures,
  paragraph,
  text,
  unzip,
} from "./fixtures.testing.js";
import { defaultExportOptions, MAX_BROWSER_PRINT_PAGES } from "./options.js";
import { PagedExport } from "./paged.js";
import type { PreparedPage } from "./renderer.js";

const baseUrl = testDatabaseBaseUrl();
const INSTANCE = "https://wiki.example.org";
const TOKEN = "t".repeat(40);
const BOARD_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><rect width="12" height="8"/></svg>';
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEElEQVR4nGP4z8DwnwEIAA/2Av7f8DbHAAAAAElFTkSuQmCC",
  "base64",
);

interface RenderCall {
  authorization: string | null;
  html: string;
  baseUrl: string | null;
  assets: { path: string; contentType: string; data: string }[];
}

function fakeRender(calls: RenderCall[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    if (url.endsWith("/v1/info")) {
      return Response.json({
        version: "1.0.0",
        browser: "Chromium 140",
        concurrency: 2,
        running: 0,
        waiting: 0,
        maxBytes: 50 * 1024 * 1024,
        timeoutSeconds: 60,
      });
    }
    const body = JSON.parse(await new Response(init?.body).text()) as Omit<RenderCall, "authorization">;
    calls.push({ authorization: headers.get("authorization"), ...body });
    return new Response(Buffer.from("%PDF-1.7 rendered"), { headers: { "content-type": "application/pdf" } });
  }) as typeof fetch;
}

async function html(data: Buffer): Promise<string> {
  return (await mammoth.convertToHtml({ buffer: data })).value;
}

describe.skipIf(!baseUrl)("print, PDF and Word exports", () => {
  let test: TestServices;
  let rendered: TestServices;
  const calls: RenderCall[] = [];
  const { setup } = exportFixtures(() => test);
  const { member, space } = spaceFixtures(() => test);
  let context: ExportContext;
  let image: string;
  let hiddenImage: string;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "", {
      configuredInstanceUrl: INSTANCE,
      render: { url: "http://render.test:3000", token: new Secret(TOKEN) },
      renderFetch: fakeRender(calls),
    });
    rendered = test;
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
    context = await setup();
    const { admin, pages } = context;
    const rack = await test.services.attachments.upload(admin, pages.welcome.id, {
      name: "rack.png",
      body: Readable.from([PNG]),
      contentLength: PNG.length,
    });
    const secret = await test.services.attachments.upload(admin, pages.salaries.id, {
      name: "salary-chart.png",
      body: Readable.from([PNG]),
      contentLength: PNG.length,
    });
    image = rack.id;
    hiddenImage = secret.id;
    const current = await test.services.documents.readable(pages.welcome.id);
    await test.services.documents.replace(
      admin,
      pages.welcome.id,
      doc(
        { type: "heading", attrs: { level: 1 }, content: [text("Overview")] },
        ...(current?.document.content ?? []),
        { type: "image", attrs: { attachmentId: rack.id, alt: "Rack" } },
        { type: "image", attrs: { attachmentId: secret.id, alt: "Leaked chart" } },
      ),
    );
    await test.services.comments.create(context.reader, pages.welcome.id, {
      body: doc(paragraph(text("Please add the VLAN plan"))),
    });
  });

  afterAll(async () => {
    await test?.close();
  });

  async function job(
    actor: Principal,
    target: { spaceId: string } | { pageId: string },
    request: ExportRequest,
  ) {
    const started = await test.services.exports.start(actor, target, request);
    await test.services.exports.work(testJobContext("exports.build", { exportId: started.id }));
    const ready = await test.services.exports.get(actor, started.id);
    expect(ready.state).toBe("ready");
    expect(ready.format).toBe(request.format);
    return test.services.exports.download(actor, started.id);
  }

  describe("print-ready HTML of a page", () => {
    it("shows the title block, contents and published content with the reader's permissions", async () => {
      const file = await test.services.exports.page(context.reader, context.pages.welcome.id, "print");
      expect(file.contentType).toBe("text/html; charset=utf-8");
      expect(file.fileName).toBe("Welcome.html");
      const printed = (await bytesOf(file)).toString("utf8");
      expect(printed).toContain('<p class="ph-path">Handbook</p><h1 class="ph-page-title">Welcome</h1>');
      expect(printed).toMatch(/<p class="ph-meta">Space admin · Last changed on [^<]+<\/p>/);
      expect(printed).toContain('<span class="ph-entry">Overview</span>');
      expect(printed).toContain("Network: setup/guide");
      expect(printed).toContain('data-access="none">No access</span>');
      expect(printed).not.toContain("Salaries");
      expect(printed).not.toContain("Secret task");
      expect(printed).not.toContain("Never published");
      expect(printed).toContain(`src="/api/v1/attachments/${image}/content?size=display"`);
      expect(printed).not.toContain('loading="lazy"');
      expect(printed).toContain("@page{size:A4 portrait;");
      expect(printed).toContain('@bottom-left{content:"Exported on ');
      expect(printed).toContain(' by Rita Reader"');
    });

    it("uses the paper size and orientation and adds comments and attachments when asked", async () => {
      const options = {
        ...defaultExportOptions,
        paper: "letter" as const,
        orientation: "landscape" as const,
      };
      const plain = (
        await bytesOf(
          await test.services.exports.page(context.reader, context.pages.welcome.id, "print", options),
        )
      ).toString("utf8");
      expect(plain).toContain("@page{size:letter landscape;");
      expect(plain).not.toContain("Please add the VLAN plan");
      expect(plain).toContain("<td>notes.txt</td><td>Welcome</td>");
      const commented = (
        await bytesOf(
          await test.services.exports.page(context.reader, context.pages.welcome.id, "print", {
            ...options,
            comments: true,
            attachments: false,
          }),
        )
      ).toString("utf8");
      expect(commented).toContain("Please add the VLAN plan");
      expect(commented).toContain('<p class="ph-comment-meta">Rita Reader · ');
      expect(commented).not.toContain('<section class="ph-appendix"');
    });

    it("names the space and the ancestors in the path", async () => {
      const printed = (
        await bytesOf(await test.services.exports.page(context.insider, context.pages.bonus.id, "print"))
      ).toString("utf8");
      expect(printed).toContain(
        '<p class="ph-path">Handbook › Salaries 2027</p><h1 class="ph-page-title">Bonus plan</h1>',
      );
    });

    it("refuses a page the person cannot read", async () => {
      await expect(
        test.services.exports.page(context.reader, context.pages.salaries.id, "print"),
      ).rejects.toThrow();
      await expect(
        test.services.exports.page(context.reader, context.pages.salaries.id, "docx"),
      ).rejects.toThrow();
    });
  });

  describe("subtrees and spaces", () => {
    it("leaves out a page restricted in the middle of a subtree with everything below it", async () => {
      const { admin, space, steward } = context;
      const create = (title: string, parentId: string | null) =>
        test.services.tree.create(admin, space.id, {
          kind: "page",
          title,
          mode: "live",
          placement: { parentId },
        });
      const guide = await create("Guide", null);
      const chapter = await create("Public chapter", guide.id);
      const hidden = await create("Hidden chapter", guide.id);
      const below = await create("Below hidden", hidden.id);
      for (const [page, words] of [
        [guide, "Guide text"],
        [chapter, "Chapter text"],
        [hidden, "Hidden text"],
        [below, "Below text"],
      ] as const) {
        await test.services.documents.replace(admin, page.id, doc(paragraph(text(words))));
      }
      const insiderId = await member(context.org.id, "member", "Hanna Hidden");
      await test.services.pageAccess.change(admin, hidden.id, [
        { action: "share", holderKind: "account", holderId: insiderId, role: "editor" },
        { action: "restrict", kind: "view" },
      ]);
      const file = await job(
        steward,
        { pageId: guide.id },
        { format: "print", options: defaultExportOptions },
      );
      expect(file.contentType).toBe("text/html; charset=utf-8");
      expect(file.fileName).toMatch(/^Guide \d{4}-\d{2}-\d{2}\.html$/);
      const printed = (await bytesOf(file)).toString("utf8");
      expect(printed).toContain("Guide text");
      expect(printed).toContain("Chapter text");
      expect(printed).not.toContain("Hidden");
      expect(printed).not.toContain("Below");
      expect(printed.match(/<article class="ph-print-page"/g)).toHaveLength(2);
      expect(printed).toContain('<li data-level="1"><a href="#ph-page-');
      const word = await html(
        await bytesOf(
          await job(steward, { pageId: guide.id }, { format: "docx", options: defaultExportOptions }),
        ),
      );
      expect(word).toContain("Chapter text");
      expect(word).not.toContain("Hidden");
      expect(word).not.toContain("Below");
    });

    it("prints a space with its pages and without restricted pages or drafts", async () => {
      const file = await job(
        context.steward,
        { spaceId: context.space.id },
        { format: "print", options: defaultExportOptions },
      );
      const printed = (await bytesOf(file)).toString("utf8");
      expect(printed).toContain('<h1 class="ph-document-title">Handbook</h1>');
      expect(printed).toContain("Published text");
      expect(printed).not.toContain("Draft secret");
      expect(printed).not.toContain("Salaries");
      expect(printed).not.toContain("Confidential numbers");
      expect(printed).not.toContain("Never published");
    });

    it("refuses multi-page exports to readers", async () => {
      await expect(
        test.services.exports.start(
          context.reader,
          { spaceId: context.space.id },
          {
            format: "docx",
            options: defaultExportOptions,
          },
        ),
      ).rejects.toThrow();
      await expect(
        test.services.exports.start(
          context.reader,
          { pageId: context.pages.welcome.id },
          {
            format: "print",
            options: defaultExportOptions,
          },
        ),
      ).rejects.toThrow();
    });

    it("counts the pages of a scope and refuses to prepare a print view above the browser limit", async () => {
      const counts = await test.services.exports.counts(context.steward, { spaceId: context.space.id });
      expect(counts).toMatchObject({ printLimit: MAX_BROWSER_PRINT_PAGES, serverPdf: true });
      expect(counts.pages).toBeGreaterThan(0);
      const { admin, org } = context;
      const big = await space(org.id, context.adminId, { name: "Big" });
      for (let index = 0; index <= MAX_BROWSER_PRINT_PAGES; index += 1) {
        await test.services.tree.create(admin, big.id, {
          kind: "page",
          title: `Page ${index}`,
          mode: "live",
          placement: { parentId: null },
        });
      }
      await expect(
        test.services.exports.start(
          admin,
          { spaceId: big.id },
          { format: "print", options: defaultExportOptions },
        ),
      ).rejects.toMatchObject({ code: "tooManyPagesToPrint" });
      const word = await test.services.exports.start(
        admin,
        { spaceId: big.id },
        {
          format: "docx",
          options: defaultExportOptions,
        },
      );
      expect(word.state).toBe("queued");
      await test.services.exports.remove(admin, word.id);
    }, 120_000);
  });

  describe("Word", () => {
    it("writes the page with its structure and embeds only images the exporter may read", async () => {
      const file = await test.services.exports.page(context.reader, context.pages.welcome.id, "docx");
      expect(file.fileName).toBe("Welcome.docx");
      expect(file.contentType).toBe(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      const output = await html(await bytesOf(file));
      expect(output).toMatch(/<h1><a id="_Toc\d+"><\/a>Overview<\/h1>/);
      expect(output).toContain("@Rita Reader");
      expect(output).toContain('<img alt="Rack" src="data:image/png;base64,');
      expect(output).not.toContain('alt="Leaked chart" src=');
      expect(output).toContain("Leaked chart");
      expect(output).not.toContain("Salaries");
    });
  });

  describe("content of other pages", () => {
    it("embeds diagrams and images of other pages only when the exporter may export those pages", async () => {
      const own = await setup();
      const upload = (name: string) =>
        test.services.attachments.upload(own.admin, own.pages.remote.id, {
          name,
          body: Readable.from([PNG]),
          contentLength: PNG.length,
        });
      const chart = await upload("chart.png");
      const preview = await upload("topology.png");
      const diagramId = "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5d01";
      await test.services.documents.replace(
        own.admin,
        own.pages.remote.id,
        doc({
          type: "drawio",
          attrs: {
            id: diagramId,
            sourceFormat: "drawio",
            sourceId: null,
            sourceVersion: null,
            previewId: preview.id,
            previewVersion: preview.version,
            text: "",
          },
        }),
      );
      const borrowing = await test.services.tree.create(own.admin, own.space.id, {
        kind: "page",
        title: "Borrowing",
        mode: "live",
        placement: { parentId: null },
      });
      await test.services.documents.replace(
        own.admin,
        borrowing.id,
        doc(
          { type: "image", attrs: { attachmentId: chart.id, alt: "Borrowed chart" } },
          {
            type: "drawioReference",
            attrs: { id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5d02", pageId: own.pages.remote.id, diagramId },
          },
        ),
      );
      const images = async () => {
        const file = await test.services.exports.page(own.reader, borrowing.id, "docx");
        return ((await html(await bytesOf(file))).match(/<img /g) ?? []).length;
      };
      expect(await images()).toBe(2);
      await test.settings.set(exportEnabledSetting, { space: own.other.id }, "space", false);
      expect(await images()).toBe(0);
    });
  });

  describe("single-page Word and PDF files", () => {
    it("refuses more parallel files than a node and an account may build", async () => {
      const releases: (() => void)[] = [];
      const hold = (id: string) =>
        pageExportSlots.run(
          accountPrincipal(id),
          () => new Promise<void>((resolve) => releases.push(resolve)),
        );
      const own = hold(context.readerId);
      await expect(
        test.services.exports.page(context.reader, context.pages.welcome.id, "docx"),
      ).rejects.toBeInstanceOf(ExportBusyError);
      const other = hold(context.stewardId);
      await expect(
        test.services.exports.page(context.admin, context.pages.welcome.id, "docx"),
      ).rejects.toBeInstanceOf(ExportBusyError);
      for (const release of releases) release();
      await Promise.all([own, other]);
      const file = await test.services.exports.page(context.reader, context.pages.welcome.id, "docx");
      expect(file.fileName).toBe("Welcome.docx");
    });

    it("embeds the display version of a large photo in Word and PDF files", async () => {
      const { admin, space: handbook } = context;
      const page = await test.services.tree.create(admin, handbook.id, {
        kind: "page",
        title: "Site survey",
        mode: "live",
        placement: { parentId: null },
      });
      const photo = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#336699" } })
        .jpeg()
        .toBuffer();
      const uploaded = await test.services.attachments.upload(admin, page.id, {
        name: "survey.jpg",
        body: Readable.from([photo]),
        contentLength: photo.length,
      });
      await test.services.documents.replace(
        admin,
        page.id,
        doc({ type: "image", attrs: { attachmentId: uploaded.id, alt: "Survey" } }),
      );
      const original = await test.services.attachments.content(uploaded.id, "published");
      await test.services.displayVersions.create(original?.fileId ?? "", { lastAttempt: false });
      const display = await test.services.displayVersions.apply(
        original as NonNullable<typeof original>,
        "display",
      );
      expect(display?.displaySize).toBe("display");

      const word = await html(await bytesOf(await test.services.exports.page(admin, page.id, "docx")));
      const embedded = /<img alt="Survey" src="data:image\/jpeg;base64,([^"]+)"/.exec(word)?.[1];
      const embeddedSize = await sharp(Buffer.from(embedded ?? "", "base64")).metadata();
      expect({ width: embeddedSize.width, height: embeddedSize.height }).toEqual({
        width: 2048,
        height: 1365,
      });

      calls.length = 0;
      await rendered.services.exports.page(admin, page.id, "pdf");
      const assets = calls[0]?.assets ?? [];
      expect(assets.map(({ path, contentType }) => ({ path, contentType }))).toEqual([
        { path: `/api/v1/attachments/${uploaded.id}/content`, contentType: "image/jpeg" },
      ]);
      const sent = await sharp(Buffer.from(assets[0]?.data ?? "", "base64")).metadata();
      expect({ format: sent.format, width: sent.width, height: sent.height }).toEqual({
        format: "jpeg",
        width: 2048,
        height: 1365,
      });
    });

    it("shows images above the pixel limit as a note and never sends them to the renderer", async () => {
      const { admin, space: handbook } = context;
      const page = await test.services.tree.create(admin, handbook.id, {
        kind: "page",
        title: "Scans",
        mode: "live",
        placement: { parentId: null },
      });
      const small = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#000000" } })
        .png()
        .toBuffer();
      const huge = Buffer.from(small);
      huge.writeUInt32BE(20_000, 16);
      huge.writeUInt32BE(20_000, 20);
      huge.writeUInt32BE(crc32(huge.subarray(12, 29)) >>> 0, 29);
      const uploaded = await test.services.attachments.upload(admin, page.id, {
        name: "scan.png",
        body: Readable.from([huge]),
        contentLength: huge.length,
      });
      await test.services.documents.replace(
        admin,
        page.id,
        doc({ type: "image", attrs: { attachmentId: uploaded.id, alt: "Scan" } }),
      );
      calls.length = 0;
      await rendered.services.exports.page(admin, page.id, "pdf");
      const sent = calls.at(-1);
      expect(sent?.assets).toEqual([]);
      expect(sent?.html).not.toContain(`/api/v1/attachments/${uploaded.id}/content`);
      expect(sent?.html).toContain("This image is too large to show here.");
      const word = await html(await bytesOf(await test.services.exports.page(admin, page.id, "docx")));
      expect(word).not.toContain("<img");
    });

    it("reads an image that a Word file shows several times only once", async () => {
      const { admin, space: handbook } = context;
      const repeated = await test.services.tree.create(admin, handbook.id, {
        kind: "page",
        title: "Repeated image",
        mode: "live",
        placement: { parentId: null },
      });
      const uploaded = await test.services.attachments.upload(admin, repeated.id, {
        name: "logo.png",
        body: Readable.from([PNG]),
        contentLength: PNG.length,
      });
      await test.services.documents.replace(
        admin,
        repeated.id,
        doc(
          ...Array.from({ length: 5 }, () => ({
            type: "image",
            attrs: { attachmentId: uploaded.id, alt: "Logo" },
          })),
        ),
      );
      const read = vi.spyOn(test.services.files, "read");
      try {
        const file = await test.services.exports.page(admin, repeated.id, "docx");
        expect(((await html(await bytesOf(file))).match(/<img /g) ?? []).length).toBe(5);
        expect(read).toHaveBeenCalledTimes(1);
      } finally {
        read.mockRestore();
      }
    });

    it("shows a placeholder with a hint for images above the budget of files built while the request waits", async () => {
      const { admin, space: handbook } = context;
      const large = await test.services.tree.create(admin, handbook.id, {
        kind: "page",
        title: "Large images",
        mode: "live",
        placement: { parentId: null },
      });
      const half = Math.ceil(MAX_PAGE_EXPORT_IMAGE_BYTES / 2) + 1024;
      const ids: string[] = [];
      for (const name of ["one.png", "two.png"]) {
        const data = Buffer.concat([PNG, Buffer.alloc(half - PNG.length)]);
        const uploaded = await test.services.attachments.upload(admin, large.id, {
          name,
          body: Readable.from([data]),
          contentLength: data.length,
        });
        ids.push(uploaded.id);
      }
      await test.services.documents.replace(
        admin,
        large.id,
        doc(...ids.map((id) => ({ type: "image", attrs: { attachmentId: id, alt: id } }))),
      );
      const file = await test.services.exports.page(admin, large.id, "docx");
      const output = await html(await bytesOf(file));
      expect((output.match(/<img /g) ?? []).length).toBe(1);
      expect(output).toContain(`${ids[1]}: Image left out because the file would otherwise be too large.`);
      calls.length = 0;
      await test.services.exports.page(admin, large.id, "pdf");
      const sent = calls.at(-1);
      expect(sent?.assets.map((asset) => asset.path)).toEqual([`/api/v1/attachments/${ids[0]}/content`]);
      expect(sent?.html).toContain(`src="/api/v1/attachments/${ids[0]}/content?size=display"`);
      expect(sent?.html).not.toContain(`src="/api/v1/attachments/${ids[1]}/content`);
      expect(sent?.html).toContain(
        `<span class="ph-export-note">${ids[1]}: Image left out because the file would otherwise be too large.`,
      );
    });
  });

  describe("embedded images", () => {
    it("reads each image once and stops embedding at the size budget of the document", async () => {
      const { admin, pages } = context;
      const second = await test.services.attachments.upload(admin, pages.welcome.id, {
        name: "switch.png",
        body: Readable.from([PNG]),
        contentLength: PNG.length,
      });
      const paged = new PagedExport({
        database: test.database,
        authorization: test.services.authorization,
        attachments: test.services.attachments,
        files: test.services.files,
        comments: test.services.comments,
        logger: createLogger({ service: "test", level: "silent" }),
        renderer: undefined as never,
        viewer: context.reader,
        language: "en",
        maxEmbeddedBytes: PNG.length,
      });
      const imageNode = (id: string) => ({ type: "image", attrs: { attachmentId: id, alt: "" } });
      const page = (document: unknown) =>
        ({ id: pages.welcome.id, document, images: new Set() }) as unknown as PreparedPage;
      paged.noteAssets(page(doc(imageNode(image), imageNode(image))));
      paged.noteAssets(page(doc(imageNode(second.id), imageNode(image))));
      const assets = await paged.assets();
      expect(assets.map((asset) => asset.path)).toEqual([`/api/v1/attachments/${image}/content`]);
    });

    it("counts WebP images after converting them and limits their size", async () => {
      const { admin, pages } = context;
      const webp = (width: number, height: number, channels: 3 | 4) =>
        sharp(
          Buffer.alloc(width * height * channels).map((_, index) => (index * 7919) % 251),
          {
            raw: { width, height, channels },
          },
        )
          .webp({ quality: 30 })
          .toBuffer();
      const upload = async (name: string, bytes: Buffer) =>
        (
          await test.services.attachments.upload(admin, pages.welcome.id, {
            name,
            body: Readable.from([bytes]),
            contentLength: bytes.length,
          })
        ).id;
      const wide = await upload("panorama.webp", await webp(4000, 600, 3));
      const transparent = await webp(300, 300, 4);
      const overlay = await upload("overlay.webp", transparent);
      const paged = (maxEmbeddedBytes: number) =>
        new PagedExport({
          database: test.database,
          authorization: test.services.authorization,
          attachments: test.services.attachments,
          displayVersions: test.services.displayVersions,
          files: test.services.files,
          comments: test.services.comments,
          logger: createLogger({ service: "test", level: "silent" }),
          renderer: undefined as never,
          viewer: context.reader,
          language: "en",
          maxEmbeddedBytes,
        });
      const page = (id: string) =>
        ({
          id: pages.welcome.id,
          document: doc({ type: "image", attrs: { attachmentId: id, alt: "" } }),
          images: new Set(),
        }) as unknown as PreparedPage;

      const roomy = paged(100 * 1024 * 1024);
      roomy.noteAssets(page(wide));
      const [converted] = await roomy.assets();
      const data = await buffer(await (converted as NonNullable<typeof converted>).open());
      const metadata = await sharp(data).metadata();
      expect({ type: converted?.contentType, size: converted?.size, width: metadata.width }).toEqual({
        type: "image/jpeg",
        size: data.length,
        width: 2048,
      });

      const tight = paged(transparent.length + 1);
      tight.noteAssets(page(overlay));
      expect(await tight.assets()).toEqual([]);
    });
  });

  describe("whiteboards", () => {
    let boards: { root: string; map: string; blank: string; secret: string };

    beforeAll(async () => {
      const { admin, space, org } = context;
      const create = (kind: "page" | "whiteboard", title: string, parentId: string | null) =>
        test.services.tree.create(admin, space.id, { kind, title, mode: "live", placement: { parentId } });
      const root = await create("page", "Planning", null);
      await test.services.documents.replace(admin, root.id, doc(paragraph(text("Planning text"))));
      const map = await create("whiteboard", "Network map", root.id);
      const blank = await create("whiteboard", "Blank board", root.id);
      const secret = await create("whiteboard", "Secret board", root.id);
      for (const board of [map, secret]) {
        expect(
          await test.services.whiteboards.setPreview(admin, board.id, {
            revision: 1,
            body: Readable.from([Buffer.from(BOARD_SVG)]),
          }),
        ).toBe(true);
      }
      const holderId = await member(org.id, "member", "Bea Board");
      await test.services.pageAccess.change(admin, secret.id, [
        { action: "share", holderKind: "account", holderId, role: "editor" },
        { action: "restrict", kind: "view" },
      ]);
      boards = { root: root.id, map: map.id, blank: blank.id, secret: secret.id };
    });

    beforeEach(async () => {
      for (const kept of await test.services.exports.list(context.steward)) {
        await test.services.exports.remove(context.steward, kept.id);
      }
    });

    it("prints each whiteboard as its own page with its image or a note", async () => {
      const printed = (
        await bytesOf(
          await job(
            context.steward,
            { pageId: boards.root },
            { format: "print", options: defaultExportOptions },
          ),
        )
      ).toString("utf8");
      expect(printed.match(/<article class="ph-print-page"/g)).toHaveLength(3);
      expect(printed).toContain('<h1 class="ph-page-title">Network map</h1>');
      expect(printed).toContain(
        `<figure class="ph-whiteboard"><img src="/api/v1/whiteboards/${boards.map}/preview" alt="Network map"></figure>`,
      );
      expect(printed).toContain('<h1 class="ph-page-title">Blank board</h1>');
      expect(printed).toContain("This whiteboard has no saved image yet");
      expect(printed).not.toContain("Secret board");
      expect(printed).not.toContain(boards.secret);
      const counts = await test.services.exports.counts(context.steward, { pageId: boards.root });
      expect(counts.pages).toBe(3);
    });

    it("sends the whiteboard images the exporter may see to the render container", async () => {
      calls.length = 0;
      await job(context.steward, { pageId: boards.root }, { format: "pdf", options: defaultExportOptions });
      const assets = calls[0]?.assets ?? [];
      const map = assets.find((asset) => asset.path === `/api/v1/whiteboards/${boards.map}/preview`);
      expect(map?.contentType).toBe("image/svg+xml");
      expect(Buffer.from(map?.data ?? "", "base64").toString("utf8")).toContain("<rect");
      expect(assets.map((asset) => asset.path)).not.toContain(`/api/v1/whiteboards/${boards.secret}/preview`);
    });

    it("embeds the whiteboard images in Word", async () => {
      const data = await bytesOf(
        await job(
          context.steward,
          { pageId: boards.root },
          { format: "docx", options: defaultExportOptions },
        ),
      );
      const output = await html(data);
      expect(output).toContain("Network map");
      expect(output).toContain('<img alt="Network map"');
      expect(output).toContain("This whiteboard has no saved image yet");
      expect(output).not.toContain("Secret board");
      const files = await unzip(data);
      expect([...files.keys()].filter((name) => name.endsWith(".svg"))).toHaveLength(1);
    });

    it("puts the whiteboard images into HTML and Markdown archives", async () => {
      const files = await unzip(
        await bytesOf(
          await job(
            context.steward,
            { pageId: boards.root },
            { format: "archive", options: defaultExportOptions },
          ),
        ),
      );
      const names = [...files.keys()];
      const image = names.find((name) => name.endsWith("Network map.svg")) ?? "";
      expect(files.get(image)?.toString("utf8")).toContain("<rect");
      const page = (extension: string) =>
        files.get(names.find((name) => name.endsWith(`Network map${extension}`)) ?? "")?.toString("utf8") ??
        "";
      expect(page(".html")).toContain('<img src="Network%20map.svg" alt="Network map">');
      expect(page(".md")).toContain("![Network map](Network%20map.svg)");
      const blank = names.find((name) => name.endsWith("Blank board.md")) ?? "";
      expect(files.get(blank)?.toString("utf8")).toContain("> This whiteboard has no saved image yet");
      expect(names.filter((name) => name.endsWith(".svg"))).toEqual([image]);
      expect(names.some((name) => name.includes("Secret"))).toBe(false);
      expect(files.get("index.html")?.toString("utf8")).toContain(">Network map</a>");
      const htmlOnly = await unzip(
        await bytesOf(
          await job(
            context.steward,
            { pageId: boards.root },
            { format: "html", options: defaultExportOptions },
          ),
        ),
      );
      expect([...htmlOnly.keys()].filter((name) => name.endsWith(".svg"))).toEqual([image]);
    });

    it("exports the whiteboards of a whole space", async () => {
      const files = await unzip(
        await bytesOf(
          await job(
            context.steward,
            { spaceId: context.space.id },
            { format: "markdown", options: defaultExportOptions },
          ),
        ),
      );
      const names = [...files.keys()];
      expect(names.some((name) => name.endsWith("Network map.svg"))).toBe(true);
      expect(names.some((name) => name.endsWith("Blank board.md"))).toBe(true);
      expect(names.some((name) => name.includes("Secret"))).toBe(false);
    });

    describe("blocks in pages", () => {
      let page: string;

      beforeAll(async () => {
        const { admin, space } = context;
        const created = await test.services.tree.create(admin, space.id, {
          kind: "page",
          title: "Board links",
          mode: "live",
          placement: { parentId: null },
        });
        await test.services.tree.update(admin, created.id, { numberHeadings: true });
        await test.services.documents.replace(
          admin,
          created.id,
          doc(
            { type: "heading", attrs: { level: 1 }, content: [text("Overview")] },
            { type: "heading", attrs: { level: 2 }, content: [text("Boards")] },
            { type: "whiteboard", attrs: { whiteboardId: boards.map } },
            { type: "whiteboard", attrs: { whiteboardId: boards.secret } },
            { type: "file", attrs: { attachmentId: image, name: "rack.png", preview: true } },
            { type: "file", attrs: { attachmentId: hiddenImage, name: "salary-chart.png", preview: true } },
            { type: "embed", attrs: { url: "https://youtu.be/dQw4w9WgXcQ", title: "Login video" } },
            {
              type: "tabs",
              content: [
                { type: "tab", attrs: { title: "Windows" }, content: [paragraph(text("Windows steps"))] },
                { type: "tab", attrs: { title: "macOS" }, content: [paragraph(text("macOS steps"))] },
              ],
            },
          ),
        );
        page = created.id;
      });

      it("prints whiteboards, previews and embeds with the exporter's permissions", async () => {
        const printed = (
          await bytesOf(await test.services.exports.page(context.steward, page, "print"))
        ).toString("utf8");
        expect(printed).toContain(`<img src="/api/v1/whiteboards/${boards.map}/preview" alt="">`);
        expect(printed).toContain("<figcaption>Network map</figcaption>");
        expect(printed).not.toContain("Secret board");
        expect(printed).not.toContain(boards.secret);
        expect(printed).toContain(`<img src="/api/v1/attachments/${image}/content" alt="rack.png">`);
        expect(printed).not.toContain(`<img src="/api/v1/attachments/${hiddenImage}`);
        expect(printed).toContain("<strong>Login video</strong>");
        expect(printed).not.toContain("<iframe");
        expect(printed).toContain('<h4 class="ph-tab-title">Windows</h4>');
        expect(printed).toContain("macOS steps");
        expect(printed).toContain('<span class="ph-heading-number">1.1 </span>Boards');
      });

      it("sends the images of whiteboard blocks and previews to the render container", async () => {
        calls.length = 0;
        await job(context.steward, { pageId: page }, { format: "pdf", options: defaultExportOptions });
        const paths = (calls[0]?.assets ?? []).map((asset) => asset.path);
        expect(paths).toContain(`/api/v1/whiteboards/${boards.map}/preview`);
        expect(paths).toContain(`/api/v1/attachments/${image}/content`);
        expect(paths).not.toContain(`/api/v1/whiteboards/${boards.secret}/preview`);
        expect(paths).not.toContain(`/api/v1/attachments/${hiddenImage}/content`);
      });

      it("writes whiteboards, previews, embeds, tabs and numbered headings to Word", async () => {
        const output = await html(
          await bytesOf(await test.services.exports.page(context.steward, page, "docx")),
        );
        expect(output).toContain("1 Overview");
        expect(output).toContain("1.1 Boards");
        expect(output).toContain("Network map");
        expect(output).not.toContain("Secret board");
        expect(output).toContain('<img alt="rack.png"');
        expect(output).toContain("Login video");
        expect(output).toContain("https://youtu.be/dQw4w9WgXcQ");
        expect(output.indexOf("Windows steps")).toBeLessThan(output.indexOf("macOS steps"));
      });
    });
  });

  describe("PDF", () => {
    it("sends the print HTML with the readable images to the render container", async () => {
      calls.length = 0;
      const file = await rendered.services.exports.page(context.reader, context.pages.welcome.id, "pdf");
      expect(file.contentType).toBe("application/pdf");
      expect(file.fileName).toBe("Welcome.pdf");
      expect((await bytesOf(file)).toString("latin1")).toBe("%PDF-1.7 rendered");
      expect(calls).toHaveLength(1);
      const [call] = calls;
      expect(call?.authorization).toBe(`Bearer ${TOKEN}`);
      expect(call?.baseUrl).toBe(INSTANCE);
      expect(call?.html).toContain('<h1 class="ph-page-title">Welcome</h1>');
      expect(call?.html).not.toContain("Salaries");
      expect(call?.assets.map((asset) => asset.path)).toEqual([`/api/v1/attachments/${image}/content`]);
      expect(call?.assets.map((asset) => asset.path)).not.toContain(
        `/api/v1/attachments/${hiddenImage}/content`,
      );
      expect(call?.assets[0]?.contentType).toBe("image/png");
    });

    it("builds a PDF of a subtree in the background", async () => {
      calls.length = 0;
      const file = await job(
        context.insider,
        { pageId: context.pages.salaries.id },
        {
          format: "pdf",
          options: defaultExportOptions,
        },
      );
      expect(file.contentType).toBe("application/pdf");
      expect(file.fileName).toMatch(/^Salaries 2027 \d{4}-\d{2}-\d{2}\.pdf$/);
      expect(calls[0]?.html).toContain("Confidential numbers");
      expect(calls[0]?.html).toContain("Bonus plan");
    });

    it("answers with a clear error without the render container", async () => {
      const without = await createTestServices(baseUrl ?? "", { configuredInstanceUrl: INSTANCE });
      try {
        await without.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
        const { organization, member: person, space } = spaceFixtures(() => without);
        const org = await organization();
        const ownerId = await person(org.id, "member", "Owner");
        const owner = accountPrincipal(ownerId);
        const created = await space(org.id, ownerId, { name: "Solo", grants: [] });
        const page = await without.services.tree.create(owner, created.id, {
          kind: "page",
          title: "Alone",
          mode: "live",
          placement: { parentId: null },
        });
        const refused = await without.services.exports
          .page(owner, page.id, "pdf")
          .catch((error: unknown) => error);
        expect(refused).toBeInstanceOf(ExportError);
        expect(refused).toMatchObject({
          code: "renderUnavailable",
          message: "Server-side PDF needs the render container; see the documentation",
        });
        await expect(
          without.services.exports.start(
            owner,
            { spaceId: created.id },
            { format: "pdf", options: defaultExportOptions },
          ),
        ).rejects.toMatchObject({ code: "renderUnavailable" });
        expect((await without.services.exports.counts(owner, { spaceId: created.id })).serverPdf).toBe(false);
        expect(await without.services.rendering.status()).toEqual({ state: "notConfigured" });
      } finally {
        await without.close();
      }
    });
  });
});
