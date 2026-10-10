import { type NodeJson, validateDocument } from "@pagehall/editor-schema";
import { describe, expect, it } from "vitest";
import {
  type ConvertedPage,
  convertStorage,
  parseStorage,
  type StorageLookup,
  storageReferences,
} from "./storage.js";

const ID = (n: number) => `01929b1e-0000-7000-8000-${String(n).padStart(12, "0")}`;
const RUNBOOK = ID(1);
const REPORT = ID(2);
const SHEET = ID(3);
const OTHER_REPORT = ID(4);
const SPACE = ID(5);
const PROJECT = ID(6);
const TEMPLATE = ID(7);

function lookup(): StorageLookup {
  let next = 100;
  return {
    page(reference) {
      if (reference.title === "Runbook" || (reference.formerTitles && reference.title === "Old runbook")) {
        return { kind: "page", pageId: RUNBOOK, path: `/spaces/SYN/pages/${RUNBOOK}/runbook` };
      }
      if (reference.sourceId === "181305345") {
        return { kind: "page", pageId: PROJECT, path: `/spaces/SYN/pages/${PROJECT}/project` };
      }
      return { kind: "external", href: null };
    },
    spaceId: (key) => (key === null || key.toLowerCase() === "syn" ? SPACE : null),
    template: (sourceId) => (sourceId === "235077637" ? TEMPLATE : null),
    attachment(reference) {
      if (reference.fileName === "report.pdf" && reference.pageTitle === "Runbook") {
        return { attachmentId: OTHER_REPORT, name: "report.pdf" };
      }
      if (reference.fileName === "report.pdf" && reference.pageTitle === null) {
        return { attachmentId: REPORT, name: "report.pdf" };
      }
      if (reference.fileName === "costs.xlsx") return { attachmentId: SHEET, name: "costs.xlsx" };
      return null;
    },
    person: () => ID(50),
    space: () => null,
    newId() {
      next += 1;
      return ID(next);
    },
  };
}

async function convert(xhtml: string): Promise<ConvertedPage> {
  const page = convertStorage(await parseStorage(xhtml), lookup());
  expect(validateDocument(page.document).ok).toBe(true);
  return page;
}

function macro(name: string, parameters: Record<string, string> = {}, body = ""): string {
  const params = Object.entries(parameters)
    .map(([key, value]) => `<ac:parameter ac:name="${key}">${value}</ac:parameter>`)
    .join("");
  return `<ac:structured-macro ac:name="${name}" ac:schema-version="1" ac:macro-id="m1">${params}${body}</ac:structured-macro>`;
}

function rich(xhtml: string): string {
  return `<ac:rich-text-body>${xhtml}</ac:rich-text-body>`;
}

function plain(text: string): string {
  return `<ac:plain-text-body><![CDATA[${text}]]></ac:plain-text-body>`;
}

function strip(node: NodeJson): NodeJson {
  const { attrs, content, ...rest } = node;
  const kept = node.type === "paragraph" ? undefined : attrs;
  return {
    ...rest,
    ...(kept ? { attrs: kept } : {}),
    ...(content ? { content: content.map(strip) } : {}),
  };
}

async function blocks(xhtml: string): Promise<NodeJson[]> {
  return ((await convert(xhtml)).document.content ?? []).map(strip);
}

async function unsupported(xhtml: string, name: string): Promise<void> {
  const page = await convert(xhtml);
  expect(page.document.content?.map((node) => [node.type, node.attrs?.name])).toEqual([
    ["unsupportedMacro", name],
  ]);
  expect(Object.fromEntries(page.macros)).toEqual({ [name]: 1 });
  expect(Object.fromEntries(page.converted)).toEqual({});
}

function text(value: string, marks?: NodeJson["marks"]): NodeJson {
  return marks ? { type: "text", text: value, marks } : { type: "text", text: value };
}

function paragraph(...content: NodeJson[]): NodeJson {
  return content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" };
}

