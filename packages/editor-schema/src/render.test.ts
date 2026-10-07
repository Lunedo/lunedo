import { describe, expect, it } from "vitest";
import { loadFixtures } from "./fixtures.testing.js";
import {
  type DocumentJson,
  editorSchemaVersion,
  InvalidDocumentError,
  MAX_EXPENSIVE_RENDER_COST,
  modules,
  type NodeJson,
  type RenderContext,
  renderHtml,
  renderMarkdown,
} from "./index.js";

const ID = "01929b1e-0000-7000-8000-000000000001";
const PAGE = "01929b1e-0000-7000-8000-000000000002";

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

function decode(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity);
}

function skipElement(html: string, start: number, tag: string): number {
  const pattern = new RegExp(`<(/?)${tag}\\b[^>]*>`, "g");
  pattern.lastIndex = start;
  let depth = 0;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    depth += match[1] === "/" ? -1 : 1;
    if (depth === 0) return pattern.lastIndex;
  }
  return html.length;
}

function htmlText(html: string): string {
  let output = "";
  let index = 0;
  const math = /<(span|div) class="ph-math[^"]*" data-latex="([^"]*)">/g;
  for (let match = math.exec(html); match; match = math.exec(html)) {
    output += html.slice(index, match.index);
    output += match[2] ?? "";
    index = skipElement(html, match.index, match[1] ?? "span");
    math.lastIndex = index;
  }
  output += html.slice(index);
  return decode(output.replace(/<[^>]*>/g, "")).replace(/\s+/g, "");
}

function markdownText(markdown: string): string {
  const protectedParts: string[] = [];
  const protect = (value: string) => {
    protectedParts.push(value);
    return `\uE000${protectedParts.length - 1}\uE000`;
  };
  let text = markdown
    .replace(/^(`{3,})[^\n]*\n([\s\S]*?)\n\1$/gm, (_match, _fence, code: string) => protect(code))
    .replace(/\$(`+) ?(.*?) ?\1\$/g, (_match, _ticks, latex: string) => protect(latex))
    .replace(/(`+) ?([^`]+?) ?\1/g, (_match, _ticks, code: string) => protect(code))
    .replace(/\\([\\`*_[\]<>|~$&#\-+=.)])/g, (_match, character: string) => protect(character))
    .replace(/\$\$\n([\s\S]*?)\n\$\$/g, (_match, latex: string) => protect(latex))
    .replace(/\$([^$\n]+)\$/g, (_match, latex: string) => protect(latex))
    .replace(/<summary>([\s\S]*?)<\/summary>/g, (_match, summary: string) => protect(decode(summary)))
    .replace(/<[^>]*>/g, (tag) => (tag.startsWith("<") ? "" : tag));
  text = decode(text)
    .replace(/\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]*(> ?)+/gm, "")
    .replace(/^[ \t]*#{1,6} /gm, "")
    .replace(/^[ \t]*(- \[[ x]\] |- |\d+\. )/gm, "")
    .replace(/^\|( --- \|)+$/gm, "")
    .replace(/^---$/gm, "")
    .replace(/\|/g, "")
    .replace(/\*\*|~~|\*/g, "")
    .replace(/\\$/gm, "");
  text = text.replace(/\uE000(\d+)\uE000/g, (_match, index: string) => protectedParts[Number(index)] ?? "");
  return text.replace(/\s+/g, "");
}

function contains(node: NodeJson, type: string): boolean {
  return (
    node.type === type ||
    (node.marks ?? []).some((mark) => mark.type === type) ||
    (node.content ?? []).some((child) => contains(child, type))
  );
}

function excerpt(type: string): DocumentJson {
  const [first] = loadFixtures(editorSchemaVersion);
  if (type === "doc" && first) return first.document;
  for (const { document } of loadFixtures(editorSchemaVersion)) {
    const block = (document.content ?? []).find((child) => contains(child, type));
    if (block) return { type: "doc", content: [block] };
  }
  throw new Error(`No fixture contains ${type}`);
}

const context: RenderContext = {
  mention: (id) => (id === ID ? { name: "Anna Berger" } : null),
  pageLink: (link) =>
    link.pageId === PAGE
      ? { href: `/pages/${PAGE}`, title: "Device naming", accessible: true }
      : {
          href: `/spaces/new?title=${encodeURIComponent(link.title ?? "")}`,
          title: link.title ?? "",
          accessible: true,
        },
  attachment: (id) => ({ href: `/api/v1/attachments/${id}` }),
  formatDate: (iso) => `on ${iso}`,
};

describe("renderers", () => {
  const types = [...modules.nodes().map((node) => node.name), ...modules.marks().map((mark) => mark.name)];

  for (const module of modules.modules) {
    for (const name of [...module.nodes.map((node) => node.name), ...module.marks.map((mark) => mark.name)]) {
      it(`render the same text for ${module.name}/${name} in HTML and Markdown`, () => {
        const document = excerpt(name);
        for (const options of [undefined, context]) {
          const html = renderHtml(document, options);
          const markdown = renderMarkdown(document, options);
          expect(html.length).toBeGreaterThan(0);
          expect(markdownText(markdown), markdown).toBe(htmlText(html));
        }
      });
    }
  }

  for (const { name, document } of loadFixtures(editorSchemaVersion)) {
    it(`render the same text for the fixture ${name}`, () => {
      expect(markdownText(renderMarkdown(document, context))).toBe(htmlText(renderHtml(document, context)));
    });
  }

  it("cover every node and mark", () => {
    expect(types.length).toBeGreaterThan(40);
  });

  it("refuse invalid documents", () => {
    expect(() => renderHtml({ type: "doc", content: [{ type: "script" }] })).toThrow(InvalidDocumentError);
    expect(() => renderMarkdown({ type: "doc" })).toThrow(InvalidDocumentError);
  });
});

function doc(...content: unknown[]) {
  return { type: "doc", content };
}

function paragraph(...content: unknown[]) {
  return { type: "paragraph", content };
}

function text(value: string, marks?: unknown[]) {
  return marks ? { type: "text", text: value, marks } : { type: "text", text: value };
}

describe("renderHtml", () => {
  it("escapes text and attributes", () => {
    const html = renderHtml(
      doc(
        paragraph(text(`<script>alert("x")</script> & 'quotes'`)),
        { type: "expand", attrs: { title: `"><img src=x onerror=alert(1)>` }, content: [paragraph()] },
        { type: "blockMath", attrs: { latex: `"><script>x</script>` } },
        { type: "codeBlock", content: [text("<b>not bold</b>")] },
      ),
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quotes&#39;");
  });

  it("never renders a link the schema does not allow", () => {
    expect(() =>
      renderHtml(doc(paragraph(text("x", [{ type: "link", attrs: { href: "javascript:alert(1)" } }])))),
    ).toThrow(InvalidDocumentError);
    const html = renderHtml(doc(paragraph({ type: "pageLink", attrs: { pageId: PAGE } })), {
      pageLink: () => ({ href: "javascript:alert(1)", title: "Evil", accessible: true }),
    });
    expect(html).toBe('<p><span class="ph-page-link">Evil</span></p>');
  });

  it("renders links with rel attributes", () => {
    expect(
      renderHtml(
        doc(paragraph(text("site", [{ type: "link", attrs: { href: "https://example.org/?a=1&b=2" } }]))),
      ),
    ).toBe('<p><a href="https://example.org/?a=1&amp;b=2" rel="noopener noreferrer">site</a></p>');
  });

  it("nests marks across adjacent text", () => {
    const html = renderHtml(
      doc(paragraph(text("a", [{ type: "bold" }]), text("b", [{ type: "bold" }, { type: "italic" }]))),
    );
    expect(html).toBe("<p><strong>a<em>b</em></strong></p>");
  });

  it("gives headings unique ids and links them from the table of contents", () => {
    const html = renderHtml(
      doc(
        { type: "tableOfContents" },
        { type: "heading", attrs: { level: 1 }, content: [text("Über uns")] },
        { type: "heading", attrs: { level: 2 }, content: [text("Setup")] },
        { type: "heading", attrs: { level: 2 }, content: [text("Setup")] },
        { type: "heading", attrs: { level: 4 }, content: [text("Deep")] },
      ),
    );
    expect(html).toContain('<h1 id="uber-uns">');
    expect(html).toContain('<h2 id="setup">');
    expect(html).toContain('<h2 id="setup-2">');
    expect(html).toContain(
      '<nav class="ph-toc" aria-label="Table of contents"><ul><li><a href="#uber-uns">Über uns</a><ul><li><a href="#setup">Setup</a></li><li><a href="#setup-2">Setup</a></li></ul></li></ul></nav>',
    );
  });

  it("renders colors as names, never as values", () => {
    const html = renderHtml(
      doc(paragraph(text("x", [{ type: "textColor", attrs: { color: "red" } }, { type: "highlight" }]))),
    );
    expect(html).toBe(
      '<p><span class="ph-text-color" data-color="red"><mark class="ph-highlight" data-color="yellow">x</mark></span></p>',
    );
  });

  it("renders formulas only up to a budget per document and shows the rest as code", () => {
    const latex = `${"x^2+".repeat(499)}x`;
    const blocks = Array.from({ length: 20 }, () => ({ type: "blockMath", attrs: { latex } }));
    const html = renderHtml(doc(...blocks));
    const rendered = html.match(/class="katex-display"/g) ?? [];
    expect(rendered.length).toBe(Math.floor(MAX_EXPENSIVE_RENDER_COST / latex.length));
    expect(html).toContain(`<code>${latex}</code>`);
  });

  it("highlights code and renders math", () => {
    const html = renderHtml(
      doc(
        { type: "codeBlock", attrs: { language: "javascript" }, content: [text("const x = 1;")] },
        paragraph({ type: "inlineMath", attrs: { latex: "x^2" } }),
      ),
    );
    expect(html).toContain(
      '<pre class="ph-code-block" data-language="javascript"><code class="hljs language-javascript">',
    );
    expect(html).toContain('<span class="hljs-keyword">const</span>');
    expect(html).toContain('class="ph-math" data-latex="x^2"');
    expect(html).toContain('<span class="katex">');
  });

  it("hides the title of pages the reader cannot open", () => {
    const html = renderHtml(
      doc(paragraph({ type: "pageLink", attrs: { pageId: PAGE, title: "Secret plans" } })),
      {
        pageLink: () => ({ href: "/x", title: "Secret plans", accessible: false }),
        labels: { noAccess: "Kein Zugriff" },
      },
    );
    expect(html).toBe('<p><span class="ph-page-link" data-access="none">Kein Zugriff</span></p>');
  });

  it("uses translated labels", () => {
    const html = renderHtml(
      doc(
        { type: "callout", attrs: { variant: "warning" }, content: [paragraph()] },
        { type: "unsupportedMacro", attrs: { name: "gliffy" } },
      ),
      {
        labels: {
          callout: { warning: "Warnung" } as never,
          unsupportedMacro: "Nicht unterstütztes Makro: {name}",
        },
      },
    );
    expect(html).toContain('aria-label="Warnung"');
    expect(html).toContain("Nicht unterstütztes Makro: gliffy");
  });

  it("renders mentions, dates and missing pages with fallbacks", () => {
    const html = renderHtml(
      doc(
        paragraph(
          { type: "mention", attrs: { id: ID } },
          { type: "date", attrs: { date: "2026-10-12" } },
          { type: "pageLink", attrs: { spaceId: ID, title: "Later" } },
        ),
      ),
    );
    expect(html).toBe(
      `<p><span class="ph-mention" data-account-id="${ID}">@Unknown person</span><time class="ph-date" datetime="2026-10-12">2026-10-12</time><span class="ph-page-link" data-missing="true">Later</span></p>`,
    );
  });
});

