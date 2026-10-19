import { MAX_DEPTH, type NodeJson, validateDocument } from "@pagehall/editor-schema";
import { describe, expect, it } from "vitest";
import { syntheticExport } from "../testing/fixture.js";
import {
  CONTENT_FALLBACK_MACRO,
  type ConvertedPage,
  convertStorage,
  parseStorage,
  type StorageLookup,
  storageReferences,
} from "./storage.js";

const ID = (n: number) => `01929b1e-0000-7000-8000-${String(n).padStart(12, "0")}`;
const BETA = ID(1);
const ZETA = ID(2);
const DIAGRAM = ID(3);
const REPORT = ID(4);
const BOB = ID(5);
const STRANGER = ID(6);

function lookup(): StorageLookup {
  let next = 100;
  return {
    page(reference) {
      if (reference.title === "Beta")
        return { kind: "page", pageId: BETA, path: `/spaces/SYN/pages/${BETA}/beta` };
      if (reference.sourceId === "1004")
        return { kind: "page", pageId: ZETA, path: `/spaces/SYN/pages/${ZETA}/zeta` };
      return { kind: "external", href: "https://example.atlassian.net/wiki/display/ELSE/Elsewhere" };
    },
    attachment(reference) {
      if (reference.fileName === "diagram.png")
        return { attachmentId: DIAGRAM, name: "diagram.png", version: 1 };
      if (reference.fileName === "report.pdf")
        return { attachmentId: REPORT, name: "report.pdf", version: 1 };
      return null;
    },
    person(reference) {
      return reference.accountId?.startsWith("557058:bbbb") ? BOB : STRANGER;
    },
    space(key) {
      return key === "SYN" ? "/spaces/SYN" : null;
    },
    newId() {
      next += 1;
      return ID(next);
    },
  };
}

async function convert(xhtml: string): Promise<ConvertedPage> {
  return convertStorage(await parseStorage(xhtml), lookup());
}

function nodes(node: NodeJson): NodeJson[] {
  return [node, ...(node.content ?? []).flatMap(nodes)];
}

function ofType(page: ConvertedPage, type: string): NodeJson[] {
  return nodes(page.document).filter((node) => node.type === type);
}

function marksOf(page: ConvertedPage, text: string): string[] {
  const node = nodes(page.document).find((candidate) => candidate.type === "text" && candidate.text === text);
  return (node?.marks ?? []).map((mark) =>
    mark.attrs ? `${mark.type}:${JSON.stringify(mark.attrs)}` : mark.type,
  );
}

const richBody = () => syntheticExport().pages.find((page) => page.title === "Alpha")?.body ?? "";

