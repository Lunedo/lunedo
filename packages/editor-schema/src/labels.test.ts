import { describe, expect, it } from "vitest";
import { type DocumentJson, type RenderContext, renderHtml, renderMarkdown, renderWord } from "./index.js";

const doc = (type: string, attrs: Record<string, unknown>): DocumentJson => ({
  type: "doc",
  content: [{ type, attrs }],
});

describe("content by label", () => {
  const document = doc("contentByLabel", { labels: ["how-to"], excerpts: true, title: "Guides" });
  const context: RenderContext = {
    contentByLabel: (request) => {
      expect(request).toEqual({
        labels: ["how-to"],
        matchAll: false,
        spaceIds: [],
        kinds: ["page", "blogPost"],
        sort: "modified",
        reverse: false,
        limit: 5,
        excerpts: true,
      });
      return [
        {
          title: "Reset a password",
          href: "/spaces/IT/pages/1/reset",
          kind: "page",
          space: "IT",
          labels: ["how-to", "accounts"],
          excerpt: "Open the portal.",
        },
      ];
    },
  };

  it("list the pages with their space, labels and excerpt", () => {
    const html = renderHtml(document, context);
    expect(html).toContain("<h3>Guides</h3>");
    expect(html).toContain('<a href="/spaces/IT/pages/1/reset">Reset a password</a>');
    expect(html).toContain("IT · how-to, accounts");
    expect(html).toContain("Open the portal.");
    expect(renderMarkdown(document, context)).toContain(
      "- [Reset a password](/spaces/IT/pages/1/reset) · IT",
    );
    expect(JSON.stringify(renderWord(document, context))).toContain("Open the portal.");
  });

  it("leave out space and labels when switched off", () => {
    const html = renderHtml(
      doc("contentByLabel", { labels: ["how-to"], showLabels: false, showSpace: false }),
      {
        contentByLabel: () => [
          { title: "A", href: "/a", kind: "blogPost", space: "IT", labels: ["how-to"], excerpt: null },
        ],
      },
    );
    expect(html).not.toContain("ph-listing-meta");
    expect(html).toContain('data-kind="blogPost"');
  });

  it("leave a placeholder for the web client", () => {
    expect(renderHtml(document)).toContain(
      'class="ph-content-by-label" aria-label="Guides" data-labels="[&quot;how-to&quot;]" data-kinds="[&quot;page&quot;,&quot;blogPost&quot;]"',
    );
  });
});

describe("related labels", () => {
  it("link the labels found together with the labels of the page", () => {
    const document = doc("relatedLabels", { labels: [], title: "See also" });
    const context: RenderContext = {
      relatedLabels: (request) => {
        expect(request).toEqual({ labels: [] });
        return [{ label: "network", href: "/spaces/IT/labels/network" }];
      },
    };
    const html = renderHtml(document, context);
    expect(html).toContain("<h3>See also</h3>");
    expect(html).toContain('<a href="/spaces/IT/labels/network">network</a>');
    expect(renderHtml(document, { relatedLabels: () => [] })).toContain("No related labels");
  });
});
