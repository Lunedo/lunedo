import { describe, expect, it } from "vitest";
import {
  type DocumentDiff,
  type DocumentJson,
  diffDocuments,
  InvalidDocumentError,
  type MarkJson,
  type NodeJson,
  type RenderContext,
  renderDiffHtml,
  renderHtml,
} from "./index.js";

const PERSON = "01929b1e-0000-7000-8000-000000000001";
const PAGE = "01929b1e-0000-7000-8000-000000000002";

function text(value: string, marks?: MarkJson[]): NodeJson {
  return { type: "text", text: value, ...(marks ? { marks } : {}) };
}

function p(...content: (string | NodeJson)[]): NodeJson {
  return {
    type: "paragraph",
    content: content.map((item) => (typeof item === "string" ? text(item) : item)),
  };
}

function heading(level: number, value: string): NodeJson {
  return { type: "heading", attrs: { level }, content: [text(value)] };
}

function row(...cells: string[]): NodeJson {
  return { type: "tableRow", content: cells.map((value) => ({ type: "tableCell", content: [p(value)] })) };
}

function doc(...content: NodeJson[]): DocumentJson {
  return { type: "doc", content };
}

function compare(before: NodeJson[], after: NodeJson[]): DocumentDiff {
  return diffDocuments(
    { title: "Page", document: doc(...before) },
    { title: "Page", document: doc(...after) },
  );
}

