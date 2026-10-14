import { describe, expect, it } from "vitest";
import { cleanText, documentChunks, MAX_CHUNKS_PER_SOURCE, splitText, textChunks } from "./chunks.js";

describe("chunks", () => {
  it("keeps short sections whole and splits long ones at line and word boundaries", () => {
    expect(splitText("one\ntwo", 100)).toEqual(["one\ntwo"]);
    const long = Array.from({ length: 30 }, (_, index) => `word${index}`).join(" ");
    const pieces = splitText(long, 50);
    expect(pieces.every((piece) => piece.length <= 50)).toBe(true);
    expect(pieces.join(" ")).toBe(long);
  });

  it("removes control characters but keeps line breaks", () => {
    expect(cleanText("a\u0001b\nc\u0002")).toBe("a b\nc ");
  });

  it("gives every heading its own chunk and keeps a chunk for an empty page", () => {
    const chunks = documentChunks({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Intro" }] },
        { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
      ],
    });
    expect(chunks).toEqual([{ heading: "Intro", anchor: "intro", body: "Hello" }]);
    expect(documentChunks({ type: "doc", content: [{ type: "paragraph" }] })).toEqual([
      { heading: "", anchor: null, body: "" },
    ]);
  });

  it("limits the number of chunks of one source", () => {
    expect(textChunks("x ".repeat(2000 * (MAX_CHUNKS_PER_SOURCE + 5)))).toHaveLength(MAX_CHUNKS_PER_SOURCE);
  });
});
