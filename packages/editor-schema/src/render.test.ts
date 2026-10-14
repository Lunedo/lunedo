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
  return decode(
    output.replace(/<div class="ph-callout-control">[\s\S]*?<\/div>/g, "").replace(/<[^>]*>/g, ""),
  ).replace(/\s+/g, "");
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
  childPages: () => [
    {
      title: "Network",
      href: `/pages/${PAGE}`,
      children: [{ title: "Firewall rules", href: "/pages/rules", children: [] }],
    },
  ],
  attachmentList: () => [
    { id: ID, name: "handbook.pdf", size: 2_621_440 },
    { id: PAGE, name: "budget.xlsx", size: 512 },
  ],
  pageReport: () => [
    {
      title: "VPN setup",
      href: `/pages/${PAGE}`,
      author: "Anna Berger",
      updatedAt: "2026-10-01T08:00:00.000Z",
    },
    { title: "", href: "/pages/untitled", author: null, updatedAt: "2026-09-30T08:00:00.000Z" },
  ],
  decisionReport: () => [
    {
      text: "Use WireGuard",
      page: { title: "VPN setup", href: `/pages/${PAGE}` },
      date: "2026-10-02T08:00:00.000Z",
    },
  ],
};

describe("callout", () => {
  it("shows its type as a label with an icon before the content", () => {
    const html = renderHtml(
      {
        type: "doc",
        content: [
          { type: "callout", attrs: { variant: "warning" }, content: [paragraph(text("Mind the gap"))] },
        ],
      },
      { labels: { callout: { warning: "Warnung" } as never } },
    );
    expect(html).toContain('<div class="ph-callout-control"><span class="ph-callout-label"><svg');
    expect(html).toContain("</svg>Warnung</span></div>");
    expect(html.indexOf("Warnung")).toBeLessThan(html.indexOf("Mind the gap"));
  });
});

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

  it("marks links to pages in the trash for people who could read them", () => {
    const link = doc(paragraph({ type: "pageLink", attrs: { pageId: PAGE, title: "Old title" } }));
    const context = {
      pageLink: () => ({ href: "", title: "Printer list", accessible: false, inTrash: true }),
      labels: { inTrash: "Im Papierkorb" },
    };
    expect(renderHtml(link, context)).toBe(
      '<p><span class="ph-page-link" data-state="trash">Printer list (Im Papierkorb)</span></p>',
    );
    expect(renderMarkdown(link, context).trim()).toBe("Printer list (Im Papierkorb)");
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
            { type: "taskItem", attrs: { id: ID }, content: [paragraph(text("Done"))] },
            { type: "taskItem", attrs: { id: PAGE }, content: [paragraph(text("Open"))] },
          ],
        },
        { type: "callout", attrs: { variant: "tip" }, content: [paragraph(text("Hint"))] },
        { type: "blockMath", attrs: { latex: "x" } },
      ),
      { taskStatus: (id) => id === ID },
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

describe("template nodes", () => {
  const document = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "templateField", attrs: { field: "name" } },
          { type: "placeholder", attrs: { text: "Describe the goal" } },
        ],
      },
    ],
  };

  it("hides placeholder instructions from readers and shows them in previews", () => {
    expect(renderHtml(document)).not.toContain("Describe the goal");
    expect(renderHtml(document, { showPlaceholders: true })).toContain(
      '<span class="ph-placeholder">Describe the goal</span>',
    );
    expect(renderMarkdown(document)).not.toContain("Describe the goal");
  });

  it("shows unfilled template fields by their key", () => {
    expect(renderHtml(document)).toContain('data-field="name"');
    expect(renderMarkdown(document)).toContain("{name}");
  });
});

describe("task items", () => {
  it("name their checkbox so screen readers can tell done from open tasks", () => {
    const html = renderHtml(
      {
        type: "doc",
        content: [
          {
            type: "taskList",
            content: [
              { type: "taskItem", attrs: { id: ID }, content: [paragraph(text("Done"))] },
              { type: "taskItem", attrs: { id: PAGE }, content: [paragraph(text("Open"))] },
            ],
          },
        ],
      },
      { labels: { taskDone: "Erledigt", taskOpen: "Offen" }, taskStatus: (id) => id === ID },
    );
    expect(html).toContain('<input type="checkbox" disabled aria-label="Erledigt" checked>');
    expect(html).toContain('<input type="checkbox" disabled aria-label="Offen">');
  });
});

