import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PortalCategory } from "../reader.js";
import { portalCss } from "./assets.js";
import { PORTAL_ICONS, portalIconByName } from "./brand-icon.js";
import { html, raw } from "./html.js";
import {
  ancestorsOf,
  brandStyle,
  decorateArticleHtml,
  favicon,
  folderTrail,
  initialOf,
  introduction,
  mailto,
  shortenPath,
} from "./views.js";

function category(): PortalCategory {
  return {
    id: "category",
    parentId: null,
    level: 1,
    title: "Category",
    description: "",
    icon: null,
    contactEmail: null,
    restricted: false,
    articles: 1,
  };
}

function categories(count: number): PortalCategory[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `category-${index + 1}`,
    parentId: null,
    level: 1,
    title: `Category ${index + 1}`,
    description: "",
    icon: null,
    contactEmail: null,
    restricted: false,
    articles: 1,
  }));
}

describe("folders of any depth in the portal", () => {
  const folders: PortalCategory[] = [
    ...categories(2),
    { ...category(), id: "ms", parentId: "category-1", level: 2, title: "Microsoft" },
    { ...category(), id: "outlook", parentId: "ms", level: 3, title: "Outlook" },
    { ...category(), id: "web", parentId: "outlook", level: 4, title: "Web App" },
  ];

  it("walks up to the area and keeps the folder path in order", () => {
    const web = folders.find((folder) => folder.id === "web");
    expect(web && ancestorsOf(folders, web).map((folder) => folder.title)).toEqual([
      "Category 1",
      "Microsoft",
      "Outlook",
      "Web App",
    ]);
    expect(folderTrail(folders, ["category-1", "hidden", "outlook"]).map((folder) => folder.id)).toEqual([
      "category-1",
      "outlook",
    ]);
  });

  it("shortens long paths in the middle", () => {
    expect(shortenPath(["IT", "Microsoft"])).toBe("IT › Microsoft");
    expect(shortenPath(["IT", "Microsoft", "Outlook"])).toBe("IT › Microsoft › Outlook");
    expect(shortenPath(["IT", "Microsoft", "Outlook", "Web App"])).toBe("IT › … › Outlook › Web App");
  });

  it("renders the formatted introduction with escaped text and only safe links", () => {
    expect(introduction("Use **VPN** <b>now</b>\n\n> Note [x](javascript:alert(1))").value).toBe(
      '<p>Use <strong>VPN</strong> &lt;b&gt;now&lt;/b&gt;</p><div class="callout">Note [x](javascript:alert(1))</div>',
    );
  });

  it("switches the brand color with the chosen appearance as well as with the system", () => {
    const style = brandStyle("#0B6F78", "#5BC0C8");
    expect(style).toContain(":root{--kb:#0B6F78}");
    expect(style).toContain(":root:not([data-theme=light]){--kb:#5BC0C8}");
    expect(style).toContain(":root[data-theme=dark]{--kb:#5BC0C8}");
    expect(portalCss).toContain(":root[data-theme=dark]{color-scheme:dark;");
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
      '<section class="ld-section" data-section="steps" data-icon="wrench" data-framed="true"><h2 id="steps">Steps</h2><a href="/__portal__/12">x</a></section>';
    const decorated = decorateArticleHtml(markup, "/help/it");
    expect(decorated).toContain('href="/help/it/12"');
    expect(decorated).toContain('<h2 id="steps"><span class="hb" aria-hidden="true"><svg');
    expect(decorateArticleHtml(markup.replace("wrench", "unknown-icon"), "")).not.toContain('class="hb"');
  });
});

describe("the language choice of the portal", () => {
  it("hides the browser's disclosure marker and marks the current language", () => {
    expect(portalCss).toContain(".dd summary::-webkit-details-marker{display:none}");
    expect(portalCss).toContain(".dd summary{list-style:none;");
    expect(portalCss).toContain('.dd.lang .menu a[aria-current="true"]{font-weight:600}');
  });
});

describe("the favicon of the portal", () => {
  const assets = { style: "/help/_assets/portal-1.css", script: "/help/_assets/portal-1.js", theme: "" };

  it("uses the logo of the knowledge base when one is set", () => {
    const icon = favicon({ logoUrl: "/help/acme/_logo/3", assets }).value;
    expect(icon).toBe('<link rel="icon" href="/help/acme/_logo/3">');
  });

  it("uses the Lunedo favicon, which follows light and dark itself, with the icon file as fallback otherwise", () => {
    const icon = favicon({ logoUrl: null, assets }).value;
    expect(icon).toBe(
      '<link rel="icon" href="/help/_assets/favicon.ico" sizes="48x48"><link rel="icon" href="/help/_assets/favicon.svg" type="image/svg+xml">',
    );
  });

  it("ships the same favicon files as the web client", () => {
    for (const name of Object.values(PORTAL_ICONS)) {
      const shipped = readFileSync(
        fileURLToPath(new URL(`../../../../../apps/web/public/${name}`, import.meta.url)),
      );
      expect(portalIconByName(name)?.data.equals(shipped)).toBe(true);
    }
    expect(portalIconByName("favicon.svg")?.type).toBe("image/svg+xml");
    expect(portalIconByName("favicon.svg")?.data.toString("utf8")).toContain("prefers-color-scheme:dark");
    expect(portalIconByName("favicon.ico")?.type).toBe("image/x-icon");
    expect(portalIconByName("../favicon.svg")).toBeNull();
    expect(portalIconByName("hasOwnProperty")).toBeNull();
  });
});