describe("renderMarkdown", () => {
  it("renders the main constructs", () => {
    const markdown = renderMarkdown(
      doc(
        { type: "heading", attrs: { level: 2 }, content: [text("Title")] },
        paragraph(
          text("bold", [{ type: "bold" }]),
          text(" "),
          text("code`s", [{ type: "code" }]),
          text(" "),
          text("link", [{ type: "link", attrs: { href: "https://example.org/a b" } }]),
        ),
        {
          type: "taskList",
          content: [
            { type: "taskItem", attrs: { checked: true }, content: [paragraph(text("Done"))] },
            { type: "taskItem", content: [paragraph(text("Open"))] },
          ],
        },
        { type: "callout", attrs: { variant: "tip" }, content: [paragraph(text("Hint"))] },
        { type: "blockMath", attrs: { latex: "x" } },
      ),
    );
    expect(markdown).toBe(
      [
        "## Title",
        "",
        "**bold** ``code`s`` [link](https://example.org/a%20b)",
        "",
        "- [x] Done",
        "- [ ] Open",
        "",
        "> [!TIP]",
        "> Hint",
        "",
        "```math",
        "x",
        "```",
        "",
      ].join("\n"),
    );
  });

  it("keeps formulas inside code so they cannot break out into Markdown or HTML", () => {
    const inline = renderMarkdown(
      doc(paragraph({ type: "inlineMath", attrs: { latex: "x$ <img src=x onerror=alert(1)> $`y\nz" } })),
    );
    expect(inline).toBe("$``x$ <img src=x onerror=alert(1)> $`y z``$\n");
    const block = renderMarkdown(
      doc({ type: "blockMath", attrs: { latex: "a\n$$\n<script>alert(1)</script>\n```\nb" } }),
    );
    expect(block).toBe("````math\na\n$$\n<script>alert(1)</script>\n```\nb\n````\n");
  });

  it("escapes Markdown syntax in text", () => {
    expect(renderMarkdown(doc(paragraph(text("# not a heading *or* [link](x) <b>"))))).toBe(
      "\\# not a heading \\*or\\* \\[link\\](x) \\<b\\>\n",
    );
    expect(renderMarkdown(doc(paragraph(text("1. not a list"))))).toBe("1\\. not a list\n");
  });

  it("renders simple tables as pipe tables and merged cells as HTML", () => {
    const cell = (type: string, value: string, attrs = {}) => ({
      type,
      attrs,
      content: [paragraph(text(value))],
    });
    const simple = renderMarkdown(
      doc({
        type: "table",
        content: [
          { type: "tableRow", content: [cell("tableHeader", "A"), cell("tableHeader", "B|C")] },
          { type: "tableRow", content: [cell("tableCell", "1"), cell("tableCell", "2")] },
        ],
      }),
    );
    expect(simple).toBe("| A | B\\|C |\n| --- | --- |\n| 1 | 2 |\n");
    const merged = renderMarkdown(
      doc({
        type: "table",
        content: [
          { type: "tableRow", content: [cell("tableHeader", "A", { colspan: 2, colwidth: [10, 20] })] },
        ],
      }),
    );
    expect(merged).toContain('<th colspan="2" data-colwidth="10,20">');
  });

  it("renders expand and lists", () => {
    const markdown = renderMarkdown(
      doc(
        { type: "expand", attrs: { title: "More <info>" }, content: [paragraph(text("Body"))] },
        {
          type: "orderedList",
          attrs: { start: 2 },
          content: [
            {
              type: "listItem",
              content: [
                paragraph(text("Two")),
                { type: "bulletList", content: [{ type: "listItem", content: [paragraph(text("Sub"))] }] },
              ],
            },
          ],
        },
      ),
    );
    expect(markdown).toBe(
      "<details>\n<summary>More &lt;info&gt;</summary>\n\nBody\n\n</details>\n\n2. Two\n   - Sub\n",
    );
  });
});