describe("code macro", () => {
  for (const [language, expected] of [
    ["typescript", "typescript"],
    ["bash", "bash"],
    ["json", "json"],
    ["text", "plaintext"],
    ["ini", "ini"],
    ["xml", "xml"],
    ["powershell", "powershell"],
    ["PowerShell", "powershell"],
    ["js", "javascript"],
    ["c#", "csharp"],
    ["coldfusion", null],
  ] as const) {
    it(`converts the language ${language}`, async () => {
      expect(await blocks(macro("code", { language }, plain("x = 1")))).toEqual([
        { type: "codeBlock", attrs: { language: expected }, content: [text("x = 1")] },
      ]);
    });
  }

  it("converts code without a language and ignores the block width", async () => {
    const variants: Record<string, string>[] = [
      {},
      { breakoutMode: "wide", breakoutWidth: "760" },
      { breakoutMode: "full-width" },
    ];
    for (const parameters of variants) {
      expect(await blocks(macro("code", parameters, plain("line 1\r\nline 2\r<tag> & ]]")))).toEqual([
        { type: "codeBlock", attrs: { language: null }, content: [text("line 1\nline 2\n<tag> & ]]")] },
      ]);
    }
  });

  it("keeps the title as a bold paragraph above the code", async () => {
    expect(
      await blocks(macro("code", { title: "Install  script", language: "bash" }, plain("make"))),
    ).toEqual([
      paragraph(text("Install script", [{ type: "bold" }])),
      { type: "codeBlock", attrs: { language: "bash" }, content: [text("make")] },
    ]);
  });

  it("converts an empty code macro to an empty code block", async () => {
    expect(await blocks(macro("code"))).toEqual([{ type: "codeBlock", attrs: { language: null } }]);
  });

  it("keeps a code macro with rich content as unsupported, so nothing is lost", async () => {
    await unsupported(macro("code", {}, rich("<p>formatted</p>")), "code");
  });
});

describe("panel macros", () => {
  for (const [name, variant] of [
    ["info", "info"],
    ["tip", "tip"],
    ["note", "warning"],
    ["warning", "error"],
  ] as const) {
    it(`converts ${name} to a callout of the type ${variant}`, async () => {
      const page = await convert(
        macro(name, {}, rich("<p>Read <strong>this</strong></p><ul><li><p>one</p></li></ul>")),
      );
      expect(page.document.content?.map(strip)).toEqual([
        {
          type: "callout",
          attrs: { variant },
          content: [
            paragraph(text("Read "), text("this", [{ type: "bold" }])),
            { type: "bulletList", content: [{ type: "listItem", content: [paragraph(text("one"))] }] },
          ],
        },
      ]);
      expect(Object.fromEntries(page.converted)).toEqual({ [name]: 1 });
    });
  }

  it("ignores the block width, keeps a title and gives an empty panel an empty paragraph", async () => {
    expect(
      await blocks(macro("info", { breakoutMode: "wide", breakoutWidth: "760", title: "Heads up" })),
    ).toEqual([
      {
        type: "callout",
        attrs: { variant: "info" },
        content: [paragraph(text("Heads up", [{ type: "bold" }])), paragraph()],
      },
    ]);
  });

  it("converts macros inside a panel and keeps the ones without a module as unsupported blocks", async () => {
    const page = await convert(
      macro(
        "info",
        {},
        rich(
          `<p>State: ${macro("status", { title: "Open", colour: "Blue" })}</p>${macro("roadmap", { timeline: "true" })}`,
        ),
      ),
    );
    const callout = page.document.content?.[0];
    expect(callout?.content?.[0]?.content?.[1]).toEqual({
      type: "status",
      attrs: { text: "Open", color: "blue" },
    });
    expect(callout?.content?.[1]).toMatchObject({ type: "unsupportedMacro", attrs: { name: "roadmap" } });
    expect(Object.fromEntries(page.converted)).toEqual({ info: 1, status: 1 });
    expect(Object.fromEntries(page.macros)).toEqual({ roadmap: 1 });
  });
});

describe("status macro", () => {
  for (const [colour, color] of [
    ["Yellow", "yellow"],
    ["Green", "green"],
    ["Red", "red"],
    ["Blue", "blue"],
    ["Purple", "purple"],
    ["Grey", "gray"],
    ["", "gray"],
  ] as const) {
    it(`converts the colour ${colour || "(none)"}`, async () => {
      const parameters: Record<string, string> = colour
        ? { title: "In review", colour }
        : { title: "In review" };
      expect(await blocks(`<p>${macro("status", parameters)}</p>`)).toEqual([
        paragraph({ type: "status", attrs: { text: "In review", color } }),
      ]);
    });
  }

  it("becomes a paragraph of its own outside of text", async () => {
    expect(await blocks(macro("status", { title: "Done", colour: "Green" }))).toEqual([
      paragraph({ type: "status", attrs: { text: "Done", color: "green" } }),
    ]);
  });

  it("stays unsupported without a title or with a title longer than 40 characters", async () => {
    await unsupported(macro("status", { colour: "Red" }), "status");
    await unsupported(macro("status", { title: "x".repeat(41) }), "status");
  });
});

