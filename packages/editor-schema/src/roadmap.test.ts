import { describe, expect, it } from "vitest";
import {
  type DocumentJson,
  plainText,
  type Roadmap,
  renderHtml,
  renderMarkdown,
  renderWord,
  validateDocument,
} from "./index.js";

const PAGE = "01929b1e-0000-7000-8000-000000000004";
const HIDDEN = "01929b1e-0000-7000-8000-000000000005";

const roadmap: Roadmap = {
  title: "Network upgrade",
  start: "2027-01-01",
  end: "2027-06-30",
  lanes: [
    {
      title: "Core",
      color: "blue",
      bars: [
        {
          title: "Order switches for the core network",
          description: "Six switches",
          start: "2027-01-15",
          end: "2027-02-10",
          row: 0,
          pageId: PAGE,
        },
        { title: "Cabling", description: "", start: "2027-02-01", end: "2027-03-31", row: 1, pageId: HIDDEN },
      ],
    },
  ],
  markers: [
    { title: "Go-live", date: "2027-04-01" },
    { title: "Outside", date: "2028-01-01" },
  ],
};

const document: DocumentJson = { type: "doc", content: [{ type: "roadmap", attrs: { roadmap } }] };

const context = {
  pageLink: (link: { pageId: string | null }) =>
    link.pageId === PAGE
      ? { href: `/spaces/IT/pages/${PAGE}/order`, title: "Order", accessible: true }
      : { href: "", title: "", accessible: false },
};

describe("roadmap blocks", () => {
  it("draw lanes, bars, markers and months as SVG", () => {
    const html = renderHtml(document, context);
    expect(html).toContain(
      '<svg xmlns="http://www.w3.org/2000/svg" class="ph-roadmap-image" viewBox="0 0 960',
    );
    expect(html).toContain('class="ph-roadmap-lane" data-color="blue"');
    expect(html).toContain(">2027-01</text>");
    expect(html).toContain("Go-live");
    expect(html.slice(0, html.indexOf("</svg>"))).not.toContain("Outside");
    expect(html).toContain("Imported roadmap. Roadmaps can be edited once planning is available.");
  });

  it("shorten long bar titles and keep the full title as tooltip", () => {
    const html = renderHtml(document, context);
    expect(html).toContain(
      "<title>Order switches for the core network\n2027-01-15 – 2027-02-10\nSix switches</title>",
    );
    expect(html).toMatch(/class="ph-roadmap-bar-title"[^>]*>[^<]*…<\/text>/);
  });

  it("link bars only to pages the viewer can read", () => {
    const html = renderHtml(document, context);
    expect(html).toContain(`<a href="/spaces/IT/pages/${PAGE}/order" class="ph-roadmap-link">`);
    expect(html.match(/ph-roadmap-link/g)).toHaveLength(1);
    expect(html).toContain('<details class="ph-roadmap-list"><summary>Show as list</summary>');
  });

  it("write colors from the palette when asked, for Word", () => {
    const word = renderWord(document, { ...context, svgPalette: (color, role) => `#${color}-${role}` });
    const image = word.find((block) => block.type === "svg");
    expect(image).toMatchObject({ type: "svg", alt: "Network upgrade", width: 960 });
    expect(image?.type === "svg" ? image.svg : "").toContain('fill="#blue-background"');
    expect(renderHtml(document, context)).not.toContain('fill="#');
  });

  it("render a readable list in Markdown and add its text to search", () => {
    const markdown = renderMarkdown(document, context);
    expect(markdown).toContain(`  - [Order switches for the core network](/spaces/IT/pages/${PAGE}/order)`);
    expect(markdown).toContain("  - Cabling (2027-02-01 – 2027-03-31)");
    expect(plainText(document)).toContain("Six switches");
  });

  it("refuse inconsistent roadmaps", () => {
    const invalid = (change: Partial<Roadmap>) =>
      !validateDocument({
        type: "doc",
        content: [{ type: "roadmap", attrs: { roadmap: { ...roadmap, ...change } } }],
      }).ok;
    expect(invalid({ end: "2026-01-01" })).toBe(true);
    expect(invalid({ end: "2040-01-01" })).toBe(true);
    expect(invalid({ lanes: [] })).toBe(true);
    expect(
      invalid({
        lanes: [
          {
            title: "x",
            color: "blue",
            bars: [
              { title: "x", description: "", start: "2027-01-01", end: "2027-01-02", row: 20, pageId: null },
            ],
          },
        ],
      }),
    ).toBe(true);
  });
});
