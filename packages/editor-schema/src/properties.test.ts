import { describe, expect, it } from "vitest";
import { parseCql } from "./cql.js";
import {
  type DocumentJson,
  extractPageProperties,
  type NodeJson,
  type PropertiesReport,
  propertySortKey,
  type RenderContext,
  renderHtml,
  renderMarkdown,
  renderWord,
  validateDocument,
} from "./index.js";

const PERSON = "01929b1e-0000-7000-8000-000000000010";
const SPACE = "01929b1e-0000-7000-8000-000000000003";

const text = (value: string) => ({ type: "text", text: value });
const paragraph = (...content: NodeJson[]) => ({ type: "paragraph", content });

function property(key: string, ...value: NodeJson[]): NodeJson {
  return {
    type: "pageProperty",
    content: [
      { type: "pagePropertyKey", content: key ? [text(key)] : [] },
      { type: "pagePropertyValue", content: value.length > 0 ? value : [{ type: "paragraph" }] },
    ],
  };
}

function properties(attrs: Record<string, unknown>, ...rows: NodeJson[]): DocumentJson {
  return { type: "doc", content: [{ type: "pageProperties", attrs, content: rows }] };
}

describe("page properties", () => {
  it("render as a table of names and rich values", () => {
    const document = properties(
      {},
      property("Owner", paragraph({ type: "mention", attrs: { id: PERSON } })),
      property("Status", paragraph({ type: "status", attrs: { text: "Live", color: "green" } })),
    );
    const html = renderHtml(document, { mention: () => ({ name: "Anna Berger" }) });
    expect(html).toContain('<section class="ld-page-properties" aria-label="Page properties">');
    expect(html).toContain('<th scope="row">Owner</th><td><p');
    expect(html).toContain("@Anna Berger");
    expect(html).toContain('data-color="green"');
    expect(renderMarkdown(document)).toContain("| Owner | @Unknown person |\n| --- | --- |\n| Status |");
  });

  it("hide a hidden property set from readers and show it to editors", () => {
    const document = properties({ hidden: true, setId: "site" }, property("Owner", paragraph(text("Anna"))));
    expect(renderHtml(document)).toBe("");
    expect(renderMarkdown(document)).toBe("");
    expect(renderWord(document)).toEqual([]);
    expect(renderHtml(document, { showPlaceholders: true })).toContain(
      'data-set-id="site" data-hidden="true"',
    );
  });

  it("accept paragraphs, lists, quotes and code as values and refuse other blocks", () => {
    const list = {
      type: "bulletList",
      content: [{ type: "listItem", content: [paragraph(text("Review"))] }],
    };
    expect(validateDocument(properties({}, property("Steps", paragraph(text("a")), list))).ok).toBe(true);
    const nested = {
      type: "bulletList",
      content: [{ type: "listItem", content: [paragraph(text("a")), { type: "horizontalRule" }] }],
    };
    expect(validateDocument(properties({}, property("Steps", nested))).ok).toBe(false);
    expect(
      validateDocument(properties({}, property("Code", { type: "codeBlock", content: [text("x")] }))).ok,
    ).toBe(true);
    expect(
      validateDocument(
        properties({}, property("Quote", { type: "blockquote", content: [paragraph(text("q"))] })),
      ).ok,
    ).toBe(true);
    expect(
      validateDocument(
        properties({}, property("Quote", { type: "blockquote", content: [{ type: "horizontalRule" }] })),
      ).ok,
    ).toBe(false);
    expect(validateDocument(properties({}, property("Rule", { type: "horizontalRule" }))).ok).toBe(false);
    expect(validateDocument(properties({}, property("x".repeat(201), paragraph(text("a"))))).ok).toBe(false);
    expect(validateDocument(properties({ setId: " site" }, property("a", paragraph(text("a"))))).ok).toBe(
      false,
    );
  });

  it("extract the names, values and sort keys of every set", () => {
    const document: DocumentJson = {
      type: "doc",
      content: [
        properties(
          {},
          property(" Switch  count ", paragraph(text("12"))),
          property("switch count", paragraph(text("ignored"))),
          property("", paragraph(text("no name"))),
          property("Next", paragraph({ type: "date", attrs: { date: "2027-03-14" } })),
        ).content?.[0] as NodeJson,
        properties({ setId: "site" }, property("Owner", paragraph(text("Anna")))).content?.[0] as NodeJson,
      ],
    };
    const extracted = extractPageProperties(validated(document));
    expect(
      extracted.map(({ block, setId, position, key, keyNormalized, text: value }) => ({
        block,
        setId,
        position,
        key,
        keyNormalized,
        value,
      })),
    ).toEqual([
      { block: 0, setId: null, position: 0, key: "Switch count", keyNormalized: "switch count", value: "12" },
      { block: 0, setId: null, position: 3, key: "Next", keyNormalized: "next", value: "2027-03-14" },
      { block: 1, setId: "site", position: 0, key: "Owner", keyNormalized: "owner", value: "Anna" },
    ]);
  });

  it("sort numbers in values by their value", () => {
    const keys = ["Rack 10", "rack 9", "Rack 100"].map(propertySortKey).sort();
    expect(keys).toEqual(["Rack 9", "Rack 10", "Rack 100"].map(propertySortKey));
    expect(propertySortKey("2027-03-04") < propertySortKey("2027-11-01")).toBe(true);
  });
});