describe("table of contents macros", () => {
  for (const [parameters, levels] of [
    [{}, { minLevel: 1, maxLevel: 6 }],
    [{ minLevel: "1" }, { minLevel: 1, maxLevel: 6 }],
    [{ minLevel: "2" }, { minLevel: 2, maxLevel: 6 }],
    [{ maxLevel: "6" }, { minLevel: 1, maxLevel: 6 }],
    [{ maxLevel: "7" }, { minLevel: 1, maxLevel: 6 }],
    [
      { minLevel: "2", maxLevel: "2" },
      { minLevel: 2, maxLevel: 2 },
    ],
    [
      {
        type: "flat",
        separator: "pipe",
        outline: "false",
        printable: "true",
        style: "none",
        include: "",
        exclude: "",
        indent: "",
        class: "",
      },
      { minLevel: 1, maxLevel: 6 },
    ],
    [
      { type: "list", printable: "false" },
      { minLevel: 1, maxLevel: 6 },
    ],
  ] as const) {
    it(`converts toc with ${JSON.stringify(parameters)}`, async () => {
      expect(await blocks(macro("toc", parameters))).toEqual([{ type: "tableOfContents", attrs: levels }]);
    });
  }

  it("stays unsupported with heading filters or levels it cannot show", async () => {
    await unsupported(macro("toc", { include: "Setup.*" }), "toc");
    await unsupported(macro("toc", { exclude: "Draft" }), "toc");
    await unsupported(macro("toc", { minLevel: "three" }), "toc");
    await unsupported(macro("toc", { minLevel: "0" }), "toc");
    await unsupported(macro("toc", { minLevel: "4", maxLevel: "2" }), "toc");
  });

  it("converts toc-zone to a table of contents before or after its content", async () => {
    expect(await blocks(macro("toc-zone", {}, rich("<h2>Setup</h2>")))).toEqual([
      { type: "tableOfContents", attrs: { minLevel: 1, maxLevel: 6 } },
      { type: "heading", attrs: { level: 2, textAlign: "left", indent: 0 }, content: [text("Setup")] },
    ]);
    expect(
      (await blocks(macro("toc-zone", { location: "bottom", maxLevel: "3" }, rich("<p />")))).map(
        (node) => node.type,
      ),
    ).toEqual(["paragraph", "tableOfContents"]);
  });
});

describe("expand macro", () => {
  it("converts with and without a title", async () => {
    expect(await blocks(macro("expand", {}, rich("<p />")))).toEqual([
      { type: "expand", attrs: { title: "" }, content: [paragraph()] },
    ]);
    expect(await blocks(macro("expand", { title: "Details" }, rich("<p>Hidden</p>")))).toEqual([
      { type: "expand", attrs: { title: "Details" }, content: [paragraph(text("Hidden"))] },
    ]);
  });
});

describe("decision list", () => {
  function item(content: string | null): string {
    return `<ac:adf-node type="decision-item"><ac:adf-attribute key="local-id">d1</ac:adf-attribute><ac:adf-attribute key="state">DECIDED</ac:adf-attribute>${content === null ? "" : `<ac:adf-content>${content}</ac:adf-content>`}</ac:adf-node>`;
  }

  function list(items: string[], fallback = ""): string {
    return `<ac:adf-extension><ac:adf-node type="decision-list"><ac:adf-attribute key="local-id">l1</ac:adf-attribute>${items.join("")}</ac:adf-node>${fallback}</ac:adf-extension>`;
  }

  it("converts each entry to a decision and keeps empty ones as empty decisions", async () => {
    const page = await convert(
      list(
        [
          item('Use <a href="https://example.org">the vendor</a><br />from May'),
          item(null),
          item('Agreed <ac:emoticon ac:name="tick" />'),
        ],
        '<ac:adf-fallback><ul class="decision-list"><li>Use the vendor</li></ul></ac:adf-fallback>',
      ),
    );
    expect(page.document.content?.map(strip)).toEqual([
      {
        type: "decision",
        attrs: { id: null, topicId: null },
        content: [
          paragraph(
            text("Use "),
            text("the vendor", [{ type: "link", attrs: { href: "https://example.org" } }]),
            { type: "hardBreak" },
            text("from May"),
          ),
        ],
      },
      { type: "decision", attrs: { id: null, topicId: null }, content: [paragraph()] },
      {
        type: "decision",
        attrs: { id: null, topicId: null },
        content: [paragraph(text("Agreed "), { type: "emoji", attrs: { emoji: "✅" } })],
      },
    ]);
    expect(Object.fromEntries(page.converted)).toEqual({ "adf:decision-list": 1 });
  });

  it("stays unsupported without entries or with block content in an entry", async () => {
    await unsupported(list([]), "adf:decision-list");
    await unsupported(list([item("<table><tr><td>x</td></tr></table>")]), "adf:decision-list");
  });
});

