import { describe, expect, it } from "vitest";
import {
  type DocumentJson,
  extractSections,
  type NodeJson,
  renderHtml,
  renderMarkdown,
  renderWord,
  validateDocument,
} from "./index.js";
import { headingNumbers } from "./render.js";

const BOARD = "01929b1e-0000-7000-8000-000000000103";
const FILE = "01929b1e-0000-7000-8000-000000000102";

function doc(...content: NodeJson[]): DocumentJson {
  return { type: "doc", content };
}

function paragraph(text: string): NodeJson {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function heading(level: number, text: string): NodeJson {
  return { type: "heading", attrs: { level }, content: [{ type: "text", text }] };
}

function tabs(...entries: [string, NodeJson[]][]): NodeJson {
  return {
    type: "tabs",
    content: entries.map(([title, content]) => ({ type: "tab", attrs: { title }, content })),
  };
}

describe("the tabs block", () => {
  const document = doc(
    tabs(["Windows", [paragraph("Open the settings.")]], ["macOS", [paragraph("Open the system settings.")]]),
  );

  it("renders a tab list with the first tab selected and the other panels hidden", () => {
    const html = renderHtml(document);
    expect(html).toContain('<div class="ld-tabs-list" role="tablist">');
    expect(html).toContain(
      '<button type="button" role="tab" class="ld-tab-button" data-index="0" aria-selected="true" tabindex="0">Windows</button>',
    );
    expect(html).toContain(
      '<button type="button" role="tab" class="ld-tab-button" data-index="1" aria-selected="false" tabindex="-1">macOS</button>',
    );
    expect(html).toContain('<div class="ld-tab-panel" role="tabpanel" tabindex="0" data-index="0">');
    expect(html).toContain('<div class="ld-tab-panel" role="tabpanel" tabindex="0" data-index="1" hidden>');
    expect(html).toContain('class="ld-tab-toggle" data-index="0" aria-expanded="true"');
    expect(html).toContain('class="ld-tab-toggle" data-index="1" aria-expanded="false"');
  });

  it("prints all tabs one after another with their names as headings", () => {
    const html = renderHtml(document, { target: "print" });
    expect(html).not.toContain("hidden");
    expect(html).not.toContain("tablist");
    expect(html.indexOf('<h4 class="ld-tab-title">Windows</h4>')).toBeLessThan(
      html.indexOf("Open the settings."),
    );
    expect(html.indexOf("Open the settings.")).toBeLessThan(
      html.indexOf('<h4 class="ld-tab-title">macOS</h4>'),
    );
  });

  it("writes all tabs with their names as headings to Word", () => {
    expect(renderWord(document)).toEqual([
      { type: "heading", level: 4, anchor: "", content: [{ type: "text", text: "Windows", style: {} }] },
      {
        type: "paragraph",
        align: "left",
        indent: 0,
        content: [{ type: "text", text: "Open the settings.", style: {} }],
      },
      { type: "heading", level: 4, anchor: "", content: [{ type: "text", text: "macOS", style: {} }] },
      {
        type: "paragraph",
        align: "left",
        indent: 0,
        content: [{ type: "text", text: "Open the system settings.", style: {} }],
      },
    ]);
  });

  it("writes headings for every tab in Markdown", () => {
    expect(renderMarkdown(document)).toBe(
      "#### Windows\n\nOpen the settings.\n\n#### macOS\n\nOpen the system settings.\n",
    );
  });

  it("makes the names and the content of every tab searchable", () => {
    const text = extractSections(document)
      .map((section) => section.text)
      .join("\n");
    expect(text).toContain("Windows");
    expect(text).toContain("Open the system settings.");
  });

  it("refuses empty or padded names, nested tabs and more than 20 tabs", () => {
    expect(validateDocument(doc(tabs(["", [paragraph("x")]]))).ok).toBe(false);
    expect(validateDocument(doc(tabs([" A", [paragraph("x")]]))).ok).toBe(false);
    expect(validateDocument(doc(tabs(["A", [tabs(["B", [paragraph("x")]])]]))).ok).toBe(false);
    const many = Array.from(
      { length: 21 },
      (_, index) => [`Tab ${index}`, [paragraph("x")]] as [string, NodeJson[]],
    );
    expect(validateDocument(doc(tabs(...many))).ok).toBe(false);
    expect(validateDocument(doc(tabs(...many.slice(0, 20)))).ok).toBe(true);
    expect(validateDocument(doc({ type: "tabs", content: [] })).ok).toBe(false);
  });
});

describe("the whiteboard block", () => {
  const document = doc({ type: "whiteboard", attrs: { whiteboardId: BOARD } });
  const visible = {
    whiteboard: (id: string) =>
      id === BOARD
        ? {
            title: "Network 2027",
            href: `/spaces/IT/whiteboards/${BOARD}`,
            previewHref: `/api/v1/whiteboards/${BOARD}/preview`,
          }
        : null,
  };

  it("shows the preview and title and opens the whiteboard on click", () => {
    const html = renderHtml(document, visible);
    expect(html).toContain(`<a href="/spaces/IT/whiteboards/${BOARD}" class="ld-whiteboard-link">`);
    expect(html).toContain(`<img src="/api/v1/whiteboards/${BOARD}/preview" alt="" loading="lazy">`);
    expect(html).toContain("<figcaption>Network 2027</figcaption>");
  });

  it("shows nothing to readers who cannot see the whiteboard", () => {
    expect(renderHtml(document, { whiteboard: () => null })).toBe("");
    expect(renderWord(document, { whiteboard: () => null })).toEqual([]);
    expect(renderMarkdown(document, { whiteboard: () => null })).toBe("");
  });

  it("shows editors that the content is restricted, without its title", () => {
    const html = renderHtml(document, { whiteboard: () => null, showPlaceholders: true });
    expect(html).toContain("Restricted content");
    expect(html).not.toContain("Network 2027");
  });

  it("asks editors to choose a whiteboard while none is set", () => {
    expect(
      renderHtml(doc({ type: "whiteboard" }), { whiteboard: () => null, showPlaceholders: true }),
    ).toContain("Choose a whiteboard");
  });

  it("puts the preview and a linked title into Word and print", () => {
    expect(renderWord(document, visible)).toEqual([
      {
        type: "image",
        attachmentId: BOARD,
        href: `/api/v1/whiteboards/${BOARD}/preview`,
        alt: "Network 2027",
        width: null,
        align: "center",
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Network 2027",
            style: { link: `/spaces/IT/whiteboards/${BOARD}`, bold: true },
          },
        ],
      },
    ]);
    expect(renderHtml(document, { ...visible, target: "print" })).not.toContain('loading="lazy"');
  });

  it("adds no text of the whiteboard to the page's search text", () => {
    expect(extractSections(document)).toEqual([]);
  });
});

