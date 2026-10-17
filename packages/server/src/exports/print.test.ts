import { describe, expect, it } from "vitest";
import { defaultExportOptions, type ExportOptions } from "./options.js";
import { type PrintPage, printHtml } from "./print.js";
import { exportTexts } from "./texts.js";

function page(id: string, title: string, overrides: Partial<PrintPage> = {}): PrintPage {
  return {
    id,
    depth: 0,
    title,
    path: ["IT", "Network"],
    meta: ["Anna Weber · Published version 8 of 12 Oct 2026"],
    body: `<h1 id="uplink">Uplink</h1><nav class="ph-toc"><a href="#uplink">Uplink</a></nav><p><a href="#ph-page-b">Vienna</a></p>`,
    headings: [{ level: 1, text: "Uplink", id: "uplink" }],
    comments: [],
    ...overrides,
  };
}

function print(pages: PrintPage[], options: Partial<ExportOptions> = {}, language: "en" | "de" = "en") {
  return printHtml({
    language,
    title: pages.length === 1 ? (pages[0]?.title ?? "") : "Network",
    path: ["IT"],
    exported: "Exported on 16 Oct 2026 by Anna <Weber>",
    options: { ...defaultExportOptions, ...options },
    texts: exportTexts(language),
    pages,
    attachments: [{ name: "plan.pdf", page: "Graz", size: "48 KB" }],
  });
}

describe("print-ready HTML", () => {
  it("sets the paper size and orientation", () => {
    expect(print([page("a", "Graz")])).toContain("@page{size:A4 portrait;");
    expect(print([page("a", "Graz")], { paper: "letter", orientation: "landscape" })).toContain(
      "@page{size:letter landscape;",
    );
  });

  it("adds a running header and a footer with the exporter and page numbers", () => {
    const html = print([page("a", "Graz")]);
    expect(html).toContain('@top-left{content:string(ph-path) " \\203A  " string(ph-title);');
    expect(html).toContain('@bottom-left{content:"Exported on 16 Oct 2026 by Anna <Weber>";');
    expect(html).toContain('@bottom-right{content:"Page " counter(page) " of " counter(pages);');
    expect(html).toContain("@page :first{@top-left{content:none}}");
    expect(print([page("a", "Graz")], {}, "de")).toContain(
      'content:"Seite " counter(page) " von " counter(pages)',
    );
  });

  it("escapes text in the footer, the title block and the contents", () => {
    const html = print([page("a", 'Graz "<b>"', { path: ["IT", "<i>Net</i>"] })]);
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<i>Net</i>");
    expect(html).toContain("&lt;i&gt;Net&lt;/i&gt;");
    expect(print([page("a", "Graz")], {}).match(/"Exported[^"]*"/)?.[0]).toBe(
      '"Exported on 16 Oct 2026 by Anna <Weber>"',
    );
  });

  it("shows the title block of a single page with its headings as contents and starts the content on a new sheet", () => {
    const html = print([page("a", "Graz")]);
    expect(html).toContain('<p class="ph-path">IT › Network</p><h1 class="ph-page-title">Graz</h1>');
    expect(html).toContain('<p class="ph-meta">Anna Weber · Published version 8 of 12 Oct 2026</p>');
    expect(html).toContain(
      '<li data-level="0"><a href="#p0-uplink"><span class="ph-entry">Uplink</span></a></li>',
    );
    expect(html).toContain('<article class="ph-print-page" id="ph-page-a">');
    expect(html).toContain('<h1 id="p0-uplink">Uplink</h1>');
    expect(html).toContain('<a href="#p0-uplink">Uplink</a>');
  });

  it("prints a single page without contents on the first sheet", () => {
    const html = print([page("a", "Graz")], { contents: false, attachments: false });
    expect(html).not.toContain('<nav class="ph-contents"');
    expect(html).not.toContain('class="ph-print-page"');
    expect(html).toContain('<article id="ph-page-a"><div class="ph-front">');
  });

  it("starts every page of several on a new sheet and lists them in the contents", () => {
    const html = print([page("a", "Graz"), page("b", "Vienna", { depth: 1 })]);
    expect(html.match(/<article class="ph-print-page"/g)).toHaveLength(2);
    expect(html).toContain('<h1 class="ph-document-title">Network</h1>');
    expect(html).toContain(
      '<li data-level="0"><a href="#ph-page-a"><span class="ph-entry">Graz</span></a></li>',
    );
    expect(html).toContain(
      '<li data-level="1"><a href="#ph-page-b"><span class="ph-entry">Vienna</span></a></li>',
    );
    expect(html).toContain(".ph-contents a::after{content:target-counter(attr(href url),page)}");
    expect(html).toContain(".ph-print-page,.ph-appendix{break-before:page}");
    expect(html).toContain('<h1 id="p0-uplink">Uplink</h1>');
    expect(html).toContain('<h1 id="p1-uplink">Uplink</h1>');
    expect(html).toContain('<a href="#ph-page-b">Vienna</a>');
  });

  it("adds the attachment appendix and comments only when asked", () => {
    const commented = page("a", "Graz", {
      comments: [
        {
          quote: "uplink",
          author: "Lukas Hofer",
          date: "12 Oct 2026 10:00",
          body: "<p>Is this 10G?</p>",
          replies: [{ author: "Anna Weber", date: "12 Oct 2026 11:00", body: "<p>Yes</p>" }],
        },
      ],
    });
    const full = print([commented], { comments: true, attachments: true });
    expect(full).toContain('<section class="ph-appendix" id="ph-appendix"><h2>Appendix: attachments</h2>');
    expect(full).toContain("<td>plan.pdf</td><td>Graz</td><td>48 KB</td>");
    expect(full).toContain('<p class="ph-comment-quote">On “uplink”</p>');
    expect(full).toContain("<p>Is this 10G?</p>");
    expect(full).toContain(
      '<div class="ph-comment-reply"><p class="ph-comment-meta">Anna Weber · 12 Oct 2026 11:00</p><p>Yes</p></div>',
    );
    const plain = print([commented], { comments: false, attachments: false });
    expect(plain).not.toContain('<section class="ph-appendix"');
    expect(plain).not.toContain("Is this 10G?");
  });

  it("has no scripts and prints in light colors", () => {
    const html = print([page("a", "Graz")]);
    expect(html).not.toMatch(/<script|<link/);
    expect(html).toContain(":root{color-scheme:light;");
    expect(html).not.toContain("prefers-color-scheme");
  });
});
