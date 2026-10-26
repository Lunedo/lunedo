import { describe, expect, it } from "vitest";
import {
  type DocumentJson,
  extractPageLinks,
  internalItemLink,
  type RenderContext,
  renderHtml,
  renderMarkdown,
} from "./index.js";

const VISIBLE = "01929b1e-0000-7000-8000-00000000000a";
const HIDDEN = "01929b1e-0000-7000-8000-00000000000b";

function linked(href: string, text = "Runbook"): DocumentJson {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text, marks: [{ type: "link", attrs: { href } }] }],
      },
    ],
  };
}

const context: RenderContext = {
  pageLink: (link) =>
    link.pageId === VISIBLE
      ? { href: "/spaces/OPS/pages/4711/runbook", title: "Runbook", accessible: true }
      : { href: "", title: "", accessible: false },
};

describe("internal item links in link marks", () => {
  it("recognises item addresses with an ID and keeps the anchor", () => {
    expect(internalItemLink(`/spaces/OPS/pages/${VISIBLE}/old-title#setup`)).toEqual({
      itemId: VISIBLE,
      fragment: "#setup",
    });
    expect(internalItemLink(`/spaces/OPS/blog/${VISIBLE}`)).toEqual({ itemId: VISIBLE, fragment: "" });
    expect(internalItemLink(`/shared/${VISIBLE.toUpperCase()}/x?edit=true`)).toEqual({
      itemId: VISIBLE,
      fragment: "",
    });
    expect(internalItemLink("/spaces/OPS/pages/4711/runbook")).toBeNull();
    expect(internalItemLink(`https://example.org/spaces/OPS/pages/${VISIBLE}`)).toBeNull();
    expect(internalItemLink(`/spaces/OPS/settings/${VISIBLE}`)).toBeNull();
  });

  it("renders the current address of the target with the anchor", () => {
    const document = linked(`/spaces/OLD/pages/${VISIBLE}/old-title#setup`);
    expect(renderHtml(document, context)).toContain('href="/spaces/OPS/pages/4711/runbook#setup"');
    expect(renderMarkdown(document, context)).toContain("[Runbook](/spaces/OPS/pages/4711/runbook#setup)");
  });

  it("renders a link to content the reader cannot see as plain text without its address", () => {
    const document = linked(`/spaces/HR/pages/${HIDDEN}/salary-bands`, "Bands");
    const html = renderHtml(document, context);
    expect(html).toContain("Bands");
    expect(html).not.toContain("href");
    expect(html).not.toContain("salary-bands");
    expect(renderMarkdown(document, {})).not.toContain(HIDDEN);
  });

  it("leaves other links unchanged", () => {
    expect(renderHtml(linked("https://example.org/a"), context)).toContain('href="https://example.org/a"');
    expect(renderHtml(linked("/spaces/OPS/pages/4711/runbook"), context)).toContain(
      'href="/spaces/OPS/pages/4711/runbook"',
    );
  });

  it("counts link marks to items as page links", () => {
    const links = extractPageLinks(linked(`/spaces/OPS/pages/${VISIBLE}/x`));
    expect(links).toEqual([{ pageId: VISIBLE, spaceId: null, title: null }]);
  });
});