describe("file view macros", () => {
  for (const name of ["view-file", "viewpdf", "viewxls"]) {
    it(`converts ${name} to a file block`, async () => {
      const page = await convert(
        macro(name, { name: '<ri:attachment ri:filename="report.pdf" ri:version-at-save="3" />' }),
      );
      expect(page.document.content).toEqual([
        { type: "file", attrs: { attachmentId: REPORT, name: "report.pdf" } },
      ]);
      expect(Object.fromEntries(page.converted)).toEqual({ [name]: 1 });
    });
  }

  it("finds an attachment of another page named in the macro", async () => {
    const page = await convert(
      macro("viewpdf", {
        name: '<ri:attachment ri:filename="report.pdf" />',
        page: '<ac:link><ri:page ri:content-title="Runbook" ri:version-at-save="2" /></ac:link>',
      }),
    );
    expect(page.document.content?.[0]?.attrs?.attachmentId).toBe(OTHER_REPORT);
  });

  it("stays unsupported when the attachment is missing or not named", async () => {
    await unsupported(macro("view-file", { name: '<ri:attachment ri:filename="gone.docx" />' }), "view-file");
    await unsupported(macro("viewxls"), "viewxls");
  });
});

describe("children macro", () => {
  const defaults = { pageId: null, depth: 1, sort: "tree", reverse: false };

  for (const [parameters, attrs] of [
    [{}, defaults],
    [{ style: "h4" }, defaults],
    [{ style: "h3" }, defaults],
    [{ depth: "2" }, { ...defaults, depth: 2 }],
    [{ depth: "25" }, { ...defaults, depth: 10 }],
    [{ all: "true" }, { ...defaults, depth: null }],
    [
      {
        all: "true",
        depth: "0",
        allChildren: "true",
        style: "h4",
        sortAndReverse: "",
        excerptType: "simple",
        first: "0",
      },
      { ...defaults, depth: null },
    ],
    [
      { sort: "creation", reverse: "true" },
      { ...defaults, sort: "created", reverse: true },
    ],
    [{ sort: "title" }, { ...defaults, sort: "title" }],
    [{ sort: "modified" }, { ...defaults, sort: "modified" }],
  ] as const) {
    it(`converts children with ${JSON.stringify(parameters)}`, async () => {
      expect(await blocks(macro("children", parameters))).toEqual([{ type: "childPages", attrs }]);
    });
  }

  it("lists the children of a page named in the macro", async () => {
    expect(
      await blocks(macro("children", { page: '<ac:link><ri:page ri:content-title="Runbook" /></ac:link>' })),
    ).toEqual([{ type: "childPages", attrs: { ...defaults, pageId: RUNBOOK } }]);
  });

  it("stays unsupported for a page outside the import or a page given as text", async () => {
    await unsupported(
      macro("children", { page: '<ac:link><ri:page ri:content-title="Elsewhere" /></ac:link>' }),
      "children",
    );
    await unsupported(macro("children", { page: "OPS:Runbook" }), "children");
    await unsupported(macro("children", { page: "<ac:link />" }), "children");
  });

  it("finds a page by a title it had earlier or by a title given as text", async () => {
    expect(
      await blocks(
        macro("children", { page: '<ac:link><ri:page ri:content-title="Old runbook" /></ac:link>' }),
      ),
    ).toEqual([{ type: "childPages", attrs: { ...defaults, pageId: RUNBOOK } }]);
    expect(await blocks(macro("children", { page: " Runbook " }))).toEqual([
      { type: "childPages", attrs: { ...defaults, pageId: RUNBOOK } },
    ]);
  });

  it("uses earlier titles only for child pages, not for links", async () => {
    const page = await convert('<p><ac:link><ri:page ri:content-title="Old runbook" /></ac:link></p>');
    expect(page.notes).toEqual([{ code: "externalPageLink", title: "Old runbook", spaceKey: null }]);
  });
});

describe("attachments macro", () => {
  it("converts without a filter and with file patterns", async () => {
    expect(await blocks(macro("attachments"))).toEqual([
      { type: "attachmentList", attrs: { fileTypes: [] } },
    ]);
    expect(
      await blocks(
        macro("attachments", { preview: "true", patterns: "*.pdf, *.docx, *.doc, *.xlsx, *.xls" }),
      ),
    ).toEqual([{ type: "attachmentList", attrs: { fileTypes: ["pdf", "docx", "doc", "xlsx", "xls"] } }]);
    expect(await blocks(macro("attachments", { patterns: ".*png,.*\\.JPG,pdf,pdf" }))).toEqual([
      { type: "attachmentList", attrs: { fileTypes: ["png", "jpg", "pdf"] } },
    ]);
  });

  it("stays unsupported for patterns it cannot read, labels or another page", async () => {
    await unsupported(macro("attachments", { patterns: "report-(2024|2025).*" }), "attachments");
    await unsupported(macro("attachments", { labels: "contract" }), "attachments");
    await unsupported(
      macro("attachments", { page: '<ac:link><ri:page ri:content-title="Runbook" /></ac:link>' }),
      "attachments",
    );
  });
});

