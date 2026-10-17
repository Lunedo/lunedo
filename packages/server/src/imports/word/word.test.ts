import type { NodeJson } from "@pagehall/editor-schema";
import {
  Document,
  ExternalHyperlink,
  FootnoteReferenceRun,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from "docx";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseBaseUrl } from "../../testing/database.js";
import { createTestServices, type TestServices } from "../../testing/services.js";
import { spaceFixtures } from "../../testing/spaces.js";
import { type ByteSource, bufferSource, bundleOf } from "../formats/bytes.js";
import type { ScanContext } from "../source.js";
import { StagingStore } from "../staging.js";
import { importHarness } from "../testing/harness.js";
import { createZip } from "../testing/zip-writer.js";
import { MAX_DOCX_BYTES, WordReader } from "./reader.js";

const baseUrl = testDatabaseBaseUrl();
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

function nodes(node: NodeJson): NodeJson[] {
  return [node, ...(node.content ?? []).flatMap(nodes)];
}

function textOf(node: NodeJson): string {
  return nodes(node)
    .map((entry) => entry.text ?? "")
    .join("");
}

async function handbook(): Promise<Buffer> {
  const document = new Document({
    title: "IT security policy",
    footnotes: { 1: { children: [new Paragraph("Approved by the board in 2024.")] } },
    sections: [
      {
        children: [
          new Paragraph({ text: "This policy applies to everyone." }),
          new Paragraph({ text: "Passwords", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({
            children: [
              new TextRun({ text: "Use a password manager", bold: true }),
              new TextRun(" and a second factor."),
              new FootnoteReferenceRun(1),
            ],
          }),
          new Paragraph({ text: "Rules", heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ text: "At least 14 characters", bullet: { level: 0 } }),
          new Paragraph({ text: "Never reuse", bullet: { level: 0 } }),
          new Paragraph({ text: "Devices", heading: HeadingLevel.HEADING_1 }),
          new Table({
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph("Device")] }),
                  new TableCell({ children: [new Paragraph("Owner")] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph("Laptop")] }),
                  new TableCell({ children: [new Paragraph("IT")] }),
                ],
              }),
            ],
          }),
          new Paragraph({
            children: [
              new ImageRun({ type: "png", data: PNG, transformation: { width: 10, height: 10 } }),
              new ExternalHyperlink({
                link: "https://example.org/policy",
                children: [new TextRun({ text: "Full policy", style: "Hyperlink" })],
              }),
            ],
          }),
        ],
      },
    ],
  });
  return Packer.toBuffer(document);
}

function macroDocument(): Buffer {
  return createZip([
    {
      name: "[Content_Types].xml",
      data: '<?xml version="1.0"?><Types><Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>',
    },
    { name: "word/document.xml", data: "<w:document/>" },
    { name: "word/vbaProject.bin", data: "macro" },
  ]);
}