function validated(document: DocumentJson): DocumentJson {
  const result = validateDocument(document);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.document;
}

const reportDocument: DocumentJson = {
  type: "doc",
  content: [
    {
      type: "propertiesReport",
      attrs: {
        spaceIds: [SPACE],
        labels: ["site"],
        columns: ["Owner"],
        firstColumn: "Site",
        showCreator: true,
      },
    },
  ],
};

const report: PropertiesReport = {
  columns: ["Owner"],
  total: 3,
  rows: [
    {
      title: "Graz",
      href: "/spaces/IT/pages/1/graz",
      creator: "Lukas Hofer",
      labels: ["site"],
      cells: [[paragraph({ type: "mention", attrs: { id: PERSON } })]],
    },
    { title: "Linz", href: "/spaces/IT/pages/2/linz", creator: null, labels: [], cells: [null] },
  ],
};

describe("page properties report", () => {
  const context: RenderContext = {
    propertiesReport: (request) => {
      expect(request).toEqual({
        spaceIds: [SPACE],
        labels: ["site"],
        setId: null,
        columns: ["Owner"],
        sortBy: null,
        reverse: false,
        pageSize: 30,
      });
      return report;
    },
    mention: (id) => (id === PERSON ? { name: "Anna Berger" } : null),
  };

  it("render the chosen columns with the values of each page", () => {
    const html = renderHtml(reportDocument, context);
    expect(html).toContain('<th scope="col">Site</th><th scope="col">Owner</th><th scope="col">Creator</th>');
    expect(html).toContain('<a href="/spaces/IT/pages/1/graz">Graz</a>');
    expect(html).toContain("@Anna Berger");
    expect(html).toContain("<td>Unknown person</td>");
    expect(html).toContain("2 of 3 pages.");
    const word = JSON.stringify(renderWord(reportDocument, context));
    expect(word).toContain("@Anna Berger");
    expect(word).toContain("Graz");
    expect(renderMarkdown(reportDocument, context)).toContain(
      "| [Graz](/spaces/IT/pages/1/graz) | @Anna Berger |",
    );
  });

  it("leave a placeholder for the web client when no data is given", () => {
    const html = renderHtml(reportDocument);
    expect(html).toContain(
      `class="ld-properties-report" aria-label="Page properties report" data-space-ids="[&quot;${SPACE}&quot;]" data-labels="[&quot;site&quot;]"`,
    );
    expect(html).toContain('data-columns="[&quot;Owner&quot;]" data-first-column="Site"');
    expect(html).toContain('data-page-size="30" data-show-creator="true"');
  });

  it("say so when no page matches", () => {
    const html = renderHtml(reportDocument, {
      propertiesReport: () => ({ columns: [], rows: [], total: 0 }),
    });
    expect(html).toContain("No pages with page properties match the filters");
  });

  it("refuse columns with commas and duplicate columns", () => {
    const invalid = (attrs: Record<string, unknown>) =>
      !validateDocument({ type: "doc", content: [{ type: "propertiesReport", attrs }] }).ok;
    expect(invalid({ columns: ["a,b"] })).toBe(true);
    expect(invalid({ columns: ["Owner", "owner"] })).toBe(true);
    expect(invalid({ pageSize: 101 })).toBe(true);
    expect(invalid({ spaceIds: ["IT"] })).toBe(true);
  });
});

describe("CQL from Confluence", () => {
  it("reads conditions joined with and, with or between values of one field", () => {
    expect(parseCql('label = "ad-script" and space = currentSpace ( )')).toEqual([
      { field: "label", values: ["ad-script"] },
      { field: "space", values: ["currentspace()"] },
    ]);
    expect(parseCql("(label = a or label = 'b') AND type in (page, blogpost)")).toEqual([
      { field: "label", values: ["a", "b"] },
      { field: "type", values: ["page", "blogpost"] },
    ]);
    expect(parseCql('label = "a" and label = "b"')).toEqual([
      { field: "label", values: ["a"] },
      { field: "label", values: ["b"] },
    ]);
  });

  it("refuses what it cannot map", () => {
    expect(parseCql('label = "a" or space = "IT"')).toBeNull();
    expect(parseCql('title ~ "network"')).toBeNull();
    expect(parseCql('label != "a"')).toBeNull();
    expect(parseCql('label = "a" and')).toBeNull();
    expect(parseCql('label = "unterminated')).toBeNull();
    expect(parseCql("")).toBeNull();
  });
});