describe("macros without a module", () => {
  for (const name of ["details", "detailssummary", "roadmap", "related-labels"]) {
    it(`keep ${name} as an unsupported macro with its data`, async () => {
      await unsupported(macro(name, { hidden: "true" }, rich("<p>Owner</p>")), name);
    });
  }
});

describe("converting again", () => {
  const sample = [
    `<p>${macro("status", { title: "Done", colour: "Green" })}</p>`,
    macro(
      "info",
      {},
      rich(
        "<ac:task-list><ac:task><ac:task-status>complete</ac:task-status><ac:task-body>Ship</ac:task-body></ac:task></ac:task-list>",
      ),
    ),
    macro("code", { language: "bash" }, plain("ls")),
    macro("toc", { minLevel: "2" }),
    macro("children", { page: '<ac:link><ri:page ri:content-title="Runbook" /></ac:link>' }),
    macro("attachments", { patterns: "*.pdf" }),
    macro("view-file", { name: '<ri:attachment ri:filename="costs.xlsx" />' }),
    macro("roadmap", { timeline: "true" }),
  ].join("");

  it("gives the same document, counts and tasks", async () => {
    const first = await convert(sample);
    const second = await convert(sample);
    expect(second.document).toEqual(first.document);
    expect([...second.converted]).toEqual([...first.converted]);
    expect([...second.macros]).toEqual([...first.macros]);
    expect(second.tasks).toEqual(first.tasks);
    expect(first.tasks).toEqual([{ id: ID(101), done: true }]);
  });

  it("drops the tasks of a macro that falls back to its original data", async () => {
    const page = await convert(
      macro(
        "toc-zone",
        { include: "x" },
        rich(
          "<ac:task-list><ac:task><ac:task-status>incomplete</ac:task-status><ac:task-body>Ship</ac:task-body></ac:task></ac:task-list>",
        ),
      ),
    );
    expect(page.tasks).toEqual([]);
    expect(Object.fromEntries(page.macros)).toEqual({ "toc-zone": 1 });
  });
});

describe("references of converted macros", () => {
  it("are collected for macros with a module and skipped for the others", async () => {
    const references = storageReferences(
      await parseStorage(
        [
          macro("children", { page: '<ac:link><ri:page ri:content-title="Runbook" /></ac:link>' }),
          macro("viewpdf", {
            name: '<ri:attachment ri:filename="report.pdf" />',
            page: '<ac:link><ri:page ri:content-title="Runbook" /></ac:link>',
          }),
          macro("info", {}, rich('<p><ri:user ri:account-id="557058:aaaa" /></p>')),
          macro("details", {}, rich('<p><ri:user ri:account-id="557058:bbbb" /></p>')),
        ].join(""),
      ),
    );
    expect(references.pages).toContainEqual({ title: "Runbook", spaceKey: null, sourceId: null });
    expect(references.attachments).toEqual([
      { fileName: "report.pdf", pageTitle: "Runbook", spaceKey: null },
    ]);
    expect(references.people).toEqual([{ accountId: "557058:aaaa", userKey: null }]);
  });
});

function legacy(name: string, parameters: Record<string, string>): string {
  const params = Object.entries(parameters)
    .map(([key, value]) => `<ac:parameter ac:name="${key}">${value}</ac:parameter>`)
    .join("");
  return `<ac:macro ac:name="${name}">${params}</ac:macro>`;
}

const SYN = '<ri:space ri:space-key="SYN" />';
const OPS = '<ri:space ri:space-key="OPS" />';

