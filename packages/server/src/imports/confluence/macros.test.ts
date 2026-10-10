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

function lookup(): StorageLookup {
  let next = 100;
  return {
    page(reference) {
      if (reference.title === "Runbook") {
        return { kind: "page", pageId: RUNBOOK, path: `/spaces/SYN/pages/${RUNBOOK}/runbook` };
      }
      return { kind: "external", href: null };
    },
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
