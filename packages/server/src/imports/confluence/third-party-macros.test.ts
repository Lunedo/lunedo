import { defaultEmbedServices, type NodeJson, resolveEmbed, validateDocument } from "@pagehall/editor-schema";
import { describe, expect, it } from "vitest";
import {
  type ConvertedPage,
  convertStorage,
  parseStorage,
  type StorageLookup,
  storageReferences,
} from "./storage.js";

const ID = (n: number) => `01929b1e-0000-7000-8000-${String(n).padStart(12, "0")}`;
const SOURCE = ID(1);
const FILES: Readonly<Record<string, number>> = {
  "mockup_Sign In.png": 10,
  "mockup_Sign In.bmml": 11,
  "balsamiq_wireframe_2278E287_Master.png": 12,
  "BalsamiqProject_1.bmpr": 13,
  "Network map.png": 14,
};

function lookup(options: { services?: typeof defaultEmbedServices; siteUrl?: string } = {}): StorageLookup {
  let next = 100;
  const services = options.services ?? defaultEmbedServices;
  return {
    page(reference) {
      if (reference.title === "Datasets")
        return { kind: "page", pageId: SOURCE, path: `/spaces/SYN/pages/${SOURCE}/x` };
      return { kind: "external", href: null };
    },
    attachment(reference) {
      const file = FILES[reference.fileName];
      return file ? { attachmentId: ID(file), name: reference.fileName, version: 1 } : null;
    },
    person: () => null,
    space: () => null,
    spaceKey: "SYN",
    newId() {
      next += 1;
      return ID(next);
    },
    embeddable: (url) => resolveEmbed(url, services) !== null,
    text: (key) =>
      ({
        jiraNotImported: "Jira-Inhalt nicht importiert.",
        chartNotImported: "Diagramm nicht importiert.",
        pivotNotImported: "Pivot nicht importiert.",
      })[key],
    jiraIssueUrl: (key) => (options.siteUrl ? `${options.siteUrl}/browse/${key}` : null),
  };
}

async function convert(xhtml: string, options: Parameters<typeof lookup>[0] = {}): Promise<ConvertedPage> {
  const page = convertStorage(await parseStorage(xhtml), lookup(options));
  expect(validateDocument(page.document).ok).toBe(true);
  return page;
}

function macro(name: string, parameters: Record<string, string> = {}, body = ""): string {
  const params = Object.entries(parameters)
    .map(([key, value]) => `<ac:parameter ac:name="${key}">${value}</ac:parameter>`)
    .join("");
  return `<ac:structured-macro ac:name="${name}" ac:schema-version="1">${params}${body}</ac:structured-macro>`;
}

const rich = (xhtml: string) => `<ac:rich-text-body>${xhtml}</ac:rich-text-body>`;
const p = (text: string) => `<p>${text}</p>`;
const table =
  "<table><tbody><tr><th>Agent</th><th>Money</th></tr><tr><td>Anna</td><td>10</td></tr></tbody></table>";

function strip(node: NodeJson): NodeJson {
  const { attrs, content, ...rest } = node;
  const kept = ["paragraph", "tableCell", "tableHeader"].includes(node.type) ? undefined : attrs;
  return { ...rest, ...(kept ? { attrs: kept } : {}), ...(content ? { content: content.map(strip) } : {}) };
}

const paragraph = (text: string): NodeJson => ({ type: "paragraph", content: [{ type: "text", text }] });

function tabs(...entries: [string, string][]): NodeJson {
  return {
    type: "tabs",
    content: entries.map(([title, text]) => ({ type: "tab", attrs: { title }, content: [paragraph(text)] })),
  };
}

const content = (page: ConvertedPage) => (page.document.content ?? []).map(strip);