describe("content report table", () => {
  const defaults = { spaceId: SPACE, labels: [], sort: "modified", reverse: false, limit: 20 };

  for (const [parameters, attrs] of [
    [
      { maxResults: "20", spaces: SYN, labels: "gst" },
      { ...defaults, labels: ["gst"] },
    ],
    [
      { maxResults: "20", spaces: SYN, sort: "Page title", labels: "gst" },
      { ...defaults, labels: ["gst"], sort: "title" },
    ],
    [
      { maxResults: "20", spaces: SYN, labels: "gst-nieder&ouml;sterreich-active" },
      { ...defaults, labels: ["gst-niederösterreich-active"] },
    ],
    [
      { spaces: SYN, labels: "Project Alpha, meeting-notes" },
      { ...defaults, labels: ["project-alpha", "meeting-notes"] },
    ],
    [{ maxResults: "", spaces: SYN }, defaults],
    [
      { maxResults: "500", spaces: "@self" },
      { ...defaults, limit: 100 },
    ],
    [
      { spaces: SYN, sort: "creation", reverse: "true" },
      { ...defaults, sort: "created", reverse: true },
    ],
    [{ spaces: SYN, sort: "modified" }, defaults],
    [{}, defaults],
  ] as const) {
    it(`converts content-report-table with ${JSON.stringify(parameters)}`, async () => {
      expect(await blocks(macro("content-report-table", parameters))).toEqual([
        { type: "pageReport", attrs },
      ]);
    });
  }

  it("converts the legacy form with a blueprint and keeps Pagehall's own empty text", async () => {
    expect(
      await blocks(
        legacy("content-report-table", {
          contentBlueprintId: "e180ddf0-7a48-4425-9c04-a3682cb92d41",
          blueprintModuleCompleteKey:
            "com.atlassian.confluence.plugins.confluence-knowledge-base:kb-how-to-article-blueprint",
          analyticsKey: "kb-how-to-article",
          blankDescription: "Provide step-by-step guidance.",
          blankTitle: "How-to article",
          spaces: "SYN",
          createButtonLabel: "Add how-to article",
          labels: "kb-how-to-article",
        }),
      ),
    ).toEqual([{ type: "pageReport", attrs: { ...defaults, labels: ["kb-how-to-article"] } }]);
  });

  it("stays unsupported for other spaces, label operators, unknown sorts and filters", async () => {
    for (const parameters of <Record<string, string>[]>[
      { spaces: OPS, labels: "gst" },
      { spaces: `${SYN}${OPS}` },
      { spaces: "SYN,OPS" },
      { spaces: SYN, labels: "+gst" },
      { spaces: SYN, labels: "-gst" },
      { spaces: SYN, labels: "!!!" },
      { spaces: SYN, maxResults: "many" },
      { spaces: SYN, maxResults: "0" },
      { spaces: SYN, sort: "Creator" },
      { spaces: SYN, cql: "label = gst" },
    ]) {
      await unsupported(macro("content-report-table", parameters), "content-report-table");
    }
  });
});

describe("recently updated", () => {
  const defaults = { spaceId: SPACE, labels: [], sort: "modified", reverse: false, limit: 15 };

  for (const [parameters, attrs] of [
    [{ types: "page", max: "15", spaces: SYN, theme: "concise" }, defaults],
    [{}, defaults],
    [
      { max: "40", labels: "news", spaces: "@self" },
      { ...defaults, limit: 40, labels: ["news"] },
    ],
    [
      { max: "250", hideHeading: "true", showProfilePic: "true" },
      { ...defaults, limit: 100 },
    ],
  ] as const) {
    it(`converts recently-updated with ${JSON.stringify(parameters)} to the latest changes`, async () => {
      expect(await blocks(macro("recently-updated", parameters))).toEqual([{ type: "pageReport", attrs }]);
    });
  }

  it("stays unsupported for other content types, authors, other spaces and broken numbers", async () => {
    for (const parameters of <Record<string, string>[]>[
      { types: "page,blogpost" },
      { types: "comment" },
      { author: "anna" },
      { spaces: OPS },
      { max: "-1" },
    ]) {
      await unsupported(macro("recently-updated", parameters), "recently-updated");
    }
  });
});

describe("decision report", () => {
  const defaults = { spaceId: SPACE, labels: [], parentId: null, order: "newest" };

  for (const [parameters, attrs] of [
    [{ cql: "space = &quot;SYN&quot;" }, defaults],
    [{ sort: "Page created", reverse: "true", cql: "space = &quot;SYN&quot;" }, defaults],
    [
      { sort: "Page created", cql: "space = &quot;SYN&quot;" },
      { ...defaults, order: "oldest" },
    ],
    [
      {
        cql: "space = &quot;SYN&quot; and label = &quot;project-m365&quot; and parent = &quot;181305345&quot;",
      },
      { ...defaults, labels: ["project-m365"], parentId: PROJECT },
    ],
    [
      { cql: 'space = "SYN" AND parent = "181305345" and label = "project-ad-ida-datenqualit&auml;t"' },
      { ...defaults, labels: ["project-ad-ida-datenqualität"], parentId: PROJECT },
    ],
    [{ cql: "label = 'meeting-notes'" }, { ...defaults, spaceId: null, labels: ["meeting-notes"] }],
    [{ cql: "space = SYN and parent = 181305345" }, { ...defaults, parentId: PROJECT }],
    [
      { cql: "label = &quot;meeting-notes&quot; and space = currentSpace ( )" },
      { ...defaults, labels: ["meeting-notes"] },
    ],
    [{ cql: "space = currentSpace()" }, defaults],
  ] as const) {
    it(`converts decisionreport with ${JSON.stringify(parameters)}`, async () => {
      expect(await blocks(macro("decisionreport", parameters))).toEqual([{ type: "decisionReport", attrs }]);
    });
  }

  it("converts the legacy form", async () => {
    expect(
      await blocks(
        legacy("decisionreport", { cql: "space = &quot;SYN&quot; and label = &quot;meeting-notes&quot;" }),
      ),
    ).toEqual([{ type: "decisionReport", attrs: { ...defaults, labels: ["meeting-notes"] } }]);
  });

  it("stays unsupported for queries it cannot translate and pages outside the export", async () => {
    for (const cql of [
      'space = "SYN" and parent = "234913802"',
      'space = "SYN" and meet in ("a", "b")',
      'space = "SYN" or label = "x"',
      'space = "SYN" and not label = "x"',
      'label = "a" and label = "b"',
      'space != "SYN"',
      'space = "OPS"',
      'type = "page"',
      'ancestor = "181305345"',
      "parent = currentContent()",
      'space = "SYN" and',
      "(space = SYN)",
      "",
    ]) {
      await unsupported(macro("decisionreport", { cql }), "decisionreport");
    }
    await unsupported(macro("decisionreport", {}), "decisionreport");
    await unsupported(macro("decisionreport", { cql: "space = SYN", sort: "Page title" }), "decisionreport");
    await unsupported(macro("decisionreport", { cql: "space = SYN", columns: "owner" }), "decisionreport");
  });
});

