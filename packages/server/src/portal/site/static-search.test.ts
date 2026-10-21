import { runInNewContext } from "node:vm";
import MiniSearch from "minisearch";
import { describe, expect, it } from "vitest";
import { staticSearchScript } from "./assets.js";
import { STATIC_SEARCH_OPTIONS } from "./static-site.js";

class FakeElement {
  dataset: Record<string, string> = {};
  hidden = true;
  textContent = "";
  className = "";
  href = "";
  value = "";
  lang = "";
  children: (FakeElement | string)[] = [];
  readonly parts = new Map<string, FakeElement>();

  constructor(readonly tag: string) {}

  querySelector(selector: string): FakeElement | null {
    return this.parts.get(selector) ?? null;
  }

  replaceChildren(...children: FakeElement[]) {
    this.children = children;
  }

  append(...children: (FakeElement | string)[]) {
    for (const child of children) {
      if (child instanceof FakeElement && child.tag === "#fragment") this.children.push(...child.children);
      else this.children.push(child);
    }
  }

  get text(): string {
    return (
      this.textContent +
      this.children.map((child) => (typeof child === "string" ? child : child.text)).join("")
    );
  }
}

function element(value: FakeElement | string | undefined): FakeElement {
  if (!(value instanceof FakeElement)) throw new Error("not an element");
  return value;
}

function index(entries: { title: string; text: string; url: string; number?: number }[]): string {
  const search = new MiniSearch(STATIC_SEARCH_OPTIONS);
  search.addAll(
    entries.map((entry, position) => ({
      id: position,
      number: position + 1,
      category: "IT",
      type: "howTo",
      excerpt: entry.text,
      ...entry,
    })),
  );
  return JSON.stringify(search);
}

async function run(query: string, files: Record<string, string | null>) {
  const root = new FakeElement("div");
  root.dataset = {
    index: "search-index.json",
    base: "../",
    fallbackIndex: "../search-index.json",
    fallbackBase: "../",
    fallbackLanguage: "de",
    fallbackLabel: "Deutsch",
    resultsOne: "1 article for “{query}”",
    resultsOther: "{count} articles for “{query}”",
    resultsNone: "No articles for “{query}”",
    typehowTo: "How-to",
  };
  for (const part of ["[data-results]", "[data-heading]", "[data-empty]", "[data-failed]"]) {
    root.parts.set(part, new FakeElement(part));
  }
  const inputs = [new FakeElement("input"), new FakeElement("input")];
  const document = {
    documentElement: { lang: "en" },
    querySelector: (selector: string) => (selector === "[data-static-search]" ? root : null),
    querySelectorAll: (selector: string) => (selector === "form[data-search] input[name=q]" ? inputs : []),
    createElement: (tag: string) => new FakeElement(tag),
    createDocumentFragment: () => new FakeElement("#fragment"),
  };
  const requested: string[] = [];
  const fetch = async (address: string) => {
    requested.push(address);
    const body = files[address];
    return { ok: body !== null && body !== undefined, text: async () => body ?? "" };
  };
  runInNewContext(staticSearchScript, {
    document,
    location: { search: `?q=${encodeURIComponent(query)}` },
    URLSearchParams,
    fetch,
    MiniSearch,
  });
  for (let round = 0; round < 10; round += 1) await new Promise((done) => setImmediate(done));
  const part = (name: string) => root.parts.get(name) as FakeElement;
  return { root, inputs, requested, part };
}

describe("search script of a static website", () => {
  it("keeps the query in every search field and shows an excerpt with the matches marked", async () => {
    const { inputs, part } = await run("printer", {
      "search-index.json": index([
        { title: "Set up the printer", text: "The printer in the hallway prints in color.", url: "en/7-printer.html" },
      ]),
      "../search-index.json": index([]),
    });
    expect(inputs.map((input) => input.value)).toEqual(["printer", "printer"]);
    expect(part("[data-heading]")).toMatchObject({ hidden: false, textContent: "1 article for “printer”" });
    const item = element(part("[data-results]").children[0]);
    const [path, link, excerpt] = item.children.map(element);
    expect(path?.textContent).toBe("How-to · IT");
    expect(link).toMatchObject({ href: "../en/7-printer.html", textContent: "Set up the printer" });
    expect(excerpt?.text).toBe("The printer in the hallway prints in color.");
    expect(excerpt?.children.filter((child) => child instanceof FakeElement && child.tag === "mark")).toHaveLength(1);
    expect(part("[data-empty]").hidden).toBe(true);
  });

  it("adds matches in the default language after the reader's language without repeating an article", async () => {
    const { part, requested } = await run("vpn", {
      "search-index.json": index([
        { title: "Set up the VPN", text: "Install the VPN client.", url: "en/1-vpn.html", number: 1 },
      ]),
      "../search-index.json": index([
        { title: "VPN einrichten", text: "VPN-Client installieren.", url: "1-vpn.html", number: 1 },
        { title: "VPN trennt die Verbindung", text: "Das VPN bricht ab.", url: "2-vpn-trennt.html", number: 2 },
      ]),
    });
    expect(requested).toEqual(["search-index.json", "../search-index.json"]);
    const items = part("[data-results]").children.map(element);
    expect(items.map((item) => element(item.children[1]).href)).toEqual(["../en/1-vpn.html", "../2-vpn-trennt.html"]);
    expect(items[1]?.lang).toBe("de");
    expect(element(items[1]?.children[0]).text).toContain("Deutsch");
    expect(part("[data-heading]").textContent).toBe("2 articles for “vpn”");
  });

  it("says that nothing was found and that the index could not be loaded", async () => {
    const empty = await run("zebra", {
      "search-index.json": index([{ title: "Printer", text: "Hall", url: "en/7-printer.html" }]),
      "../search-index.json": index([{ title: "Drucker", text: "Flur", url: "8-drucker.html" }]),
    });
    expect(empty.part("[data-empty]").hidden).toBe(false);
    expect(empty.part("[data-heading]").textContent).toBe("No articles for “zebra”");
    const failed = await run("printer", { "search-index.json": null });
    expect(failed.part("[data-failed]").hidden).toBe(false);
  });
});