describe("widget connector", () => {
  it("becomes an embed when the address is on the allowlist, also for old http addresses", async () => {
    const page = await convert(
      macro("widget", {
        url: '<ri:url ri:value="http://youtube.com/watch?v=r7WIRd_8poI" />',
        height: "300px",
      }),
    );
    expect(content(page)).toEqual([
      {
        type: "embed",
        attrs: { url: "https://youtube.com/watch?v=r7WIRd_8poI", title: "", height: 300, thumbnailId: null },
      },
    ]);
    expect(page.notes).toEqual([]);
    expect(Object.fromEntries(page.converted)).toEqual({ widget: 1 });
  });

  it("reads an address given as plain text", async () => {
    const page = await convert(macro("widget", { url: "https://vimeo.com/76979871" }));
    expect(page.document.content?.[0]?.attrs?.url).toBe("https://vimeo.com/76979871");
  });

  it("becomes a link with a report entry when the address is not on the allowlist", async () => {
    const page = await convert(
      macro("widget", { url: '<ri:url ri:value="https://videos.example.net/w/1" />' }),
    );
    expect(content(page)).toEqual([
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "https://videos.example.net/w/1",
            marks: [{ type: "link", attrs: { href: "https://videos.example.net/w/1" } }],
          },
        ],
      },
    ]);
    expect(page.notes).toEqual([
      { code: "embedNotAllowed", macro: "widget", url: "https://videos.example.net/w/1" },
    ]);
  });

  it("follows the narrowed list of the organization", async () => {
    const page = await convert(macro("widget", { url: "https://youtu.be/r7WIRd_8poI" }), {
      services: defaultEmbedServices.filter((service) => service.id !== "youtube"),
    });
    expect(page.document.content?.[0]?.type).toBe("paragraph");
    expect(page.notes[0]?.code).toBe("embedNotAllowed");
  });

  it("stays a placeholder without a usable address", async () => {
    const page = await convert(macro("widget", { url: "javascript:alert(1)" }));
    expect(page.document.content?.[0]?.type).toBe("unsupportedMacro");
  });
});

describe("tab macros", () => {
  it("convert Composition and Content Formatting decks with their cards", async () => {
    const page = await convert(
      macro(
        "deck",
        { id: "d1", effectType: "fade" },
        rich(
          `${macro("card", { label: "Windows", default: "true" }, rich(p("Win")))}${macro("card", { label: "macOS" }, rich(p("Mac")))}`,
        ),
      ),
    );
    expect(content(page)).toEqual([tabs(["Windows", "Win"], ["macOS", "Mac"])]);
  });

  it.each([
    ["localtabgroup", "localtab", "title"],
    ["auitabs", "auitabspage", "title"],
    ["ui-tabs", "ui-tab", "title"],
    ["tabs-group", "tab-pane", "name"],
    ["horizontal-nav-group", "horizontal-nav-item", "name"],
    ["vertical-nav-group", "vertical-nav-item", "name"],
  ])("convert %s with %s children", async (container, child, title) => {
    const page = await convert(
      macro(
        container,
        {},
        rich(
          `${macro(child, { [title]: "One" }, rich(p("First")))}<p> </p>${macro(child, { [title]: "Two" }, rich(p("Second")))}`,
        ),
      ),
    );
    expect(content(page)).toEqual([tabs(["One", "First"], ["Two", "Second"])]);
  });

  it("convert Aura tab collections whose tabs mark where their content starts", async () => {
    const params = (value: unknown) => btoa(encodeURIComponent(JSON.stringify(value)));
    const page = await convert(
      macro(
        "aura-tab-collection",
        { params: params({ general: { direction: "horizontal" } }) },
        rich(
          `${macro("aura-tab", { summary: "Overview", params: params({ title: "Overview" }) })}${p("About")}${macro("aura-tab", { params: params({ title: "Features" }) })}${p("List")}`,
        ),
      ),
    );
    expect(content(page)).toEqual([tabs(["Overview", "About"], ["Features", "List"])]);
  });

  it.each([
    ["rw-ui-tabs-macro", "rw-tab"],
    ["refined-tabs", "refined-tab"],
  ])("convert Refined %s with %s markers", async (container, marker) => {
    const page = await convert(
      macro(
        container,
        {},
        rich(`${macro(marker, { title: "A" })}${p("Alpha")}${macro(marker, { title: "B" })}${p("Beta")}`),
      ),
    );
    expect(content(page)).toEqual([tabs(["A", "Alpha"], ["B", "Beta"])]);
  });

  it("names tabs without a title by their position", async () => {
    const page = await convert(macro("ui-tabs", {}, rich(macro("ui-tab", {}, rich(p("x"))))));
    expect(page.document.content?.[0]?.content?.[0]?.attrs?.title).toBe("Tab 1");
  });

  it("keep unknown variants as placeholders with their content", async () => {
    const page = await convert(
      macro("ui-tabs", {}, rich(`${p("Stray text")}${macro("ui-tab", { title: "A" }, rich(p("x")))}`)),
    );
    const [block] = page.document.content ?? [];
    expect(block?.type).toBe("unsupportedMacro");
    expect(JSON.stringify(block?.attrs?.data)).toContain("Stray text");
    expect(Object.fromEntries(page.macros)).toEqual({ "ui-tabs": 1 });
  });

  it("turn panels and boxes into callouts, expands and columns", async () => {
    const page = await convert(
      [
        macro("aura-panel", { summary: "Note" }, rich(p("Panel text"))),
        macro("roundrect", { title: "Box" }, rich(p("Box text"))),
        macro("ui-expand", { title: "More" }, rich(p("Hidden"))),
        macro(
          "section",
          {},
          rich(
            `${macro("column", { width: "30%" }, rich(p("Left")))}${macro("column", { width: "70%" }, rich(p("Right")))}`,
          ),
        ),
      ].join(""),
    );
    expect(content(page).map((block) => block.type)).toEqual(["callout", "callout", "expand", "columns"]);
    expect(page.document.content?.[3]?.content?.map((column) => column.attrs?.width)).toEqual([30, 70]);
    expect(JSON.stringify(page.document.content?.[0])).toContain("Note");
  });
});