describe("task report", () => {
  const defaults = {
    spaceId: null,
    seriesId: null,
    pageIds: [PROJECT],
    labels: ["project-m365"],
    assignee: null,
    assignedToViewer: false,
    due: "any",
    status: "open",
  };

  for (const [parameters, attrs] of [
    [{ pages: "181305345", isMissingRequiredParameters: "true", labels: "project-m365" }, defaults],
    [
      { pages: "181305345", isMissingRequiredParameters: "true", labels: "project-m365", status: "complete" },
      { ...defaults, status: "done" },
    ],
    [
      { pages: "181305345", isMissingRequiredParameters: "true", labels: "", status: "complete" },
      { ...defaults, labels: [], status: "done" },
    ],
    [
      { pages: "181305345, 181305345", status: "incomplete" },
      { ...defaults, labels: [] },
    ],
  ] as const) {
    it(`converts tasks-report-macro with ${JSON.stringify(parameters)}`, async () => {
      expect(await blocks(macro("tasks-report-macro", parameters))).toEqual([{ type: "taskReport", attrs }]);
    });
  }

  it("converts the legacy form for a space", async () => {
    expect(
      await blocks(
        legacy("tasks-report-macro", {
          spaces: "SYN",
          pageSize: "10",
          spaceAndPage: "space:SYN",
          status: "incomplete",
          labels: "meeting-notes",
        }),
      ),
    ).toEqual([
      { type: "taskReport", attrs: { ...defaults, spaceId: SPACE, pageIds: [], labels: ["meeting-notes"] } },
    ]);
  });

  it("stays unsupported for pages outside the export, missing scopes and filters it cannot keep", async () => {
    for (const parameters of <Record<string, string>[]>[
      { pages: "234913802" },
      { pages: "181305345,234913802" },
      { pages: "Runbook" },
      { labels: "project-m365" },
      { pages: "181305345", status: "all" },
      { spaceAndPage: "page:SYN:Runbook" },
      { spaces: "OPS" },
      { pages: "181305345", assignees: "anna" },
      { pages: "181305345", duedateFrom: "2026-01-01" },
    ]) {
      await unsupported(macro("tasks-report-macro", parameters), "tasks-report-macro");
    }
  });
});