describe("renderDiffHtml", () => {
  it("renders an unchanged document like the read view in every view", () => {
    const blocks = [
      heading(1, "Intro"),
      p("Hello ", text("world", [{ type: "bold" }])),
      { type: "tableOfContents" },
    ];
    const diff = compare(blocks, blocks);
    const expected = renderHtml(doc(...blocks));
    expect(renderDiffHtml(diff, "inline")).toBe(expected);
    expect(renderDiffHtml(diff, "before")).toBe(expected);
    expect(renderDiffHtml(diff, "after")).toBe(expected);
  });

  it("marks added, removed and formatted text in the inline view", () => {
    const diff = compare([p("a quick fox and dog")], [p("a slow fox and ", text("dog", [{ type: "bold" }]))]);
    expect(renderDiffHtml(diff, "inline")).toBe(
      '<div class="ph-diff-block" data-change="changed"><p>a <del class="ph-diff-removed">quick</del><ins class="ph-diff-added">slow</ins> fox and <span class="ph-diff-formatted"><strong>dog</strong></span></p></div>',
    );
  });

  it("shows only the before side with removals in the before view", () => {
    const diff = compare([p("a quick fox and dog")], [p("a slow fox and ", text("dog", [{ type: "bold" }]))]);
    expect(renderDiffHtml(diff, "before")).toBe(
      '<div class="ph-diff-block" data-change="changed"><p>a <del class="ph-diff-removed">quick</del> fox and <span class="ph-diff-formatted">dog</span></p></div>',
    );
  });

  it("shows only the after side with additions in the after view", () => {
    const diff = compare([p("one"), p("gone away")], [p("one"), p("brand new")]);
    expect(renderDiffHtml(diff, "after")).toBe(
      '<p>one</p><div class="ph-diff-block" data-change="added"><p>brand new</p></div>',
    );
    expect(renderDiffHtml(diff, "before")).toBe(
      '<p>one</p><div class="ph-diff-block" data-change="removed"><p>gone away</p></div>',
    );
  });

  it("wraps whole blocks and marks moved blocks at their new position", () => {
    const diff = compare([p("first"), p("second")], [p("second"), p("first")]);
    expect(renderDiffHtml(diff, "inline")).toBe(
      '<p>second</p><div class="ph-diff-block" data-change="moved"><span class="ph-diff-note">Moved</span><p>first</p></div>',
    );
  });

  it("lists changed attributes in a note with default or custom labels", () => {
    const diff = compare([heading(1, "Intro")], [heading(2, "Intro")]);
    expect(renderDiffHtml(diff, "inline")).toBe(
      '<div class="ph-diff-block" data-change="changed"><span class="ph-diff-note">Changed: level</span><h2 id="intro">Intro</h2></div>',
    );
    expect(renderDiffHtml(diff, "before", {}, { labels: { attributes: "Geändert: {names} <b>" } })).toContain(
      '<span class="ph-diff-note">Geändert: level &lt;b&gt;</span><h1 id="intro">Intro</h1>',
    );
  });

  it("escapes added text", () => {
    const diff = compare([p("safe")], [p("safe <script>alert(1)</script>")]);
    for (const view of ["inline", "after"] as const) {
      const html = renderDiffHtml(diff, view);
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;alert");
    }
  });

  it("renders mentions, page links and placeholders through the context", () => {
    const context: RenderContext = {
      mention: () => ({ name: "Ann <Admin>" }),
      pageLink: () => ({ href: "/pages/plan", title: "Plan", accessible: true }),
      showPlaceholders: true,
    };
    const diff = compare(
      [p("Please ask the team")],
      [
        p(
          "Please ask the team ",
          { type: "mention", attrs: { id: PERSON } },
          " ",
          { type: "pageLink", attrs: { pageId: PAGE } },
          " ",
          { type: "placeholder", attrs: { text: "Fill in" } },
        ),
      ],
    );
    const html = renderDiffHtml(diff, "inline", context);
    expect(html).toContain("@Ann &lt;Admin&gt;");
    expect(html).toContain('href="/pages/plan"');
    expect(html).toContain('<span class="ph-placeholder">Fill in</span>');
    expect(html).toMatch(/<ins class="ph-diff-added">.*ph-mention.*<\/ins>/);
  });

  it("marks table rows and cells in place", () => {
    const table = (...rows: NodeJson[]): NodeJson => ({ type: "table", content: rows });
    const diff = compare([table(row("a", "b"))], [table(row("a", "x", "b"), row("c", "y", "d"))]);
    const html = renderDiffHtml(diff, "inline");
    expect(html).toContain('<td data-change="added"><p>x</p></td>');
    expect(html).toContain('<tr data-change="added">');
    expect(html.slice(html.indexOf("<tbody>"))).not.toContain("ph-diff-block");
    expect(html.startsWith('<div class="ph-diff-block" data-change="changed"><div class="ph-table">')).toBe(
      true,
    );
  });

  it("puts notes of in-place blocks inside the element", () => {
    const tasks = (dueDate: string | null): NodeJson => ({
      type: "taskList",
      content: [{ type: "taskItem", attrs: { dueDate }, content: [p("Ship")] }],
    });
    const html = renderDiffHtml(compare([tasks(null)], [tasks("2026-10-12")]), "inline");
    expect(html).toContain(
      '<li data-change="changed" class="ph-task-item" data-checked="false" data-due-date="2026-10-12"><input type="checkbox" disabled aria-label="Open"><div><span class="ph-diff-note">Changed: dueDate</span><p>Ship</p><span class="ph-task-meta"><time class="ph-task-due" datetime="2026-10-12">2026-10-12</time></span></div></li>',
    );
  });

  it("marks changed code lines", () => {
    const code = (value: string): NodeJson => ({
      type: "codeBlock",
      attrs: { language: "javascript" },
      content: [text(value)],
    });
    const diff = compare([code("a\n<b>")], [code("a\nc")]);
    expect(renderDiffHtml(diff, "inline")).toBe(
      '<div class="ph-diff-block" data-change="changed"><pre class="ph-code-block" data-language="javascript"><code class="hljs language-javascript">a\n<del class="ph-diff-removed">&lt;b&gt;</del>\n<ins class="ph-diff-added">c</ins></code></pre></div>',
    );
    expect(renderDiffHtml(diff, "after")).toContain("a\n<ins");
    expect(renderDiffHtml(diff, "after")).not.toContain("<del");
  });

  it("renders formula changes", () => {
    const diff = compare(
      [{ type: "blockMath", attrs: { latex: "a^2" } }],
      [{ type: "blockMath", attrs: { latex: "b^2" } }],
    );
    expect(renderDiffHtml(diff, "inline")).toContain(
      '<span class="ph-diff-note">Changed: latex</span><div class="ph-math ph-math-block" data-latex="b^2">',
    );
    expect(renderDiffHtml(diff, "before")).toContain('data-latex="a^2"');
  });

  it("gives headings the ids of the rendered side", () => {
    const diff = compare([heading(1, "Old"), p("x")], [heading(1, "New"), p("x")]);
    expect(renderDiffHtml(diff, "after")).toContain('<h1 id="new">');
    expect(renderDiffHtml(diff, "before")).toContain('<h1 id="old">');
  });

  it("rejects invalid nodes in a diff", () => {
    const diff: DocumentDiff = {
      title: null,
      changes: 1,
      blocks: [
        {
          change: "added",
          type: "heading",
          before: null,
          after: { type: "heading", attrs: { level: '1 onclick="x"' }, content: [text("a")] },
          attributes: [],
        },
      ],
    };
    expect(() => renderDiffHtml(diff, "inline")).toThrow(InvalidDocumentError);
  });
});