describe("Table Filter and Charts", () => {
  it("keeps the table of a table filter and reports filter and sort as dropped", async () => {
    const page = await convert(macro("table-filter", { sort: "Agent ⇧", column: "Agent" }, rich(table)));
    expect(content(page).map((block) => block.type)).toEqual(["table"]);
    expect(page.notes).toEqual([
      { code: "macroOptionDropped", macro: "table-filter", option: "filter" },
      { code: "macroOptionDropped", macro: "table-filter", option: "sort" },
    ]);
  });

  it("replaces charts and pivot tables with a note and keeps the source table", async () => {
    const page = await convert(
      macro(
        "table-chart",
        { type: "Pie", column: "Agent" },
        rich(macro("pivot-table", { type: "Sum" }, rich(macro("table-filter", {}, rich(table))))),
      ),
    );
    expect(content(page).map((block) => block.type)).toEqual(["callout", "callout", "table"]);
    expect(JSON.stringify(page.document.content?.[0])).toContain("Diagramm nicht importiert.");
    expect(JSON.stringify(page.document.content?.[1])).toContain("Pivot nicht importiert.");
    expect(page.notes).toEqual([
      { code: "chartNotImported", macro: "table-chart" },
      { code: "chartNotImported", macro: "pivot-table" },
    ]);
  });
});

describe("Numbered Headings", () => {
  it("turns on the page option and keeps the content", async () => {
    const page = await convert(macro("numberedheadings", {}, rich("<h1>Overview</h1><p>Text</p>")));
    expect(page.numberHeadings).toBe(true);
    expect(content(page).map((block) => block.type)).toEqual(["heading", "paragraph"]);
    expect(page.notes).toEqual([]);
  });

  it("reports number formats it cannot keep", async () => {
    const page = await convert(
      macro(
        "numberedheadings",
        { "number-format": "upper-roman", "start-numbering-with": "2" },
        rich("<h2>A</h2>"),
      ),
    );
    expect(page.numberHeadings).toBe(true);
    expect(page.notes).toEqual([
      { code: "macroOptionDropped", macro: "numberedheadings", option: "number-format" },
      { code: "macroOptionDropped", macro: "numberedheadings", option: "start-numbering-with" },
    ]);
  });

  it("leaves headings unnumbered without the macro", async () => {
    expect((await convert("<h1>Plain</h1>")).numberHeadings).toBe(false);
  });
});

describe("MultiExcerpt", () => {
  it.each(["multiexcerpt", "multiexcerpt-macro", "multiexcerpt-fast-block-macro"])(
    "converts %s to an excerpt",
    async (name) => {
      const page = await convert(
        macro(name, { MultiExcerptName: "streams", name: "streams" }, rich(p("Shared"))),
      );
      expect(content(page)).toEqual([
        { type: "excerpt", attrs: { name: "streams", hidden: false }, content: [paragraph("Shared")] },
      ]);
    },
  );

  it.each([
    ["multiexcerpt-include", "MultiExcerptName", "PageWithExcerpt"],
    ["multiexcerpt-include-macro", "name", "page"],
    ["multiexcerpt-fast-include-block-macro", "name", "page"],
  ])("converts %s to an excerpt include", async (name, nameParameter, pageParameter) => {
    const page = await convert(
      macro(name, {
        [nameParameter]: "List of Datasets",
        [pageParameter]: '<ac:link><ri:page ri:content-title="Datasets" /></ac:link>',
        addpanel: "true",
      }),
    );
    expect(content(page)).toEqual([
      {
        type: "includeExcerpt",
        attrs: {
          pageId: SOURCE,
          sourceSpace: null,
          sourceTitle: null,
          name: "List of Datasets",
          panel: true,
        },
      },
    ]);
  });

  it("asks for the pages of includes in the same space before converting", async () => {
    const root = await parseStorage(
      macro("multiexcerpt-include", {
        MultiExcerptName: "x",
        PageWithExcerpt: '<ac:link><ri:page ri:content-title="Other" /></ac:link>',
      }),
    );
    expect(storageReferences(root).pages.map((reference) => reference.title)).toContain("Other");
  });
});