describe("table of contents", () => {
  const headings = [
    { type: "heading", attrs: { level: 1 }, content: [text("Title")] },
    { type: "heading", attrs: { level: 2 }, content: [text("Setup")] },
    { type: "heading", attrs: { level: 3 }, content: [text("Network")] },
    { type: "heading", attrs: { level: 4 }, content: [text("Ports")] },
  ];

  it("lists only the headings between its lowest and highest level", () => {
    const document = doc({ type: "tableOfContents", attrs: { minLevel: 2, maxLevel: 3 } }, ...headings);
    const html = renderHtml(document);
    const toc = html.slice(0, html.indexOf("</nav>"));
    expect(toc).toContain("Setup");
    expect(toc).toContain("Network");
    expect(toc).not.toContain("Title");
    expect(toc).not.toContain("Ports");
    expect(renderMarkdown(document).split("\n\n")[0]).toBe("- [Setup](#setup)\n  - [Network](#network)");
  });

  it("starts at the first level when no lowest level is set", () => {
    const html = renderHtml(doc({ type: "tableOfContents", attrs: { maxLevel: 1 } }, ...headings));
    expect(html.slice(0, html.indexOf("</nav>"))).toContain("Title");
  });

  it("refuses a lowest level above the highest", () => {
    expect(() => renderHtml(doc({ type: "tableOfContents", attrs: { minLevel: 4, maxLevel: 2 } }))).toThrow(
      InvalidDocumentError,
    );
  });
});

describe("child pages", () => {
  const block = { type: "childPages", attrs: { pageId: PAGE, depth: 2, sort: "title", reverse: true } };

  it("show the label and the settings until the reader's pages are known", () => {
    const html = renderHtml(doc(block));
    expect(html).toBe(
      `<nav class="ph-child-pages" aria-label="Child pages" data-page-id="${PAGE}" data-depth="2" data-sort="title" data-reverse="true"><p>Child pages</p></nav>`,
    );
    expect(renderMarkdown(doc(block))).toBe("*Child pages*\n");
  });

  it("ask for the pages with the block's settings and nest them", () => {
    const requests: unknown[] = [];
    const pages = {
      childPages: (request: unknown) => {
        requests.push(request);
        return context.childPages?.(request as never) ?? null;
      },
    };
    expect(renderHtml(doc(block), pages)).toContain(
      '<ul><li><a href="/pages/01929b1e-0000-7000-8000-000000000002">Network</a><ul><li><a href="/pages/rules">Firewall rules</a></li></ul></li></ul>',
    );
    expect(renderMarkdown(doc(block), pages)).toBe(
      `- [Network](/pages/${PAGE})\n  - [Firewall rules](/pages/rules)\n`,
    );
    expect(requests).toEqual([
      { pageId: PAGE, depth: 2, sort: "title", reverse: true },
      { pageId: PAGE, depth: 2, sort: "title", reverse: true },
    ]);
  });

  it("default to the current page with all levels in tree order", () => {
    const html = renderHtml(doc({ type: "childPages" }));
    expect(html).toContain('data-depth="all" data-sort="tree"');
    expect(html).not.toContain("data-page-id");
  });

  it("say when there is nothing to show and never link to unsafe addresses", () => {
    expect(renderHtml(doc(block), { childPages: () => [] })).toContain(
      '<p class="ph-listing-empty">No child pages</p>',
    );
    expect(renderMarkdown(doc(block), { childPages: () => [] })).toBe("*No child pages*\n");
    const evil = { childPages: () => [{ title: "<b>x</b>", href: "javascript:alert(1)", children: [] }] };
    expect(renderHtml(doc(block), evil)).toContain("<li>&lt;b&gt;x&lt;/b&gt;</li>");
    expect(renderMarkdown(doc(block), evil)).toBe("- \\<b\\>x\\</b\\>\n");
  });

  it("refuse depths outside 1 to 10 and unknown sort orders", () => {
    for (const attrs of [{ depth: 0 }, { depth: 11 }, { depth: 1.5 }, { sort: "random" }, { pageId: "x" }]) {
      expect(() => renderHtml(doc({ type: "childPages", attrs }))).toThrow(InvalidDocumentError);
    }
  });
});

