import { randomBytes, randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import type { DocumentJson } from "@pagehall/editor-schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, type Principal } from "../accounts/principal.js";
import { createLogger } from "../logging/logger.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { TextExtractor } from "./extraction/extractor.js";
import { docxFile, pdfFile, xlsxFile } from "./extraction/files.testing.js";
import type { ExtractableFormat, ExtractionOutcome } from "./extraction/text.js";
import { type AttachmentFiles, SearchIndexer } from "./indexer.js";
import { PostgresSearchAdapter } from "./postgres-adapter.js";
import { searchRequest } from "./search.testing.js";
import type { SearchRequest } from "./service.js";

const baseUrl = testDatabaseBaseUrl();

function body(text: string): DocumentJson {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

function word(): string {
  return `w${randomUUID()
    .replace(/[^a-f]/g, "")
    .slice(0, 10)}`;
}

class CountingExtractor extends TextExtractor {
  calls = 0;
  onExtract: (() => void) | null = null;

  override async extract(
    format: ExtractableFormat,
    data: Uint8Array,
    signal?: AbortSignal,
  ): Promise<ExtractionOutcome> {
    this.calls += 1;
    this.onExtract?.();
    return super.extract(format, data, signal);
  }
}

function capturingLogger() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });
  return { lines, logger: createLogger({ service: "test", level: "info", destination }) };
}

