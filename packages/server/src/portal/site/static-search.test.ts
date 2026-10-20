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
  children: FakeElement[] = [];
  readonly parts = new Map<string, FakeElement>();

  constructor(readonly tag: string) {}

  querySelector(selector: string): FakeElement | null {
    return this.parts.get(selector) ?? null;
  }

  replaceChildren(...children: FakeElement[]) {
    this.children = children;
  }

  append(...children: FakeElement[]) {
    this.children.push(...children);
  }
}

function index(entries: { title: string; text: string; url: string }[]): string {
  const search = new MiniSearch(STATIC_SEARCH_OPTIONS);
  search.addAll(
    entries.map((entry, position) => ({
      id: position,
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
    resultsOne: "1 Artikel zu „{query}“",
    resultsOther: "{count} Artikel zu „{query}“",
    typehowTo: "Anleitung",
  };
  for (const part of ["[data-results]", "[data-heading]", "[data-note]", "[data-empty]", "[data-failed]"]) {
    root.parts.set(part, new FakeElement(part));
  }
  const input = new FakeElement("input");
  const document = {
    querySelector: (selector: string) =>
      selector === "[data-static-search]"
        ? root
        : selector === "form[data-search] input[name=q]"
          ? input
          : null,
    createElement: (tag: string) => new FakeElement(tag),
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
  return { root, input, requested, part };
}

describe("search script of a static website", () => {
  it("shows the results of the reader's language with links relative to the page", async () => {
    const { input, part } = await run("drucker", {
      "search-index.json": index([
        { title: "Drucker einrichten", text: "Der Drucker im Flur.", url: "de/7-drucker.html" },
      ]),
    });
    expect(input.value).toBe("drucker");
    expect(part("[data-heading]")).toMatchObject({ hidden: false, textContent: "1 Artikel zu „drucker“" });
    const [item] = part("[data-results]").children;
    const [path, link] = item?.children ?? [];
    expect(path?.textContent).toBe("Anleitung · IT");
    expect(link).toMatchObject({ href: "../de/7-drucker.html", textContent: "Drucker einrichten" });
    expect(part("[data-note]").hidden).toBe(true);
    expect(part("[data-empty]").hidden).toBe(true);
  });

  it("falls back to the default language with a note", async () => {
    const { part, requested } = await run("printer", {
      "search-index.json": index([{ title: "Drucker", text: "Flur", url: "de/7-drucker.html" }]),
      "../search-index.json": index([{ title: "Printer", text: "Hallway printer.", url: "8-printer.html" }]),
    });
    expect(requested).toEqual(["search-index.json", "../search-index.json"]);
    expect(part("[data-note]").hidden).toBe(false);
    expect(part("[data-results]").children[0]?.children[1]?.href).toBe("../8-printer.html");
  });

  it("says that nothing was found and that the index could not be loaded", async () => {
    const empty = await run("zebra", {
      "search-index.json": index([{ title: "Drucker", text: "Flur", url: "de/7-drucker.html" }]),
      "../search-index.json": index([{ title: "Printer", text: "Hall", url: "8-printer.html" }]),
    });
    expect(empty.part("[data-empty]").hidden).toBe(false);
    expect(empty.part("[data-heading]").textContent).toBe("0 Artikel zu „zebra“");
    const failed = await run("drucker", { "search-index.json": null });
    expect(failed.part("[data-failed]").hidden).toBe(false);
  });
});