describe("attachment list", () => {
  it("shows the label until the attachments are known", () => {
    expect(renderHtml(doc({ type: "attachmentList" }))).toBe(
      '<section class="ph-attachment-list" aria-label="Attachments"><p>Attachments</p></section>',
    );
    expect(renderMarkdown(doc({ type: "attachmentList" }))).toBe("*Attachments*\n");
  });

  it("lists the attachments with their size, filtered by file type", () => {
    const block = { type: "attachmentList", attrs: { fileTypes: ["pdf"] } };
    const html = renderHtml(doc(block), context);
    expect(html).toContain('data-file-types="pdf"');
    expect(html).toContain(
      `<li data-attachment-id="${ID}"><a href="/api/v1/attachments/${ID}" rel="noopener noreferrer">handbook.pdf</a> <span class="ph-attachment-size">(2.5 MB)</span></li>`,
    );
    expect(html).not.toContain("budget.xlsx");
    expect(renderMarkdown(doc(block), context)).toBe(
      `- [handbook.pdf](/api/v1/attachments/${ID}) (2.5 MB)\n`,
    );
    expect(renderMarkdown(doc({ type: "attachmentList" }), { ...context, formatSize: () => "tiny" })).toBe(
      `- [handbook.pdf](/api/v1/attachments/${ID}) (tiny)\n- [budget.xlsx](/api/v1/attachments/${PAGE}) (tiny)\n`,
    );
  });

  it("says when no attachment matches", () => {
    const block = { type: "attachmentList", attrs: { fileTypes: ["docx"] } };
    expect(renderHtml(doc(block), context)).toContain('<p class="ph-listing-empty">No attachments</p>');
    expect(renderMarkdown(doc(block), context)).toBe("*No attachments*\n");
  });

  it("refuses file types with dots, upper case, duplicates or too many entries", () => {
    for (const fileTypes of [
      [".pdf"],
      ["PDF"],
      ["pdf", "pdf"],
      Array.from({ length: 21 }, (_, i) => `t${i}`),
    ]) {
      expect(() => renderHtml(doc({ type: "attachmentList", attrs: { fileTypes } }))).toThrow(
        InvalidDocumentError,
      );
    }
  });
});

describe("page report", () => {
  const block = {
    type: "pageReport",
    attrs: { spaceId: PAGE, labels: ["vpn", "network"], sort: "title", reverse: true, limit: 5 },
  };

  it("shows the label and the filters until the reader's pages are known", () => {
    expect(renderHtml(doc(block))).toBe(
      `<section class="ph-page-report" aria-label="Page report" data-space-id="${PAGE}" data-labels="vpn,network" data-sort="title" data-reverse="true" data-limit="5"><p>Page report</p></section>`,
    );
    expect(renderMarkdown(doc(block))).toBe("*Page report*\n");
  });

  it("asks for the pages with the block's filters and lists title, author and last change", () => {
    const requests: unknown[] = [];
    const pages = {
      ...context,
      pageReport: (request: unknown) => {
        requests.push(request);
        return context.pageReport?.(request as never) ?? null;
      },
    };
    const html = renderHtml(doc(block), pages);
    expect(html).toContain(
      `<tr><td><a href="/pages/${PAGE}">VPN setup</a></td><td>Anna Berger</td><td>on 2026-10-01</td></tr>`,
    );
    expect(html).toContain(
      '<td><a href="/pages/untitled">Untitled page</a></td><td>Unknown person</td><td>on 2026-09-30</td>',
    );
    expect(renderMarkdown(doc(block), pages)).toBe(
      `| Title | Author | Last changed |\n| --- | --- | --- |\n| [VPN setup](/pages/${PAGE}) | Anna Berger | on 2026-10-01 |\n| [Untitled page](/pages/untitled) | Unknown person | on 2026-09-30 |\n`,
    );
    expect(requests).toEqual([
      { spaceId: PAGE, labels: ["vpn", "network"], sort: "title", reverse: true, limit: 5 },
      { spaceId: PAGE, labels: ["vpn", "network"], sort: "title", reverse: true, limit: 5 },
    ]);
  });

  it("defaults to all spaces, the latest changes first and 20 pages", () => {
    const html = renderHtml(doc({ type: "pageReport" }));
    expect(html).toContain('data-sort="modified" data-limit="20"');
    expect(html).not.toContain("data-space-id");
    expect(html).not.toContain("data-labels");
  });

  it("says when no page matches and never links to unsafe addresses or renders markup", () => {
    expect(renderHtml(doc(block), { pageReport: () => [] })).toContain(
      '<p class="ph-listing-empty">No pages match the filters</p>',
    );
    expect(renderMarkdown(doc(block), { pageReport: () => [] })).toBe("*No pages match the filters*\n");
    const evil = {
      pageReport: () => [
        { title: "<b>x</b> | y", href: "javascript:alert(1)", author: "<i>z</i>", updatedAt: "2026-10-01" },
      ],
    };
    expect(renderHtml(doc(block), evil)).toContain(
      "<td>&lt;b&gt;x&lt;/b&gt; | y</td><td>&lt;i&gt;z&lt;/i&gt;</td>",
    );
    expect(renderMarkdown(doc(block), evil)).toContain(
      "| \\<b\\>x\\</b\\> \\| y | \\<i\\>z\\</i\\> | 2026-10-01 |",
    );
  });

  it("refuses unknown sort orders, limits outside 1 to 100 and labels that are not normalized", () => {
    for (const attrs of [
      { sort: "random" },
      { limit: 0 },
      { limit: 101 },
      { labels: ["Upper"] },
      { labels: ["two words"] },
      { labels: ["a", "a"] },
      { labels: Array.from({ length: 21 }, (_, i) => `l${i}`) },
      { spaceId: "IT" },
    ]) {
      expect(() => renderHtml(doc({ type: "pageReport", attrs }))).toThrow(InvalidDocumentError);
    }
  });
});

