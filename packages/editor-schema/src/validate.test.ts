import { describe, expect, it } from "vitest";
import {
  isValidDocument,
  limits,
  MAX_DEPTH,
  MAX_DOCUMENT_BYTES,
  MAX_NODES,
  type ValidationCode,
  validateDocument,
} from "./index.js";

const ID = "01929b1e-0000-7000-8000-000000000001";

function doc(...content: unknown[]) {
  return { type: "doc", content };
}

function paragraph(...content: unknown[]) {
  return { type: "paragraph", content };
}

function text(value: string, marks?: unknown[]) {
  return marks ? { type: "text", text: value, marks } : { type: "text", text: value };
}

function codes(json: unknown): ValidationCode[] {
  const result = validateDocument(json);
  return result.ok ? [] : result.problems.map((problem) => problem.code);
}

describe("validateDocument", () => {
  it("accepts a minimal document and fills default attributes", () => {
    const result = validateDocument(doc(paragraph(text("Hello"))));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { textAlign: "left", indent: 0 },
          content: [{ type: "text", text: "Hello" }],
        },
      ],
    });
  });

  it("does not change its input", () => {
    const input = doc(paragraph(text("Hello")));
    const copy = structuredClone(input);
    validateDocument(input);
    expect(input).toEqual(copy);
  });

  it("orders marks canonically", () => {
    const result = validateDocument(doc(paragraph(text("x", [{ type: "italic" }, { type: "bold" }]))));
    expect(result.ok && result.document.content?.[0]?.content?.[0]?.marks).toEqual([
      { type: "bold" },
      { type: "italic" },
    ]);
  });

  it("accepts mark attributes stored as empty objects", () => {
    expect(isValidDocument(doc(paragraph(text("x", [{ type: "bold", attrs: {} }]))))).toBe(true);
  });

  it.each([
    ["a string", "doc"],
    ["null", null],
    ["an array", [doc()]],
    ["a number", 3],
  ])("rejects %s as document", (_name, value) => {
    expect(codes(value)).toEqual(["notAnObject"]);
  });

  it("rejects a document that is not JSON", () => {
    expect(codes(doc(paragraph({ type: "text", text: "x", extra: 1n })))).toEqual(["notSerializable"]);
  });

  it("rejects a top node other than doc", () => {
    expect(codes(paragraph(text("x")))).toEqual(["invalidContent"]);
  });

  it("rejects unknown nodes", () => {
    expect(codes(doc({ type: "script", content: [text("alert(1)")] }))).toEqual(["unknownNode"]);
    expect(codes(doc(paragraph({ type: 5 })))).toEqual(["unknownNode"]);
  });

  it("rejects unknown marks", () => {
    expect(codes(doc(paragraph(text("x", [{ type: "blink" }]))))).toEqual(["unknownMark"]);
  });

  it("rejects unknown attributes on nodes and marks", () => {
    expect(codes(doc({ type: "paragraph", attrs: { onclick: "x" } }))).toEqual(["unknownAttribute"]);
    expect(codes(doc(paragraph(text("x", [{ type: "bold", attrs: { style: "x" } }]))))).toEqual([
      "unknownAttribute",
    ]);
    expect(codes(doc(paragraph({ type: "text", text: "x", attrs: { id: 1 } })))).toEqual([
      "unknownAttribute",
    ]);
  });

  it("rejects unknown fields", () => {
    expect(codes(doc({ type: "paragraph", style: "color: red" }))).toEqual(["unknownField"]);
    expect(codes(doc(paragraph(text("x", [{ type: "bold", extra: true }]))))).toEqual(["unknownField"]);
    expect(codes(doc({ type: "paragraph", text: "x" }))).toEqual(["unknownField"]);
  });

  it("rejects wrong attribute types", () => {
    expect(codes(doc({ type: "heading", attrs: { level: "2" } }))).toEqual(["invalidAttribute"]);
    expect(
      codes(doc({ type: "taskList", content: [{ type: "taskItem", attrs: { checked: "yes" } }] })),
    ).toEqual(["invalidAttribute"]);
    expect(codes(doc({ type: "paragraph", attrs: [] }))).toEqual(["invalidAttribute"]);
  });

  it.each([
    ["heading level", { type: "heading", attrs: { level: 7 } }],
    ["alignment", { type: "paragraph", attrs: { textAlign: "middle" } }],
    ["indent", { type: "paragraph", attrs: { indent: 9 } }],
    ["callout variant", { type: "callout", attrs: { variant: "danger" }, content: [paragraph()] }],
    ["code language", { type: "codeBlock", attrs: { language: "klingon" } }],
    ["status color", paragraph({ type: "status", attrs: { text: "x", color: "#ff0000" } })],
    ["empty status", paragraph({ type: "status", attrs: { text: "  " } })],
    ["long status", paragraph({ type: "status", attrs: { text: "x".repeat(41) } })],
    ["date", paragraph({ type: "date", attrs: { date: "2026-02-30" } })],
    ["mention id", paragraph({ type: "mention", attrs: { id: "not-an-id" } })],
    ["uppercase id", paragraph({ type: "mention", attrs: { id: ID.toUpperCase() } })],
    ["emoji", paragraph({ type: "emoji", attrs: { emoji: "ab" } })],
    ["two emoji", paragraph({ type: "emoji", attrs: { emoji: "👍👍" } })],
    ["section key", { type: "section", attrs: { key: "Bad key" }, content: [paragraph()] }],
    [
      "column width",
      { type: "columns", content: [{ type: "column", attrs: { width: 99 }, content: [paragraph()] }] },
    ],
    ["text color", paragraph(text("x", [{ type: "textColor", attrs: { color: "rgb(1,2,3)" } }]))],
    ["highlight color", paragraph(text("x", [{ type: "highlight", attrs: { color: "neon" } }]))],
    ["comment thread", paragraph(text("x", [{ type: "inlineComment", attrs: { threadId: "1" } }]))],
    ["latex length", { type: "blockMath", attrs: { latex: "x".repeat(10_001) } }],
    ["toc level", { type: "tableOfContents", attrs: { maxLevel: 0 } }],
    ["image alignment", { type: "image", attrs: { attachmentId: ID, align: "top" } }],
    ["ordered list start", { type: "orderedList", attrs: { start: 0 }, content: [] }],
  ])("rejects a value outside the allowed set: %s", (_name, node) => {
    expect(codes(doc(node))).toContain("invalidAttribute");
  });

  it.each([
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "data:text/html,<script>",
    "vbscript:x",
    "//evil.example",
    "/\\evil.example",
    " https://example.org",
    "https://exa\nmple.org",
    "ftp://example.org",
    "https://",
    "relative/path",
    `https://example.org/${"x".repeat(2048)}`,
  ])("rejects the link %j", (href) => {
    expect(codes(doc(paragraph(text("x", [{ type: "link", attrs: { href } }]))))).toEqual([
      "invalidAttribute",
    ]);
  });

  it.each([
    "https://example.org/a?b=c#d",
    "http://localhost:3000",
    "mailto:it@example.org",
    "/spaces/IT/pages/1",
  ])("accepts the link %j", (href) => {
    expect(codes(doc(paragraph(text("x", [{ type: "link", attrs: { href } }]))))).toEqual([]);
  });

  it("rejects missing required attributes", () => {
    expect(codes(doc(paragraph({ type: "mention" })))).toEqual(["missingAttribute"]);
    expect(codes(doc(paragraph(text("x", [{ type: "link" }]))))).toEqual(["missingAttribute"]);
  });

  it("rejects macro data above its size limit", () => {
    const data = { body: "x".repeat(256 * 1024) };
    expect(codes(doc({ type: "unsupportedMacro", attrs: { name: "x", data } }))).toEqual([
      "invalidAttribute",
    ]);
  });

  it("rejects invalid text", () => {
    expect(codes(doc(paragraph({ type: "text", text: "" })))).toEqual(["emptyText"]);
    expect(codes(doc(paragraph({ type: "text" })))).toEqual(["invalidText"]);
    expect(codes(doc(paragraph({ type: "text", text: "x", content: [] })))).toEqual(["unknownField"]);
  });

  it("applies node rules", () => {
    const column = (width: number) => ({ type: "column", attrs: { width }, content: [paragraph()] });
    expect(codes(doc({ type: "columns", content: [column(50), column(40)] }))).toEqual(["invalidNode"]);
    expect(codes(doc({ type: "columns", content: [column(33), column(33), column(33)] }))).toEqual([]);
    expect(codes(doc(paragraph({ type: "pageLink", attrs: { title: "Orphan" } })))).toEqual(["invalidNode"]);
    expect(codes(doc(paragraph({ type: "pageLink", attrs: { spaceId: ID, title: " " } })))).toEqual([
      "invalidNode",
    ]);
    expect(codes(doc(paragraph({ type: "pageLink", attrs: { pageId: ID } })))).toEqual([]);
    expect(
      codes(
        doc({
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableCell", attrs: { colspan: 2, colwidth: [100] }, content: [paragraph()] },
              ],
            },
          ],
        }),
      ),
    ).toEqual(["invalidNode"]);
  });

  it("rejects invalid structure", () => {
    expect(codes(doc())).toEqual(["invalidContent"]);
    expect(codes(doc(text("loose text")))).toEqual(["invalidContent"]);
    expect(codes(doc({ type: "bulletList", content: [paragraph()] }))).toEqual(["invalidContent"]);
    expect(codes(doc({ type: "columns", content: [{ type: "column", content: [paragraph()] }] }))).toEqual([
      "invalidContent",
    ]);
    expect(codes(doc({ type: "horizontalRule", content: [paragraph()] }))).toEqual(["invalidContent"]);
    expect(codes(doc({ type: "paragraph", content: "x" }))).toEqual(["invalidContent"]);
  });

  it("rejects marks where they are not allowed", () => {
    expect(codes(doc({ type: "codeBlock", content: [text("x", [{ type: "bold" }])] }))).toEqual([
      "markNotAllowed",
    ]);
  });

  it("rejects marks that exclude each other", () => {
    expect(codes(doc(paragraph(text("x", [{ type: "subscript" }, { type: "superscript" }]))))).toEqual([
      "conflictingMarks",
    ]);
    expect(codes(doc(paragraph(text("x", [{ type: "bold" }, { type: "code" }]))))).toEqual([
      "conflictingMarks",
    ]);
    expect(
      codes(doc(paragraph(text("x", [{ type: "code" }, { type: "link", attrs: { href: "/x" } }])))),
    ).toEqual([]);
  });

  it("exports its limits", () => {
    expect(limits).toEqual({
      maxDepth: MAX_DEPTH,
      maxDocumentBytes: MAX_DOCUMENT_BYTES,
      maxNodes: MAX_NODES,
    });
  });

  it("rejects content nested deeper than the depth limit", () => {
    const nest = (levels: number): unknown =>
      levels === 0 ? paragraph(text("deep")) : { type: "blockquote", content: [nest(levels - 1)] };
    expect(codes(doc(nest(MAX_DEPTH - 3)))).toEqual([]);
    expect(codes(doc(nest(MAX_DEPTH)))).toEqual(["tooDeep"]);
  });

  it("rejects documents above the size limit", () => {
    const chunk = "x".repeat(100_000);
    const count = Math.ceil(MAX_DOCUMENT_BYTES / chunk.length);
    expect(codes(doc(...Array.from({ length: count }, () => paragraph(text(chunk)))))).toEqual(["tooLarge"]);
    expect(codes(doc(...Array.from({ length: count - 2 }, () => paragraph(text(chunk)))))).toEqual([]);
  });

  it("rejects documents with more nodes than the node limit", () => {
    const breaks = (count: number) => Array.from({ length: count }, () => ({ type: "hardBreak" }));
    expect(codes(doc(paragraph(...breaks(MAX_NODES - 2))))).toEqual([]);
    expect(codes(doc(paragraph(...breaks(MAX_NODES))))).toEqual(["tooManyNodes"]);
  });

  it("reports the path of a problem", () => {
    const result = validateDocument(doc(paragraph(text("x")), paragraph(text("y", [{ type: "blink" }]))));
    expect(result.ok ? null : result.problems[0]?.path).toBe(".content[1].content[0].marks[0].type");
  });
});
