import { describe, expect, it } from "vitest";
import { isEmptyDocument } from "./empty-document.js";

describe("isEmptyDocument", () => {
  it("is true for no content and for paragraphs without text", () => {
    expect(isEmptyDocument(null)).toBe(true);
    expect(isEmptyDocument({})).toBe(true);
    expect(isEmptyDocument({ content: [] })).toBe(true);
    expect(isEmptyDocument({ content: [{ type: "paragraph" }, { type: "paragraph", content: [] }] })).toBe(
      true,
    );
    expect(
      isEmptyDocument({ content: [{ type: "paragraph", content: [{ type: "text", text: "  " }] }] }),
    ).toBe(true);
  });

  it("is false as soon as anything is written or any other block exists", () => {
    expect(
      isEmptyDocument({ content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] }),
    ).toBe(false);
    expect(isEmptyDocument({ content: [{ type: "horizontalRule" }] })).toBe(false);
    expect(isEmptyDocument({ content: [{ type: "heading", attrs: { level: 1 } }] })).toBe(false);
  });
});