describe("decision report", () => {
  const block = {
    type: "decisionReport",
    attrs: { spaceId: PAGE, labels: ["vpn"], parentId: ID, order: "oldest" },
  };

  it("shows the label and the filters until the reader's decisions are known", () => {
    expect(renderHtml(doc(block))).toBe(
      `<section class="ph-decision-report" aria-label="Decision report" data-space-id="${PAGE}" data-labels="vpn" data-parent-id="${ID}" data-order="oldest"><p>Decision report</p></section>`,
    );
    expect(renderMarkdown(doc(block))).toBe("*Decision report*\n");
  });

  it("lists each decision with the page it was made on", () => {
    expect(renderHtml(doc(block), context)).toContain(
      `<ul><li><p>Use WireGuard</p><p class="ph-decision-source"><a href="/pages/${PAGE}">VPN setup</a> · on 2026-10-02</p></li></ul>`,
    );
    expect(renderMarkdown(doc(block), context)).toBe(
      `- Use WireGuard\n  [VPN setup](/pages/${PAGE}) · on 2026-10-02\n`,
    );
    expect(renderMarkdown(doc(block), { decisionReport: () => [] })).toBe(
      "*No decisions match the filters*\n",
    );
  });

  it("refuses unknown orders and parents that are not page IDs", () => {
    for (const attrs of [{ order: "random" }, { parentId: "123" }, { labels: [""] }]) {
      expect(() => renderHtml(doc({ type: "decisionReport", attrs }))).toThrow(InvalidDocumentError);
    }
  });
});

