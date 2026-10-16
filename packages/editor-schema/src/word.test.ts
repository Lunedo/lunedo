import { describe, expect, it } from "vitest";
import { loadFixtures } from "./fixtures.testing.js";
import {
  createEditorKit,
  defineModule,
  editorSchemaVersion,
  ModuleRegistry,
  modules,
  type NodeJson,
  type RenderContext,
  renderHtml,
  renderWord,
  type WordBlock,
  type WordInline,
} from "./index.js";
import { defaultModules } from "./modules/index.js";

const PAGE = "01929b1e-0000-7000-8000-000000000002";
const PERSON = "01929b1e-0000-7000-8000-000000000003";
const IMAGE = "01929b1e-0000-7000-8000-000000000004";

function text(value: string, marks: NodeJson["marks"] = []): NodeJson {
  return { type: "text", text: value, ...(marks.length > 0 ? { marks } : {}) };
}

function paragraph(...content: NodeJson[]): NodeJson {
  return { type: "paragraph", content };
}

function doc(...content: NodeJson[]) {
  return { type: "doc", content };
}

function cell(
  type: "tableCell" | "tableHeader",
  value: string,
  attrs: Record<string, unknown> = {},
): NodeJson {
  return { type, attrs, content: [paragraph(text(value))] };
}

function inlineText(content: readonly WordInline[]): string {
  return content.map((item) => (item.type === "text" ? item.text : "\n")).join("");
}

function blockText(blocks: readonly WordBlock[]): string {
  return blocks
    .map((block): string => {
      switch (block.type) {
        case "paragraph":
        case "heading":
          return inlineText(block.content);
        case "list":
          return block.items.map((item) => blockText(item.content)).join("");
        case "table":
          return block.rows.map((row) => row.cells.map((cell) => blockText(cell.content)).join("")).join("");
        case "code":
          return block.text;
        case "box":
          return `${inlineText(block.title)}${blockText(block.content)}`;
        case "quote":
          return blockText(block.content);
        case "placeholder":
          return block.text;
        default:
          return "";
      }
    })
    .join("");
}

function placeholders(blocks: readonly WordBlock[]): string[] {
  return blocks.flatMap((block): string[] => {
    switch (block.type) {
      case "placeholder":
        return [block.text];
      case "list":
        return block.items.flatMap((item) => placeholders(item.content));
      case "table":
        return block.rows.flatMap((row) => row.cells.flatMap((cell) => placeholders(cell.content)));
      case "box":
      case "quote":
        return placeholders(block.content);
      default:
        return [];
    }
  });
}

const context: RenderContext = {
  mention: (id) => (id === PERSON ? { name: "Anna Berger" } : null),
  pageLink: (link) =>
    link.pageId === PAGE
      ? { href: `/pages/${PAGE}`, title: "Device naming", accessible: true }
      : { href: "", title: "", accessible: false },
  attachment: (id) => ({ href: `/api/v1/attachments/${id}/content` }),
  formatDate: (iso) => `on ${iso}`,
};

