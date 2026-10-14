import { describe, expect, it } from "vitest";
import { type DocumentJson, extractHeadings, extractSections } from "./index.js";

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const heading = (level: number, text: string) => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});

describe("extractSections", () => {
  it("splits the text at every heading and keeps the heading ids of the rendered page", () => {
    const document: DocumentJson = {
      type: "doc",
      content: [
        paragraph("Before any heading."),
        heading(1, "Setup"),
        paragraph("Install the client."),
        paragraph("Sign in."),
        heading(2, "Setup"),
        { type: "section", attrs: { key: "cause", title: "Cause" }, content: [paragraph("A full disk.")] },
      ],
    };
    const sections = extractSections(document);
    expect(sections).toEqual([
      { heading: null, text: "Before any heading." },
      { heading: { level: 1, text: "Setup", id: "setup" }, text: "Install the client.\nSign in." },
      { heading: { level: 2, text: "Setup", id: "setup-2" }, text: "" },
      { heading: { level: 2, text: "Cause", id: "cause" }, text: "A full disk." },
    ]);
    expect(sections.flatMap((section) => (section.heading ? [section.heading] : []))).toEqual(
      extractHeadings(document),
    );
  });

  it("includes the content of containers that plain text leaves out", () => {
    const document: DocumentJson = {
      type: "doc",
      content: [
        { type: "expand", attrs: { title: "Details" }, content: [paragraph("Hidden until opened.")] },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [paragraph("Cell one")] },
                { type: "tableCell", content: [paragraph("Cell two")] },
              ],
            },
          ],
        },
      ],
    };
    expect(extractSections(document)).toEqual([
      { heading: null, text: "Details\nHidden until opened.\nCell one\nCell two" },
    ]);
  });

  it("returns nothing for an empty document", () => {
    expect(extractSections({ type: "doc", content: [{ type: "paragraph" }] })).toEqual([]);
  });
});
