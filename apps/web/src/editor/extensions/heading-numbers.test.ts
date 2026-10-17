import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { schemaExtensions } from "../schema/extensions.js";
import { headingDecorations } from "./heading-numbers.js";

const schema = getSchema(schemaExtensions());

function heading(level: number, text: string) {
  return { type: "heading", attrs: { level }, content: [{ type: "text", text }] };
}

function numbers(enabled: boolean): string[] {
  const doc = schema.nodeFromJSON({
    type: "doc",
    content: [
      heading(1, "Overview"),
      heading(2, "Scope"),
      { type: "section", attrs: { key: "cause", title: "Cause" }, content: [{ type: "paragraph" }] },
      heading(3, "Details"),
      heading(1, "Plan"),
    ],
  });
  return headingDecorations(doc, enabled)
    .find()
    .map((decoration) => (decoration.spec as { key: string }).key);
}

describe("heading numbers in the editor", () => {
  it("number headings like the read view, print and Word, counting sections", () => {
    expect(numbers(true)).toEqual(["n1", "n1.1", "n1.2.1", "n2"]);
  });

  it("show no numbers while the page option is off", () => {
    expect(numbers(false)).toEqual([]);
  });
});