describe("Word rendering", () => {
  it("gives every node and mark of the editor schema a Word form", () => {
    const missing = [
      ...modules
        .nodes()
        .filter((node) => !node.word)
        .map((node) => node.name),
      ...modules
        .marks()
        .filter((mark) => !mark.word)
        .map((mark) => mark.name),
    ];
    expect(missing).toEqual([]);
  });

  for (const { name, document } of loadFixtures(editorSchemaVersion)) {
    it(`renders the fixture ${name} without placeholders`, () => {
      const unsupported = placeholders(renderWord(document, context)).filter(
        (entry) => !entry.includes("Unsupported macro"),
      );
      expect(unsupported).toEqual([]);
      expect(renderWord(document, context).length).toBeGreaterThan(0);
    });
  }

  it("keeps headings with their level and anchor", () => {
    const blocks = renderWord(
      doc({ type: "heading", attrs: { level: 2 }, content: [text("Network")] }),
      context,
    );
    expect(blocks).toEqual([
      {
        type: "heading",
        level: 2,
        anchor: "network",
        content: [{ type: "text", text: "Network", style: {} }],
      },
    ]);
  });

  it("applies marks as text styles and keeps links", () => {
    const [block] = renderWord(
      doc(
        paragraph(
          text("bold", [{ type: "bold" }, { type: "italic" }]),
          text(" link", [{ type: "link", attrs: { href: "https://example.org" } }]),
          text(" code", [{ type: "code" }]),
          text(" red", [{ type: "textColor", attrs: { color: "red" } }]),
        ),
      ),
      context,
    );
    expect(block?.type).toBe("paragraph");
    const content = block?.type === "paragraph" ? block.content : [];
    expect(content).toEqual([
      { type: "text", text: "bold", style: { bold: true, italic: true } },
      { type: "text", text: " link", style: { link: "https://example.org" } },
      { type: "text", text: " code", style: { code: true } },
      { type: "text", text: " red", style: { color: "red" } },
    ]);
  });

  it("drops unsafe links but keeps their text", () => {
    const [block] = renderWord(
      doc(paragraph(text("click", [{ type: "link", attrs: { href: "https://example.org" } }]))),
      { ...context, href: () => "https://example.org" },
    );
    expect(block?.type === "paragraph" ? block.content[0] : null).toEqual({
      type: "text",
      text: "click",
      style: { link: "https://example.org" },
    });
  });

  it("keeps merged table cells and header cells", () => {
    const [table] = renderWord(
      doc({
        type: "table",
        content: [
          { type: "tableRow", content: [cell("tableHeader", "Site", { colspan: 2 })] },
          {
            type: "tableRow",
            content: [
              cell("tableCell", "Graz", { rowspan: 2, background: "blue" }),
              cell("tableCell", "10G"),
            ],
          },
          { type: "tableRow", content: [cell("tableCell", "1G")] },
        ],
      }),
      context,
    );
    expect(table?.type).toBe("table");
    if (table?.type !== "table") return;
    expect(table.borderless).toBe(false);
    expect(
      table.rows.map((row) => row.cells.map((entry) => [entry.header, entry.colspan, entry.rowspan])),
    ).toEqual([
      [[true, 2, 1]],
      [
        [false, 1, 2],
        [false, 1, 1],
      ],
      [[false, 1, 1]],
    ]);
    expect(table.rows[1]?.cells[0]?.background).toBe("blue");
  });

  it("keeps code with its language, images and task states", () => {
    const blocks = renderWord(
      doc(
        { type: "codeBlock", attrs: { language: "bash" }, content: [text("wg-quick up wg0")] },
        { type: "image", attrs: { attachmentId: IMAGE, alt: "Rack", width: 320, align: "left" } },
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { id: PAGE, assignee: PERSON, dueDate: "2026-10-20" },
              content: [paragraph(text("Order cables"))],
            },
          ],
        },
      ),
      { ...context, taskStatus: () => true },
    );
    expect(blocks[0]).toEqual({ type: "code", text: "wg-quick up wg0", language: "bash" });
    expect(blocks[1]).toEqual({
      type: "image",
      attachmentId: IMAGE,
      href: `/api/v1/attachments/${IMAGE}/content`,
      alt: "Rack",
      width: 320,
      align: "left",
    });
    expect(blocks[2]?.type === "list" ? blocks[2].items[0]?.checked : null).toBe(true);
    expect(blockText(blocks.slice(2))).toBe("Order cables @Anna Berger · on 2026-10-20");
  });

  it("writes page links, mentions, status and dates as text", () => {
    const blocks = renderWord(
      doc(
        paragraph(
          { type: "pageLink", attrs: { pageId: PAGE } },
          text(" "),
          { type: "mention", attrs: { id: PERSON } },
          text(" "),
          { type: "status", attrs: { text: "Done", color: "green" } },
          text(" "),
          { type: "date", attrs: { date: "2026-10-16" } },
          text(" "),
          { type: "pageLink", attrs: { pageId: "01929b1e-0000-7000-8000-000000000009" } },
        ),
      ),
      context,
    );
    expect(blockText(blocks)).toBe("Device naming @Anna Berger DONE on 2026-10-16 No access");
    const content = blocks[0]?.type === "paragraph" ? blocks[0].content : [];
    expect(content[0]).toEqual({ type: "text", text: "Device naming", style: { link: `/pages/${PAGE}` } });
    expect(content[4]).toEqual({ type: "text", text: "DONE", style: { bold: true, highlight: "green" } });
  });

  it("renders callouts as labelled boxes and columns as a borderless table", () => {
    const blocks = renderWord(
      doc(
        { type: "callout", attrs: { variant: "warning" }, content: [paragraph(text("Mind the gap"))] },
        {
          type: "columns",
          content: [
            { type: "column", attrs: { width: 30 }, content: [paragraph(text("Left"))] },
            { type: "column", attrs: { width: 70 }, content: [paragraph(text("Right"))] },
          ],
        },
      ),
      { labels: { callout: { warning: "Warnung" } as never } },
    );
    expect(blocks[0]).toMatchObject({ type: "box", variant: "warning" });
    expect(blockText(blocks.slice(0, 1))).toBe("WarnungMind the gap");
    expect(blocks[1]).toMatchObject({ type: "table", borderless: true });
    expect(blocks[1]?.type === "table" ? blocks[1].rows[0]?.cells.map((entry) => entry.width) : null).toEqual(
      [30, 70],
    );
  });

  it("uses a placeholder for nodes without a Word form", () => {
    const registry = new ModuleRegistry().register(
      ...defaultModules,
      defineModule({
        name: "testDiagram",
        nodes: [
          {
            name: "testDiagram",
            spec: { group: "block", atom: true },
            html: () => "<svg></svg>",
            print: "unsupported",
            markdown: () => "",
          },
        ],
      }),
    );
    const kit = createEditorKit(registry);
    const document = doc(paragraph(text("Before")), { type: "testDiagram" });
    const nodeTitle = (type: string) => (type === "testDiagram" ? "Diagram" : null);
    expect(kit.renderWord(document, { nodeTitle })).toEqual([
      {
        type: "paragraph",
        content: [{ type: "text", text: "Before", style: {} }],
        align: "left",
        indent: 0,
      },
      {
        type: "placeholder",
        text: "Diagram cannot be shown in this format. Open the page in Pagehall to see it.",
      },
    ]);
    const printed = kit.renderHtml(document, { nodeTitle, target: "print" });
    expect(printed).toContain(
      '<div class="ph-unavailable" data-node="testDiagram"><p>Diagram cannot be shown',
    );
    expect(printed).not.toContain("<svg>");
    expect(kit.renderHtml(document, { nodeTitle })).toContain("<svg></svg>");
  });
});

describe("print rendering", () => {
  it("loads images at once and shows the content of expand blocks", () => {
    const document = doc(
      { type: "image", attrs: { attachmentId: IMAGE, alt: "Rack", width: 320, align: "center" } },
      { type: "expand", attrs: { title: "Details" }, content: [paragraph(text("Hidden on screen"))] },
    );
    const screen = renderHtml(document, context);
    const printed = renderHtml(document, { ...context, target: "print" });
    expect(screen).toContain('loading="lazy"');
    expect(screen).toContain("<details");
    expect(printed).not.toContain("loading=");
    expect(printed).toContain('width="320"');
    expect(printed).not.toContain("<details");
    expect(printed).toContain('<p class="ph-expand-title">Details</p><div><p>Hidden on screen</p></div>');
  });

  it("renders every other node for print like on screen", () => {
    for (const { document } of loadFixtures(editorSchemaVersion)) {
      const printed = renderHtml(document, { ...context, target: "print" });
      expect(printed).not.toContain("ph-unavailable");
    }
  });
});
