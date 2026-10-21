import { describe, expect, it } from "vitest";
import {
  type DocumentJson,
  documentSize,
  emptyDocument,
  extractHeadings,
  extractMentions,
  extractPageLinks,
  plainText,
  validateDocument,
} from "./index.js";

const A = "01929b1e-0000-7000-8000-000000000001";
const B = "01929b1e-0000-7000-8000-000000000002";

const document: DocumentJson = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Intro" }] },
    {
      type: "paragraph",
      content: [
        { type: "mention", attrs: { id: A } },
        { type: "text", text: " met " },
        { type: "mention", attrs: { id: B } },
        { type: "mention", attrs: { id: A } },
        { type: "pageLink", attrs: { pageId: B, title: "Known" } },
        { type: "pageLink", attrs: { spaceId: A, title: "Planned" } },
      ],
    },
    { type: "section", attrs: { key: "cause", title: "Intro" }, content: [{ type: "paragraph" }] },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              content: [
                { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "In table" }] },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe("extraction", () => {
  it("finds page links in both forms", () => {
    expect(extractPageLinks(document)).toEqual([
      { pageId: B, spaceId: null, title: "Known" },
      { pageId: null, spaceId: A, title: "Planned" },
    ]);
  });

  it("finds each mentioned account once", () => {
    expect(extractMentions(document)).toEqual([A, B]);
  });

  it("lists headings and sections with unique ids", () => {
    expect(extractHeadings(document)).toEqual([
      { level: 1, text: "Intro", id: "intro" },
      { level: 2, text: "Intro", id: "intro-2" },
      { level: 3, text: "In table", id: "in-table" },
    ]);
  });

  it("extracts plain text by block", () => {
    expect(plainText(document)).toBe("Intro\n met \nIntro\nIn table");
  });

  it("measures the size and creates a valid empty document", () => {
    expect(documentSize({ type: "doc" })).toBe(14);
    const empty = emptyDocument();
    const result = validateDocument(empty);
    expect(result.ok && result.document).toEqual(empty);
  });
});