describe.skipIf(!baseUrl)("search over attachments", () => {
  let test: TestServices;
  const fixtures = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function setup() {
    const org = await fixtures.organization();
    const editorId = await fixtures.member(org.id, "member", "Editor");
    const readerId = await fixtures.member(org.id, "member", "Reader");
    const groupId = await fixtures.group(org.id, [readerId]);
    const space = await fixtures.space(org.id, editorId, {
      grants: [{ principalKind: "group", principalId: groupId, role: "reader" }],
    });
    const editor = accountPrincipal(editorId);
    const page = async (title: string, mode: "live" | "publish" = "live") =>
      test.services.tree.create(editor, space.id, {
        kind: "page",
        title,
        mode,
        placement: { parentId: null },
        document: body("Page text"),
      });
    const upload = async (itemId: string, name: string, content: Buffer) =>
      test.services.attachments.upload(editor, itemId, { name, body: Readable.from([content]) });
    return { org, space, editor, editorId, reader: accountPrincipal(readerId), readerId, page, upload };
  }

  async function search(
    viewer: Principal,
    organizationId: string,
    query: string,
    overrides: Partial<SearchRequest> = {},
  ) {
    return test.services.search.search(viewer, organizationId, searchRequest(query, overrides));
  }

  async function ids(viewer: Principal, organizationId: string, query: string) {
    return (await search(viewer, organizationId, query)).results.map((hit) => hit.id);
  }

  async function drain() {
    return test.services.search.indexer.drain();
  }

  it("finds the text of PDF, Word and Excel files and the names of all files, with their metadata", async () => {
    const context = await setup();
    const words = { pdf: word(), docx: word(), xlsx: word(), name: word(), plain: word() };
    const created = await context.page("Procurement");
    const pdf = await context.upload(created.id, "offer.pdf", pdfFile([[`Offer for ${words.pdf} licences`]]));
    const docx = await context.upload(created.id, "contract.docx", await docxFile([`Clause ${words.docx}`]));
    const xlsx = await context.upload(
      created.id,
      "prices.xlsx",
      await xlsxFile([
        {
          name: "Prices",
          rows: [
            ["Item", words.xlsx],
            ["Total", 1200],
          ],
        },
      ]),
    );
    const plain = await context.upload(
      created.id,
      `notes-${words.name}.txt`,
      Buffer.from(`Plain ${words.plain}`),
    );
    await drain();

    const found = await search(context.reader, context.org.id, words.pdf);
    expect(found.results).toHaveLength(1);
    expect(found.results[0]).toMatchObject({
      type: "attachment",
      id: pdf.id,
      itemId: created.id,
      title: "Procurement",
      heading: "offer.pdf",
      attachment: { id: pdf.id, name: "offer.pdf", contentType: "application/pdf", size: pdf.size },
      topic: null,
      series: null,
    });
    expect(await ids(context.reader, context.org.id, words.docx)).toEqual([docx.id]);
    expect(await ids(context.reader, context.org.id, `${words.xlsx} Prices`)).toEqual([xlsx.id]);
    expect(await ids(context.reader, context.org.id, `contract ${words.docx}`)).toEqual([docx.id]);
    expect(await ids(context.reader, context.org.id, words.name)).toEqual([plain.id]);
    expect(await ids(context.reader, context.org.id, words.plain)).toEqual([]);
    expect(await ids(context.reader, context.org.id, `type:attachment ${words.pdf}`)).toEqual([pdf.id]);
    expect(await ids(context.reader, context.org.id, `type:page ${words.pdf}`)).toEqual([]);
    const later = word();
    const added = await context.upload(created.id, "addendum.pdf", pdfFile([[`Addendum ${later}`]]));
    await drain();
    expect(await ids(context.reader, context.org.id, later)).toEqual([added.id]);
    const all = await search(context.reader, context.org.id, "", { spaceIds: [context.space.id] });
    expect(all.facets?.contentTypes).toEqual(expect.arrayContaining([{ value: "attachment", count: 5 }]));
  });

  it("indexes what readers see: files of a draft only once it is published", async () => {
    const context = await setup();
    const first = word();
    const second = word();
    const created = await context.page("Handbook", "publish");
    await test.services.versions.publish(context.editor, created.id);
    const attachment = await context.upload(created.id, "policy.pdf", pdfFile([[`Policy ${first}`]]));
    await drain();
    for (const viewer of [context.editor, context.reader]) {
      expect(await ids(viewer, context.org.id, first)).toEqual([]);
      expect(await ids(viewer, context.org.id, "policy")).toEqual([]);
    }

    await test.services.versions.publish(context.editor, created.id);
    await drain();
    expect(await ids(context.reader, context.org.id, first)).toEqual([attachment.id]);

    await context.upload(created.id, "policy.pdf", pdfFile([[`Policy ${second}`]]));
    await drain();
    expect(await ids(context.reader, context.org.id, first)).toEqual([attachment.id]);
    expect(await ids(context.editor, context.org.id, second)).toEqual([]);

    await test.services.versions.publish(context.editor, created.id);
    await drain();
    expect(await ids(context.reader, context.org.id, first)).toEqual([]);
    expect(await ids(context.reader, context.org.id, second)).toEqual([attachment.id]);

    await test.services.attachments.delete(context.editor, attachment.id);
    await drain();
    expect(await ids(context.reader, context.org.id, second)).toEqual([attachment.id]);

    await test.services.versions.publish(context.editor, created.id);
    await drain();
    expect(await ids(context.editor, context.org.id, second)).toEqual([]);
    expect(await ids(context.editor, context.org.id, "policy")).toEqual([]);
  });

  it("finds broken and encrypted files by name only and logs a warning without content", async () => {
    const context = await setup();
    const secret = word();
    const created = await context.page("Archive");
    const broken = await context.upload(
      created.id,
      "broken-report.pdf",
      Buffer.concat([Buffer.from(`%PDF-1.4\n${secret}\n`), randomBytes(512)]),
    );
    const locked = await context.upload(
      created.id,
      "locked-report.pdf",
      pdfFile([[secret]], { encrypted: true }),
    );
    const capture = capturingLogger();
    await test.services.search.indexer.drain({ logger: capture.logger });

    expect((await ids(context.reader, context.org.id, "report")).sort()).toEqual(
      [broken.id, locked.id].sort(),
    );
    expect(await ids(context.editor, context.org.id, secret)).toEqual([]);
    const warnings = capture.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(warnings.map((entry) => entry.reason).sort()).toEqual(["encrypted", "unreadable"]);
    expect(capture.lines.join("\n")).not.toContain(secret);
    expect(capture.lines.join("\n")).not.toContain("report");
    const stored = await test.pool.query<{ state: string; reason: string }>(
      `select ft.state, ft.reason from search_file_texts ft join attachment_versions v on v.file_id = ft.file_id
       join attachments a on a.published_version_id = v.id where a.item_id = $1 order by ft.reason`,
      [created.id],
    );
    expect(stored.rows).toEqual([
      { state: "skipped", reason: "encrypted" },
      { state: "skipped", reason: "unreadable" },
    ]);
  });

  it("finds files over the size limit by name only without reading them", async () => {
    const context = await setup();
    const inside = word();
    const created = await context.page("Large files");
    const large = await context.upload(created.id, "large-scan.pdf", pdfFile([[inside]]));
    let reads = 0;
    const files: AttachmentFiles = {
      readAll: async (fileId, maxBytes) => {
        reads += 1;
        return test.services.attachments.files.readAll(fileId, maxBytes);
      },
    };
    const indexer = new SearchIndexer({
      database: test.database,
      adapter: new PostgresSearchAdapter(),
      files,
      extractor: new TextExtractor({ maxBytes: 64 }),
    });
    await indexer.drain();
    expect(reads).toBe(0);
    expect(await ids(context.reader, context.org.id, "scan")).toEqual([large.id]);
    expect(await ids(context.reader, context.org.id, inside)).toEqual([]);
  });

  it("extracts a file once and reuses its text when the page is indexed again", async () => {
    const context = await setup();
    const inside = word();
    const extractor = new CountingExtractor();
    const indexer = new SearchIndexer({
      database: test.database,
      adapter: new PostgresSearchAdapter(),
      files: test.services.attachments.files,
      extractor,
    });
    const created = await context.page("Reused");
    const attachment = await context.upload(created.id, "minutes.pdf", pdfFile([[inside]]));
    await indexer.drain();
    await test.services.tree.update(context.editor, created.id, { title: "Reused again" });
    await indexer.drain();
    expect(extractor.calls).toBe(1);
    const found = await search(context.reader, context.org.id, inside);
    expect(found.results.map((hit) => [hit.id, hit.title])).toEqual([[attachment.id, "Reused again"]]);
  });

  it("keeps the page pending without a stored text when reading the file fails, and retries it", async () => {
    const context = await setup();
    const inside = word();
    const created = await context.page("Unreachable storage");
    const attachment = await context.upload(created.id, "budget.pdf", pdfFile([[inside]]));
    let failing = true;
    const indexer = new SearchIndexer({
      database: test.database,
      adapter: new PostgresSearchAdapter(),
      files: {
        readAll: async (fileId, maxBytes) => {
          if (failing) throw new Error("Storage is unreachable");
          return test.services.attachments.files.readAll(fileId, maxBytes);
        },
      },
    });
    expect((await indexer.drain()).failed).toBe(1);
    const stored = await test.pool.query(
      "select 1 from search_file_texts ft join attachment_versions v on v.file_id = ft.file_id where v.attachment_id = $1",
      [attachment.id],
    );
    expect(stored.rows).toEqual([]);
    const pending = await test.pool.query("select attempts from search_pending_items where item_id = $1", [
      created.id,
    ]);
    expect(pending.rows).toEqual([{ attempts: 1 }]);
    failing = false;
    await test.pool.query("update search_pending_items set due_at = now() where item_id = $1", [created.id]);
    await indexer.drain();
    expect(await ids(context.reader, context.org.id, inside)).toEqual([attachment.id]);
  });

  it("leaves the page pending without a stored text when indexing is stopped during an extraction", async () => {
    const context = await setup();
    const created = await context.page("Stopped");
    await context.upload(created.id, "slow.pdf", pdfFile([["Stopped midway"]]));
    const controller = new AbortController();
    const extractor = new CountingExtractor();
    extractor.onExtract = () => controller.abort();
    const indexer = new SearchIndexer({
      database: test.database,
      adapter: new PostgresSearchAdapter(),
      files: test.services.attachments.files,
      extractor,
    });
    const result = await indexer.drain({ signal: controller.signal });
    expect(result.failed).toBe(0);
    const pending = await test.pool.query("select attempts from search_pending_items where item_id = $1", [
      created.id,
    ]);
    expect(pending.rows).toEqual([{ attempts: 0 }]);
    const stored = await test.pool.query(
      `select 1 from search_file_texts ft join attachment_versions v on v.file_id = ft.file_id
       join attachments a on a.id = v.attachment_id where a.item_id = $1`,
      [created.id],
    );
    expect(stored.rows).toEqual([]);
  });

  it("suggests corrections only from attachments the person can read", async () => {
    const context = await setup();
    const hidden = "zephyrquartzite";
    const created = await context.page("Restricted findings");
    await context.upload(created.id, "findings.pdf", pdfFile([[`Mineral ${hidden}`]]));
    await test.services.pageAccess.change(context.editor, created.id, [{ action: "restrict", kind: "view" }]);
    await drain();
    expect((await search(context.reader, context.org.id, "zephyrquartzitte")).suggestion).toBeNull();
    expect((await search(context.reader, context.org.id, hidden)).results).toEqual([]);
    expect((await search(context.editor, context.org.id, "zephyrquartzitte")).suggestion).toBe(hidden);
  });
});
