import type { PortalCategory } from "@pagehall/server";
import { describe, expect, it } from "vitest";
import { html, raw } from "./html.js";
import { decorateArticleHtml, initialOf, mailto, topBar } from "./views.js";

function categories(count: number): PortalCategory[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `category-${index + 1}`,
    parentId: null,
    level: 1,
    title: `Category ${index + 1}`,
    description: "",
    icon: null,
    contactEmail: null,
    articles: 1,
  }));
}

describe("the top bar of the portal", () => {
  it("shows three categories as they are", () => {
    const bar = topBar(categories(3), 10);
    expect(bar.links.map((entry) => entry.title)).toEqual(["Category 1", "Category 2", "Category 3"]);
    expect(bar.more).toEqual([]);
    expect(bar.collapsed).toBe(false);
  });

  it("shows five of six categories and puts the sixth under all topics", () => {
    const bar = topBar(categories(6), 10);
    expect(bar.links).toHaveLength(5);
    expect(bar.more.map((entry) => entry.title)).toEqual(["Category 6"]);
    expect(bar.collapsed).toBe(false);
  });

  it("shows only the topics menu from the configured number of categories on", () => {
    const bar = topBar(categories(12), 10);
    expect(bar.links).toEqual([]);
    expect(bar.more).toHaveLength(12);
    expect(bar.collapsed).toBe(true);
    expect(topBar(categories(6), 6).collapsed).toBe(true);
  });

  it("ignores subcategories", () => {
    const list = [
      ...categories(2),
      { ...categories(1)[0], id: "sub", parentId: "category-1", level: 2 } as PortalCategory,
    ];
    expect(topBar(list, 10).links).toHaveLength(2);
  });
});

describe("portal markup", () => {
  it("uses short names whole and otherwise the first letter as initial", () => {
    expect(initialOf("IT")).toBe("IT");
    expect(initialOf("academy")).toBe("A");
    expect(initialOf("Öffentlichkeit")).toBe("Ö");
  });

  it("composes mail links with an encoded subject and body", () => {
    expect(
      mailto("it@example.org", "Help article: VPN & Wi-Fi", "Article: https://x/1\n\nMy question:\n"),
    ).toBe(
      "mailto:it@example.org?subject=Help%20article%3A%20VPN%20%26%20Wi-Fi&body=Article%3A%20https%3A%2F%2Fx%2F1%0A%0AMy%20question%3A%0A",
    );
    expect(mailto("help@example.org", "Frage")).toBe("mailto:help@example.org?subject=Frage");
  });

  it("escapes values and keeps raw markup only where asked", () => {
    expect(html`<p title="${'"x"'}">${"<b>"}${raw("<i>")}</p>`.value).toBe(
      '<p title="&quot;x&quot;">&lt;b&gt;<i></p>',
    );
  });

  it("points pre-rendered links to the portal base and adds section icons", () => {
    const markup =
      '<section class="ph-section" data-section="steps" data-icon="wrench" data-framed="true"><h2 id="steps">Steps</h2><a href="/__portal__/12">x</a></section>';
    const decorated = decorateArticleHtml(markup, "/help/it");
    expect(decorated).toContain('href="/help/it/12"');
    expect(decorated).toContain('<h2 id="steps"><span class="hb" aria-hidden="true"><svg');
    expect(decorateArticleHtml(markup.replace("wrench", "unknown-icon"), "")).not.toContain('class="hb"');
  });
});