describe("storage format conversion", () => {
  it("produces a document that passes the editor schema", async () => {
    const page = await convert(richBody());
    expect(validateDocument(page.document).ok).toBe(true);
  });

  it("converts headings, paragraphs, alignment and indentation", async () => {
    const page = await convert(richBody());
    expect(ofType(page, "heading").map((node) => node.attrs?.level)).toEqual([1, 2, 3, 4, 5, 6]);
    const paragraphs = ofType(page, "paragraph");
    expect(paragraphs.some((node) => node.attrs?.textAlign === "center")).toBe(true);
    expect(paragraphs.some((node) => node.attrs?.indent === 2)).toBe(true);
  });

  it("converts text marks, colors to the palette, entities and line breaks", async () => {
    const page = await convert(richBody());
    expect(marksOf(page, "bold")).toEqual(["bold"]);
    expect(marksOf(page, "italic")).toEqual(["italic"]);
    expect(marksOf(page, "underline")).toEqual(["underline"]);
    expect(marksOf(page, "strike")).toEqual(["strike"]);
    expect(marksOf(page, "inline code")).toEqual(["code"]);
    expect(marksOf(page, "2")).toEqual(["subscript"]);
    expect(marksOf(page, "red")).toEqual(['textColor:{"color":"red"}']);
    expect(marksOf(page, "marked")).toEqual(['highlight:{"color":"yellow"}']);
    expect(nodes(page.document).some((node) => node.text?.includes("café →"))).toBe(true);
    expect(ofType(page, "hardBreak").length).toBeGreaterThan(0);
  });

  it("converts lists, ordered list starts and task lists with their status", async () => {
    const page = await convert(richBody());
    expect(ofType(page, "bulletList")).toHaveLength(2);
    expect(ofType(page, "orderedList")[0]?.attrs).toEqual({ start: 3 });
    const tasks = ofType(page, "taskItem");
    expect(tasks).toHaveLength(2);
    expect(page.tasks).toEqual([
      { id: tasks[0]?.attrs?.id, done: true },
      { id: tasks[1]?.attrs?.id, done: false },
    ]);
  });

  it("converts tables with merged cells, header cells, widths and highlights", async () => {
    const page = await convert(richBody());
    const [table] = ofType(page, "table");
    const rows = table?.content ?? [];
    expect(
      rows[0]?.content?.map((cell) => [
        cell.type,
        cell.attrs?.colspan,
        cell.attrs?.colwidth,
        cell.attrs?.background,
      ]),
    ).toEqual([
      ["tableHeader", 1, [120], "blue"],
      ["tableHeader", 2, [80, 100], null],
    ]);
    expect(rows[1]?.content?.[0]?.attrs).toMatchObject({ rowspan: 2, colwidth: [120] });
    expect(rows[2]?.content?.map((cell) => cell.attrs?.colwidth)).toEqual([[80], [100]]);
  });

  it("converts code blocks, quotes, rules, emoji and dates", async () => {
    const page = await convert(richBody());
    expect(ofType(page, "codeBlock")[0]?.content?.[0]?.text).toBe("line one\nline two");
    expect(ofType(page, "blockquote")).toHaveLength(1);
    expect(ofType(page, "horizontalRule")).toHaveLength(1);
    expect(ofType(page, "emoji")[0]?.attrs).toEqual({ emoji: "🙂" });
    expect(ofType(page, "date")[0]?.attrs).toEqual({ date: "2024-05-06" });
    expect(ofType(page, "columns")[0]?.content?.map((column) => column.attrs?.width)).toEqual([50, 50]);
  });

  it("rewrites links to imported pages and keeps others as links to the original address", async () => {
    const page = await convert(richBody());
    expect(ofType(page, "pageLink").map((node) => node.attrs?.pageId)).toEqual([BETA]);
    expect(marksOf(page, "the beta page")).toEqual([`link:{"href":"/spaces/SYN/pages/${BETA}/beta"}`]);
    expect(marksOf(page, "Zeta by address")).toEqual([`link:{"href":"/spaces/SYN/pages/${ZETA}/zeta"}`]);
    expect(marksOf(page, "link")).toEqual(['link:{"href":"https://example.org/docs"}']);
    expect(marksOf(page, "Elsewhere")).toEqual([
      'link:{"href":"https://example.atlassian.net/wiki/display/ELSE/Elsewhere"}',
    ]);
    expect(marksOf(page, "bad")).toEqual([]);
    expect(page.notes).toContainEqual({ code: "externalPageLink", title: "Elsewhere", spaceKey: "ELSE" });
    expect(page.notes).toContainEqual({ code: "invalidLink" });
  });

  it("converts images, file links and reports missing attachments", async () => {
    const page = await convert(richBody());
    expect(ofType(page, "image")[0]?.attrs).toEqual({
      attachmentId: DIAGRAM,
      alt: "Diagram",
      width: 300,
      align: "left",
      frame: null,
    });
    expect(marksOf(page, "report.pdf")).toEqual([`link:{"href":"/api/v1/attachments/${REPORT}/content"}`]);
    expect(ofType(page, "unsupportedMacro").some((node) => node.attrs?.name === "missing-attachment")).toBe(
      true,
    );
    expect(page.notes).toContainEqual({ code: "missingAttachment", fileName: "missing.png" });
  });

  it("turns mentions into placeholders keyed by the Atlassian ID", async () => {
    const page = await convert(richBody());
    expect(ofType(page, "mention").map((node) => node.attrs?.id)).toEqual([BOB, STRANGER, STRANGER]);
  });

  it("converts macros with a module and counts them apart from the unsupported ones", async () => {
    const page = await convert(richBody());
    expect(Object.fromEntries(page.converted)).toEqual({
      status: 1,
      info: 1,
      code: 1,
      toc: 1,
      children: 1,
      attachments: 1,
      "view-file": 1,
      "adf:decision-list": 1,
    });
    expect(Object.fromEntries(page.macros)).toEqual({ roadmap: 1 });
    expect(ofType(page, "status")[0]?.attrs).toEqual({ text: "Done", color: "green" });
    expect(ofType(page, "callout")[0]?.content?.[0]?.content).toEqual([{ type: "text", text: "Info panel" }]);
    expect(ofType(page, "codeBlock").at(-1)).toEqual({
      type: "codeBlock",
      attrs: { language: "javascript" },
      content: [{ type: "text", text: "const a = list[1 < 2]" }],
    });
  });

  it("keeps macros without a module as unsupported macro blocks with their original data", async () => {
    const page = await convert(
      '<ac:structured-macro ac:name="roadmap"><ac:parameter ac:name="timeline">true</ac:parameter></ac:structured-macro><ac:structured-macro ac:name="details"><ac:rich-text-body><p>Owner</p></ac:rich-text-body></ac:structured-macro>',
    );
    expect(Object.fromEntries(page.macros)).toEqual({ roadmap: 1, details: 1 });
    expect(Object.fromEntries(page.converted)).toEqual({});
    const macros = ofType(page, "unsupportedMacro");
    expect(macros[0]?.attrs?.data).toMatchObject({ parameters: { timeline: "true" } });
    expect(macros[1]?.attrs?.data).toMatchObject({ body: "<p>Owner</p>", bodyKind: "rich" });
  });

  it("keeps an inline macro inside its paragraph", async () => {
    const page = await convert(
      '<p>Before <ac:structured-macro ac:name="status"><ac:parameter ac:name="title">X</ac:parameter></ac:structured-macro> after</p>',
    );
    expect(page.document.content).toHaveLength(1);
    expect(page.document.content?.[0]?.content).toEqual([
      { type: "text", text: "Before " },
      { type: "status", attrs: { text: "X", color: "gray" } },
      { type: "text", text: " after" },
    ]);
  });

  it("keeps the text around an inline macro it cannot convert in order", async () => {
    const page = await convert(
      '<p>Before <ac:structured-macro ac:name="status"><ac:parameter ac:name="title"> </ac:parameter></ac:structured-macro> after</p>',
    );
    expect(
      page.document.content?.map((node) => [node.type, node.content?.[0]?.text ?? node.attrs?.name]),
    ).toEqual([
      ["paragraph", "Before"],
      ["unsupportedMacro", "status"],
      ["paragraph", "after"],
    ]);
    expect(Object.fromEntries(page.macros)).toEqual({ status: 1 });
  });

  it("replaces content that the schema refuses with an unsupported macro block holding the original", async () => {
    const deep = `${"<ul><li>".repeat(MAX_DEPTH)}deep${"</li></ul>".repeat(MAX_DEPTH)}`;
    const page = await convert(`<p>Kept</p>${deep}<p>Also kept</p>`);
    expect(validateDocument(page.document).ok).toBe(true);
    expect(page.document.content?.map((node) => node.type)).toEqual([
      "paragraph",
      "unsupportedMacro",
      "paragraph",
    ]);
    const fallback = page.document.content?.[1];
    expect(fallback?.attrs?.name).toBe(CONTENT_FALLBACK_MACRO);
    expect(JSON.stringify(fallback?.attrs?.data)).toContain("deep");
    expect(page.notes).toContainEqual({ code: "invalidContent", element: "ul" });
  });

  it("truncates macro data above the schema limit and reports it", async () => {
    const big = "x".repeat(400 * 1024);
    const page = await convert(
      `<ac:structured-macro ac:name="details"><ac:rich-text-body><p>${big}</p></ac:rich-text-body></ac:structured-macro>`,
    );
    expect(validateDocument(page.document).ok).toBe(true);
    expect(ofType(page, "unsupportedMacro")[0]?.attrs?.data).toMatchObject({ truncated: true });
    expect(page.notes).toContainEqual({ code: "macroDataTruncated", macro: "details" });
  });

  it("truncates long pages by the size of the stored document", async () => {
    const line = (index: number) => `${index} ${"network switch printer ".repeat(3)}`.slice(0, 60);
    const page = await convert(
      Array.from({ length: 17_500 }, (_, index) => `<p>${line(index)}</p>`).join(""),
    );
    expect(validateDocument(page.document).ok).toBe(true);
    expect(page.notes).toContainEqual({ code: "contentTruncated" });
  });

  it("never produces script, event handlers or unsafe links from crafted content", async () => {
    const page = await convert(
      [
        '<p onclick="alert(1)">Click <script>alert(1)</script></p>',
        '<p><a href="data:text/html,<script>alert(1)</script>">data</a> <a href=" javascript:alert(1)">js</a></p>',
        '<img src="javascript:alert(1)"/><ac:image><ri:url ri:value="javascript:alert(1)"/></ac:image>',
        '<iframe src="https://evil.example"></iframe><style>p{}</style>',
      ].join(""),
    );
    expect(validateDocument(page.document).ok).toBe(true);
    const json = JSON.stringify(page.document);
    expect(json).not.toContain("javascript:");
    expect(json).not.toContain("data:text");
    expect(json).not.toContain("onclick");
    expect(ofType(page, "link")).toEqual([]);
  });

  it("lists the references a page needs before conversion", async () => {
    const references = storageReferences(await parseStorage(richBody()));
    expect(references.pages).toContainEqual({ title: "Beta", spaceKey: null, sourceId: null });
    expect(references.pages).toContainEqual({ title: null, spaceKey: null, sourceId: "1004" });
    expect(references.attachments.map((reference) => reference.fileName).sort()).toEqual([
      "diagram.png",
      "missing.png",
      "report.pdf",
      "report.pdf",
    ]);
    expect(references.people).toHaveLength(3);
  });
});