describe("Lucidchart, Balsamiq and Miro", () => {
  it("keeps the preview image and the source file of Balsamiq mockups with a report entry", async () => {
    const page = await convert(macro("mockup", { Name: "Sign In", Version: "2" }));
    expect(content(page)).toMatchObject([
      { type: "image", attrs: { attachmentId: ID(10), alt: "Sign In" } },
      { type: "file", attrs: { attachmentId: ID(11), name: "mockup_Sign In.bmml" } },
    ]);
    expect(page.notes).toEqual([{ code: "previewOnly", macro: "mockup", name: "Sign In" }]);
  });

  it("finds the preview of Balsamiq wireframes by resource and branch", async () => {
    const page = await convert(
      macro("wireframe", {
        initialResourceID: "2278E287",
        initialBranchID: "Master",
        platformArchiveName: "BalsamiqProject_1",
      }),
    );
    expect(content(page).map((block) => block.type)).toEqual(["image", "file"]);
  });

  it("links Lucidchart documents and keeps a preview stored with the page", async () => {
    const page = await convert(macro("lucidchart", { documentId: "abc-123", documentName: "Network map" }));
    expect(content(page)[0]).toMatchObject({
      type: "image",
      attrs: { attachmentId: ID(14), alt: "Network map" },
    });
    expect(JSON.stringify(content(page)[1])).toContain("https://lucid.app/lucidchart/abc-123/view");
    expect(page.notes).toEqual([
      { code: "embedNotAllowed", macro: "lucidchart", url: "https://lucid.app/lucidchart/abc-123/view" },
      { code: "previewOnly", macro: "lucidchart", name: "Network map" },
    ]);
  });

  it("embeds a Miro board on the allowlist and links it otherwise", async () => {
    const board = "https://miro.com/app/board/uXjVOabc=/";
    const embedded = await convert(macro("miro", { url: board }));
    expect(embedded.document.content?.[0]).toMatchObject({ type: "embed", attrs: { url: board } });
    const linked = await convert(macro("miro", { url: board }), { services: [] });
    expect(linked.document.content?.[0]?.type).toBe("paragraph");
    expect(linked.notes.map((note) => note.code)).toEqual(["embedNotAllowed", "previewMissing"]);
  });

  it("embeds with the stored preview as thumbnail when the address is allowed", async () => {
    const services = [
      {
        id: "lucid",
        name: "Lucid",
        rules: [
          {
            pattern: "https://lucid.app/lucidchart/{doc}/view",
            embed: "https://lucid.app/documents/embedded/{doc}",
          },
        ],
      },
    ];
    const page = await convert(macro("lucidchart", { documentId: "abc-123", documentName: "Network map" }), {
      services,
    });
    expect(page.document.content?.[0]).toMatchObject({ type: "embed", attrs: { thumbnailId: ID(14) } });
  });
});

describe("Jira issue macros", () => {
  it("link a single issue on Atlassian Cloud and say that Jira content was not imported", async () => {
    const page = await convert(
      `<p>See ${macro("jira", { server: "Jira", serverId: "520ce16e", key: "OPS-27" })} for details</p>`,
      { siteUrl: "https://example.atlassian.net" },
    );
    expect(JSON.stringify(page.document)).toContain('"href":"https://example.atlassian.net/browse/OPS-27"');
    expect(JSON.stringify(page.document)).toContain("Jira-Inhalt nicht importiert.");
    expect(page.notes).toEqual([{ code: "jiraNotImported", macro: "jira", issues: "OPS-27" }]);
  });

  it("show the key as text when the Jira address is unknown", async () => {
    const page = await convert(macro("jira", { key: "OPS-27" }));
    expect(page.document.content?.[0]?.content?.[0]).toEqual({
      type: "text",
      text: "OPS-27",
      marks: [{ type: "code" }],
    });
  });

  it("show the query of an issue list, also from the address of the old macro", async () => {
    const list = await convert(
      macro("jira", { jqlQuery: 'project = "OPS"', columns: "key,summary", maximumIssues: "20" }),
    );
    expect(JSON.stringify(list.document)).toContain('project = \\"OPS\\"');
    expect(list.notes).toEqual([{ code: "jiraNotImported", macro: "jira", issues: 'project = "OPS"' }]);
    const legacy = await convert(
      macro("jiraissues", {
        url: '<ri:url ri:value="https://tickets.example.org/sr/SearchRequest.xml?jqlQuery=project+%3D+TRUNK&amp;tempMax=1000" />',
      }),
    );
    expect(legacy.notes).toEqual([
      { code: "jiraNotImported", macro: "jiraissues", issues: "project = TRUNK" },
    ]);
  });
});