describe("create from template", () => {
  it("points to the imported space template with the button label", async () => {
    expect(
      await blocks(
        macro("create-from-template", {
          spaceKey: SYN,
          templateName: "235077637",
          templateId: "235077637",
          buttonLabel: "Hier klicken um eine neue Gesch&auml;ftsstelle einzurichten",
        }),
      ),
    ).toEqual([
      {
        type: "templateButton",
        attrs: {
          templateId: TEMPLATE,
          label: "Hier klicken um eine neue Geschäftsstelle einzurichten",
          title: "",
        },
      },
    ]);
  });

  for (const [title, pattern] of [
    ["@currentDate M365 Besprechungsnotiz", "{currentDate} M365 Besprechungsnotiz"],
    ["Project @projectName@ – @currentDate", "Project {projectName} – {currentDate}"],
    ["  Weekly   notes ", "Weekly notes"],
    ["@Owner_Name notes", "{ownerName} notes"],
  ] as const) {
    it(`turns the title pattern ${JSON.stringify(title)} into input fields`, async () => {
      expect(
        await blocks(
          macro("create-from-template", {
            spaceKey: SYN,
            templateId: "235077637",
            title,
            buttonLabel: "New note",
          }),
        ),
      ).toEqual([
        { type: "templateButton", attrs: { templateId: TEMPLATE, label: "New note", title: pattern } },
      ]);
    });
  }

  for (const [blueprint, templateId, label] of [
    [
      "com.atlassian.confluence.plugins.confluence-knowledge-base:kb-how-to-article-blueprint",
      "builtin:how-to",
      "Add how-to article",
    ],
    [
      "com.atlassian.confluence.plugins.confluence-business-blueprints:meeting-notes-blueprint",
      "builtin:meeting-notes",
      "Create meeting note",
    ],
  ] as const) {
    it(`points the legacy form ${blueprint.split(":")[1]} to the built-in template ${templateId}`, async () => {
      expect(
        await blocks(
          legacy("create-from-template", {
            contentBlueprintId: "361fad9c-5a23-4460-99f8-35b89eda47a4",
            blueprintModuleCompleteKey: blueprint,
            createButtonLabel: label,
          }),
        ),
      ).toEqual([{ type: "templateButton", attrs: { templateId, label, title: "" } }]);
    });
  }

  it("shortens a long button label and leaves a missing one to Pagehall's default", async () => {
    const [long] = await blocks(
      macro("create-from-template", { templateId: "235077637", buttonLabel: "x".repeat(150) }),
    );
    expect(long?.attrs?.label).toBe("x".repeat(100));
    const [missing] = await blocks(macro("create-from-template", { templateId: "235077637" }));
    expect(missing?.attrs?.label).toBe("");
  });

  it("stays unsupported for templates outside the export, other spaces and unknown blueprints", async () => {
    for (const parameters of <Record<string, string>[]>[
      { templateId: "999" },
      { templateId: "abc" },
      { templateId: "235077637", spaceKey: OPS },
      { templateId: "235077637", title: `@currentDate ${"x".repeat(260)}` },
      { blueprintModuleCompleteKey: "com.example:roadmap-blueprint" },
      {},
    ]) {
      await unsupported(macro("create-from-template", parameters), "create-from-template");
    }
  });
});

describe("references of report macros", () => {
  it("collect the pages a task or decision report names", async () => {
    const references = storageReferences(
      await parseStorage(
        [
          macro("tasks-report-macro", { pages: "181305345,234913802", labels: "x" }),
          macro("decisionreport", { cql: 'space = "SYN" and parent = "252510232"' }),
          macro("decisionreport", { cql: "space = SYN or parent = 1" }),
          macro("children", { page: "Runbook" }),
        ].join(""),
      ),
    );
    expect(references.pages).toEqual([
      { title: null, spaceKey: null, sourceId: "181305345" },
      { title: null, spaceKey: null, sourceId: "234913802" },
      { title: null, spaceKey: null, sourceId: "252510232" },
      { title: "Runbook", spaceKey: null, sourceId: null },
    ]);
  });
});

describe("space templates", () => {
  const variables = new Map([
    ["Project name", "projectName"],
    ["Owner", "owner"],
  ]);

  async function template(xhtml: string): Promise<ConvertedPage> {
    const page = convertStorage(await parseStorage(xhtml), { ...lookup(), templateVariables: variables });
    expect(validateDocument(page.document).ok).toBe(true);
    return page;
  }

  it("turn variables into input fields and placeholders into instructions", async () => {
    const page = await template(
      '<at:declarations><at:string at:name="Project name" /><at:list at:name="Owner"><at:option at:value="Anna" /></at:list></at:declarations>' +
        '<h1>Project <at:var at:name="Project name" /></h1><p><ac:placeholder>Describe the goal</ac:placeholder></p>' +
        '<p>Owner: <at:var at:name="Owner" at:rawxhtml="true" /> <at:var at:name="Unknown" /></p>',
    );
    expect(page.document.content?.map(strip)).toEqual([
      {
        type: "heading",
        attrs: { level: 1, textAlign: "left", indent: 0 },
        content: [text("Project "), { type: "templateField", attrs: { field: "projectName" } }],
      },
      { type: "paragraph", content: [{ type: "placeholder", attrs: { text: "Describe the goal" } }] },
      {
        type: "paragraph",
        content: [text("Owner: "), { type: "templateField", attrs: { field: "owner" } }],
      },
    ]);
  });

  it("drop placeholders and variables on pages", async () => {
    const page = await convert(
      '<p>A<ac:placeholder>Describe the goal</ac:placeholder> <at:var at:name="Owner" /></p>',
    );
    expect(page.document.content?.map(strip)).toEqual([{ type: "paragraph", content: [text("A")] }]);
  });
});