describe("the file preview option", () => {
  const preview = doc({
    type: "file",
    attrs: { attachmentId: FILE, name: "plan.png", preview: true, height: 400, zoom: 150 },
  });

  it("marks the block for an inline preview with its height and zoom", () => {
    const html = renderHtml(preview, { attachment: (id) => ({ href: `/files/${id}` }) });
    expect(html).toContain('data-preview="true" data-height="400" data-zoom="150"');
  });

  it("keeps a plain file block a download link", () => {
    const html = renderHtml(doc({ type: "file", attrs: { attachmentId: FILE, name: "plan.png" } }));
    expect(html).not.toContain("data-preview");
  });

  it("prints an image file as a picture and other files as name and link", () => {
    const image = renderHtml(preview, {
      target: "print",
      attachment: (id) => ({ href: `/files/${id}`, image: true }),
    });
    expect(image).toContain(`<img src="/files/${FILE}" alt="plan.png">`);
    const pdf = renderHtml(preview, {
      target: "print",
      attachment: (id) => ({ href: `/files/${id}`, image: false }),
    });
    expect(pdf).not.toContain("<img");
    expect(pdf).toContain(`<a href="/files/${FILE}"`);
  });

  it("writes an image file as a picture with its link to Word", () => {
    const blocks = renderWord(preview, { attachment: (id) => ({ href: `/files/${id}`, image: true }) });
    expect(blocks.map((block) => block.type)).toEqual(["image", "paragraph"]);
    const other = renderWord(preview, { attachment: (id) => ({ href: `/files/${id}` }) });
    expect(other.map((block) => block.type)).toEqual(["paragraph"]);
  });

  it("refuses heights and zoom levels outside the limits", () => {
    expect(validateDocument(doc({ type: "file", attrs: { attachmentId: FILE, height: 20 } })).ok).toBe(false);
    expect(validateDocument(doc({ type: "file", attrs: { attachmentId: FILE, zoom: 1000 } })).ok).toBe(false);
  });
});

describe("numbered headings", () => {
  it("numbers headings by their nesting", () => {
    const levels = [2, 3, 3, 4, 2, 4, 1];
    expect(headingNumbers(levels.map((level) => ({ level, text: "", id: "" })))).toEqual([
      "1",
      "1.1",
      "1.2",
      "1.2.1",
      "2",
      "2.1",
      "3",
    ]);
  });

  const document = doc(
    heading(1, "Overview"),
    heading(2, "Scope"),
    { type: "section", attrs: { key: "cause", title: "Cause" }, content: [paragraph("x")] },
    heading(1, "Plan"),
  );

  it("numbers headings in view, print, Word and Markdown when the page asks for it", () => {
    const html = renderHtml(document, { numberHeadings: true });
    expect(html).toContain('<h1 id="overview"><span class="ld-heading-number">1 </span>Overview</h1>');
    expect(html).toContain('<h2 id="scope"><span class="ld-heading-number">1.1 </span>Scope</h2>');
    expect(html).toContain('<h2 id="cause"><span class="ld-heading-number">1.2 </span>Cause</h2>');
    expect(html).toContain('<span class="ld-heading-number">2 </span>Plan');
    expect(renderHtml(document, { numberHeadings: true, target: "print" })).toContain("1.1 </span>Scope");
    const word = renderWord(document, { numberHeadings: true });
    expect(word[0]).toMatchObject({ type: "heading", content: [{ text: "1 " }, { text: "Overview" }] });
    expect(word[2]).toMatchObject({ type: "heading", content: [{ text: "1.2 Cause" }] });
    expect(renderMarkdown(document, { numberHeadings: true })).toContain("## 1.1 Scope");
  });

  it("leaves headings unnumbered by default", () => {
    expect(renderHtml(document)).not.toContain("ld-heading-number");
    expect(renderMarkdown(document)).toContain("## Scope");
  });
});
