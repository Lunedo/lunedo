import { describe, expect, it } from "vitest";
import {
  type DocumentJson,
  excerptContent,
  extractSections,
  type IncludedContent,
  type IncludeRequest,
  type NodeJson,
  type RenderContext,
  renderHtml,
  renderMarkdown,
  renderWord,
  validateDocument,
} from "./index.js";

const PAGE = "01929b1e-0000-7000-8000-000000000004";
const PERSON = "01929b1e-0000-7000-8000-000000000010";

const text = (value: string) => ({ type: "text", text: value });
const paragraph = (...content: NodeJson[]) => ({ type: "paragraph", content });
const doc = (...content: NodeJson[]): DocumentJson => ({ type: "doc", content });

const includeExcerpt = (attrs: Record<string, unknown>) => doc({ type: "includeExcerpt", attrs });
const includePage = (attrs: Record<string, unknown>) => doc({ type: "includePage", attrs });

const source = doc(
  { type: "heading", attrs: { level: 2 }, content: [text("Contacts")] },
  paragraph({ type: "mention", attrs: { id: PERSON } }),
);

function including(result: IncludedContent | null, seen: IncludeRequest[] = []): RenderContext {
  return {
    include: (request) => {
      seen.push(request);
      return result;
    },
  };
}

const visible: IncludedContent = {
  state: "visible",
  title: "Runbook",
  href: `/spaces/IT/pages/${PAGE}/runbook`,
  document: source,
  context: { mention: (id) => (id === PERSON ? { name: "Anna Berger" } : null) },
};

describe("include blocks", () => {
  it("render the included content with the context of the included page", () => {
    const seen: IncludeRequest[] = [];
    const html = renderHtml(includePage({ pageId: PAGE }), including(visible, seen));
    expect(seen).toEqual([
      { pageId: PAGE, sourceSpace: null, sourceTitle: null, excerpt: false, name: null },
    ]);
    expect(html).toContain('<div class="ph-include"');
    expect(html).toContain('id="included-1-contacts"');
    expect(html).toContain("@Anna Berger");
    expect(html).not.toContain("Runbook");
  });

  it("show the title of an included excerpt in its panel", () => {
    const seen: IncludeRequest[] = [];
    const document = includeExcerpt({ pageId: PAGE, name: "contacts" });
    const html = renderHtml(document, including(visible, seen));
    expect(seen[0]).toMatchObject({ excerpt: true, name: "contacts" });
    expect(html).toContain(`<a href="/spaces/IT/pages/${PAGE}/runbook">Runbook</a>`);
    const word = renderWord(document, including(visible));
    expect(word[0]).toMatchObject({ type: "box", variant: "neutral" });
    expect(JSON.stringify(word)).toContain("@Anna Berger");
    expect(renderMarkdown(document, including(visible))).toContain("**[Runbook]");
    const plain = renderHtml(includeExcerpt({ pageId: PAGE, panel: false }), including(visible));
    expect(plain).not.toContain("Runbook");
  });

  it("show nothing to readers for a page they cannot read and a placeholder without title to editors", () => {
    const hidden: IncludedContent = { state: "hidden" };
    const document = includePage({ pageId: PAGE });
    expect(renderHtml(document, including(hidden))).toBe("");
    expect(renderWord(document, including(hidden))).toEqual([]);
    expect(renderMarkdown(document, including(hidden))).toBe("");
    const editor = renderHtml(document, { ...including(hidden), showPlaceholders: true });
    expect(editor).toContain("Restricted content");
    const missing = includePage({ sourceSpace: "OPS", sourceTitle: "Escalation" });
    expect(renderHtml(missing, { ...including(hidden), showPlaceholders: true })).toContain(
      "The included page Escalation was not part of the import.",
    );
  });

  it("stop loops and deep nesting with a message for everyone", () => {
    const document = includePage({ pageId: PAGE });
    expect(renderHtml(document, including({ state: "loop" }))).toContain("would include itself");
    expect(renderHtml(document, including({ state: "depth" }))).toContain("nested too deeply");
    expect(renderHtml(includeExcerpt({ pageId: PAGE }), including({ state: "noExcerpt" }))).toContain(
      "has no excerpt",
    );
  });

  it("leave a placeholder for the web client without include data", () => {
    const html = renderHtml(includeExcerpt({ pageId: PAGE, name: "contacts", panel: false }));
    expect(html).toBe(
      `<div class="ph-include ph-include-excerpt" data-page-id="${PAGE}" data-name="contacts" data-panel="false"><p>Included excerpt</p></div>`,
    );
  });

  it("need a page or an imported title, not both", () => {
    expect(validateDocument(includePage({})).ok).toBe(true);
    expect(validateDocument(includePage({ pageId: PAGE, sourceTitle: "Runbook" })).ok).toBe(false);
    expect(validateDocument(includePage({ sourceSpace: "OPS" })).ok).toBe(false);
    expect(validateDocument(includeExcerpt({ pageId: PAGE, name: " contacts" })).ok).toBe(false);
  });

  it("keep included content out of the text of the including page", () => {
    const sections = extractSections(
      doc(paragraph(text("Own text")), { type: "includePage", attrs: { pageId: PAGE } }),
    );
    expect(sections).toEqual([{ heading: null, text: "Own text" }]);
  });
});

describe("excerpts", () => {
  const page = doc(
    paragraph(text("Intro")),
    { type: "excerpt", attrs: { name: null }, content: [paragraph(text("Short version"))] },
    { type: "excerpt", attrs: { name: "contacts", hidden: true }, content: [paragraph(text("Call us"))] },
  );

  it("find the first excerpt or the one with the given name", () => {
    expect(excerptContent(page, null)).toEqual([paragraph(text("Short version"))]);
    expect(excerptContent(page, "contacts")).toEqual([paragraph(text("Call us"))]);
    expect(excerptContent(page, "missing")).toBeNull();
  });

  it("show visible excerpts as part of the page and hide hidden ones", () => {
    const html = renderHtml(page);
    expect(html).toContain("Short version");
    expect(html).not.toContain("Call us");
    expect(renderHtml(page, { showPlaceholders: true })).toContain('data-name="contacts" data-hidden="true"');
  });

  it("are indexed on their own page, also when hidden", () => {
    expect(extractSections(page)).toEqual([{ heading: null, text: "Intro\nShort version\nCall us" }]);
  });

  it("cannot contain another excerpt", () => {
    const nested = doc({
      type: "excerpt",
      content: [{ type: "excerpt", content: [paragraph(text("x"))] }],
    });
    expect(validateDocument(nested).ok).toBe(false);
  });
});