describe.skipIf(!baseUrl)("Word document imports", () => {
  let test: TestServices;
  const fixtures = spaceFixtures(() => test);
  const harness = importHarness(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl as string);
  });

  afterAll(async () => {
    await test?.close();
  });

  async function documentOf(itemId: string): Promise<NodeJson> {
    const result = await test.database.execute<{ snapshot: NodeJson }>(
      sql`select snapshot from page_documents where item_id = ${itemId}`,
    );
    return result.rows[0]?.snapshot as NodeJson;
  }

  async function pages(spaceId: string) {
    const result = await test.database.execute<{ id: string; title: string; parent_id: string | null }>(sql`
      select t.id, t.title, t.parent_id from tree_items t join spaces s on s.id = t.space_id
      where t.space_id = ${spaceId} and t.trash_entry_id is null and t.id is distinct from s.overview_item_id
      order by t.position`);
    return result.rows;
  }

  it("turns each document into a page with headings, lists, tables, images, links and footnotes", async () => {
    const organization = await fixtures.organization();
    const data = await handbook();
    const view = await harness.importedFiles({
      organizationId: organization.id,
      admin: organization.owner,
      source: "word",
      files: [
        { name: "security.docx", data },
        { name: "second.docx", data },
      ],
      key: "WORDALL",
    });
    expect(view.state).toBe("review");
    const tree = await pages(view.quarantineSpace?.id as string);
    const document = await documentOf(tree[0]?.id as string);
    const all = nodes(document);
    expect(all.filter((node) => node.type === "heading").map((node) => node.attrs?.level)).toEqual([1, 2, 1]);
    expect(all.some((node) => node.type === "bulletList")).toBe(true);
    expect(all.some((node) => node.type === "table")).toBe(true);
    expect(all.some((node) => node.type === "image")).toBe(true);
    const links = all.flatMap((node) => node.marks ?? []).filter((mark) => mark.type === "link");
    expect(links.map((mark) => mark.attrs?.href)).toContain("https://example.org/policy");
    const text = textOf(document);
    expect(text).toContain("Use a password manager");
    expect(text).toContain("[1]");
    expect(text.indexOf("Approved by the board in 2024.")).toBeGreaterThan(text.indexOf("Full policy"));
    expect(tree.map((page) => page.title)).toEqual(["IT security policy", "IT security policy"]);
    const attachments = await test.database.execute<{ count: number }>(sql`
      select count(*)::int as count from attachments where item_id = ${tree[0]?.id} and deleted_at is null`);
    expect(attachments.rows[0]?.count).toBe(1);
  });

  it("splits a document into a page per top-level heading when asked", async () => {
    const organization = await fixtures.organization();
    const view = await harness.importedFiles({
      organizationId: organization.id,
      admin: organization.owner,
      source: "word",
      files: [{ name: "security.docx", data: await handbook() }],
      options: { split: "heading" },
      key: "WORDSPLIT",
    });
    const tree = await pages(view.quarantineSpace?.id as string);
    const parent = tree.find((page) => page.title === "IT security policy");
    expect(tree.filter((page) => page.parent_id === parent?.id).map((page) => page.title)).toEqual([
      "Passwords",
      "Devices",
    ]);
    const passwords = await documentOf(tree.find((page) => page.title === "Passwords")?.id as string);
    expect(textOf(passwords)).toContain("Approved by the board in 2024.");
    const devices = await documentOf(tree.find((page) => page.title === "Devices")?.id as string);
    expect(textOf(devices)).not.toContain("Approved by the board");
    expect(nodes(devices).some((node) => node.type === "image")).toBe(true);
    expect(textOf(await documentOf(parent?.id as string))).toContain("This policy applies to everyone.");
  });

  it("refuses .docm files before reading them", async () => {
    const organization = await fixtures.organization();
    const draft = await test.services.imports.create(harness.as(organization.owner), organization.id, {
      source: "word",
    });
    const uploadId = await harness.upload(
      organization.owner,
      organization.id,
      macroDocument(),
      "macros.docm",
    );
    await expect(
      test.services.imports.update(harness.as(organization.owner), draft.id, { files: [uploadId] }),
    ).rejects.toMatchObject({ code: "macroDocument" });
  });

  it("refuses a document with macros that is named .docx", async () => {
    const organization = await fixtures.organization();
    const id = await harness.analyzedFiles({
      organizationId: organization.id,
      admin: organization.owner,
      source: "word",
      files: [{ name: "renamed.docx", data: macroDocument() }],
    });
    const view = await test.services.imports.get(harness.as(organization.owner), id);
    expect(view.state).toBe("draft");
    expect(view.errorCode).toBe("macroDocument");
  });

  describe("crafted files", () => {
    async function scan(source: ByteSource): Promise<unknown> {
      const organization = await fixtures.organization();
      const id = (
        await test.services.imports.create(harness.as(organization.owner), organization.id, {
          source: "word",
        })
      ).id;
      const context: ScanContext = {
        staging: new StagingStore(test.database, id),
        checkpoint: {},
        options: {},
        history: false,
        async saveCheckpoint() {},
        async progress() {},
        async problem() {},
        signal: new AbortController().signal,
      };
      return new WordReader().scan(bundleOf([{ name: "crafted.docx", source }]), context).then(
        () => null,
        (error: unknown) => error,
      );
    }

    it("refuses an oversized document without reading it", async () => {
      const huge: ByteSource = {
        size: MAX_DOCX_BYTES + 1,
        async read() {
          throw new Error("must not be read");
        },
        async close() {},
      };
      expect(await scan(huge)).toMatchObject({ code: "documentTooLarge" });
    });

    it.each([
      ["random bytes", Buffer.from("this is not a word document")],
      ["an encrypted document", Buffer.concat([Buffer.from("d0cf11e0a1b11ae1", "hex"), Buffer.alloc(512)])],
      ["an archive without a document", createZip([{ name: "hello.txt", data: "hi" }])],
      ["a damaged document", createZip([{ name: "word/document.xml", data: "<w:document><broken" }])],
      [
        "a zip bomb",
        createZip([{ name: "word/document.xml", data: Buffer.alloc(30 * 1024 * 1024, 0x20), deflate: true }]),
      ],
    ])("fails cleanly on %s", async (_case, data) => {
      expect(await scan(bufferSource(data))).toMatchObject({ code: "unreadableDocument" });
    });
  });
});