describe("task report", () => {
  const block = {
    type: "taskReport",
    attrs: { spaceId: PAGE, labels: ["vpn"], assignedToViewer: true, due: "overdue", status: "all" },
  };
  const tasks: RenderContext = {
    formatDate: (iso) => `on ${iso}`,
    taskReport: () => [
      {
        text: "Renew | certificate\nsoon",
        done: false,
        assignee: "Anna Berger",
        dueDate: "2026-10-20",
        page: { title: "VPN setup", href: `/pages/${PAGE}` },
      },
      {
        text: "Close port",
        done: true,
        assignee: null,
        dueDate: null,
        page: { title: "", href: "javascript:x" },
      },
    ],
  };

  it("shows the label until the reader's tasks are known", () => {
    expect(renderHtml(doc(block))).toContain("<p>Task report</p></div>");
    expect(renderMarkdown(doc(block))).toBe("*Task report*\n");
  });

  it("asks for the tasks with the block's filters and lists them with assignee, due date and page", () => {
    const requests: unknown[] = [];
    const html = renderHtml(doc(block), {
      ...tasks,
      taskReport: (request) => {
        requests.push(request);
        return tasks.taskReport?.(request) ?? null;
      },
    });
    expect(requests).toEqual([
      {
        spaceId: PAGE,
        seriesId: null,
        pageIds: [],
        labels: ["vpn"],
        assignee: null,
        assignedToViewer: true,
        due: "overdue",
        status: "all",
      },
    ]);
    expect(html).toContain(
      `<tr data-checked="false"><td><input type="checkbox" disabled aria-label="Open"> Renew | certificate\nsoon</td><td>Anna Berger</td><td>on 2026-10-20</td><td><a href="/pages/${PAGE}">VPN setup</a></td></tr>`,
    );
    expect(html).toContain(
      '<tr data-checked="true"><td><input type="checkbox" disabled aria-label="Done" checked> Close port</td><td></td><td></td><td>Untitled page</td></tr>',
    );
    expect(renderMarkdown(doc(block), tasks)).toBe(
      `| Task | Assigned to | Due | Page |\n| --- | --- | --- | --- |\n| [ ] Renew \\| certificate soon | Anna Berger | on 2026-10-20 | [VPN setup](/pages/${PAGE}) |\n| [x] Close port |  |  | Untitled page |\n`,
    );
  });

  it("says when no task matches", () => {
    expect(renderHtml(doc(block), { taskReport: () => [] })).toContain(
      '<p class="ph-listing-empty">No tasks match the filters</p>',
    );
    expect(renderMarkdown(doc(block), { taskReport: () => [] })).toBe("*No tasks match the filters*\n");
  });
});

describe("link addresses", () => {
  it("pass every allowed address through the context, so exports can point links elsewhere", () => {
    const document = doc(
      paragraph(text("Guide", [{ type: "link", attrs: { href: "/spaces/IT/pages/x" } }]), {
        type: "pageLink",
        attrs: { pageId: PAGE },
      }),
      { type: "image", attrs: { attachmentId: ID } },
    );
    const mapped: string[] = [];
    const href = (address: string) => {
      mapped.push(address);
      return `mapped/${encodeURIComponent(address)}`;
    };
    const html = renderHtml(document, { ...context, href });
    expect(html).toContain('href="mapped/%2Fspaces%2FIT%2Fpages%2Fx"');
    expect(html).toContain(`src="mapped/%2Fapi%2Fv1%2Fattachments%2F${ID}"`);
    expect(renderMarkdown(document, { ...context, href })).toContain(
      `[Device naming](mapped/%2Fpages%2F${PAGE})`,
    );
    expect(mapped).toContain(`/pages/${PAGE}`);
  });

  it("never pass a disallowed address to the context", () => {
    const mapped: string[] = [];
    renderHtml(
      doc(paragraph(text("x", [{ type: "link", attrs: { href: "https://example.org" } }])), {
        type: "childPages",
      }),
      {
        href: (address) => {
          mapped.push(address);
          return address;
        },
        childPages: () => [{ title: "Bad", href: "javascript:alert(1)", children: [] }],
      },
    );
    expect(mapped).toEqual(["https://example.org"]);
  });
});

describe("template button", () => {
  it("shows its label, or a default label, with the template and title pattern", () => {
    expect(
      renderHtml(
        doc({
          type: "templateButton",
          attrs: { templateId: ID, label: "New <project>", title: "Project {name}" },
        }),
      ),
    ).toBe(
      `<div class="ph-template-button" data-template-id="${ID}" data-label="New &lt;project&gt;" data-title="Project {name}"><span class="ph-template-button-label">New &lt;project&gt;</span></div>`,
    );
    expect(renderMarkdown(doc({ type: "templateButton", attrs: { templateId: "builtin:how-to" } }))).toBe(
      "*Create from template*\n",
    );
  });

  it("refuses unknown template IDs and labels over 100 characters", () => {
    for (const attrs of [
      {},
      { templateId: "how-to" },
      { templateId: "builtin:How" },
      { templateId: ID, label: "x".repeat(101) },
      { templateId: ID, title: "x".repeat(256) },
    ]) {
      expect(() => renderHtml(doc({ type: "templateButton", attrs }))).toThrow(InvalidDocumentError);
    }
  });
});
