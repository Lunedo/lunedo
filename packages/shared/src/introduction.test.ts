import { describe, expect, it } from "vitest";
import { introductionText, parseIntroduction } from "./introduction.js";

describe("parseIntroduction", () => {
  it("reads bold, italic and links", () => {
    expect(
      parseIntroduction("Open **Outlook** in *the* browser: [outlook](https://outlook.example.org)"),
    ).toEqual([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Open ", bold: false, italic: false },
          { type: "text", text: "Outlook", bold: true, italic: false },
          { type: "text", text: " in ", bold: false, italic: false },
          { type: "text", text: "the", bold: false, italic: true },
          { type: "text", text: " browser: ", bold: false, italic: false },
          { type: "link", text: "outlook", href: "https://outlook.example.org" },
        ],
      },
    ]);
  });

  it("keeps links with other schemes as plain text", () => {
    const [block] = parseIntroduction("[click](javascript:alert(1)) and [x](data:text/html,1)");
    expect(block?.content.every((inline) => inline.type === "text")).toBe(true);
    expect(introductionText("[click](javascript:alert(1))")).toContain("javascript:");
  });

  it("allows mail links", () => {
    const [block] = parseIntroduction("[Write us](mailto:help@example.org)");
    expect(block?.content).toEqual([{ type: "link", text: "Write us", href: "mailto:help@example.org" }]);
  });

  it("turns only the first quoted block into a callout", () => {
    const blocks = parseIntroduction("Intro\n\n> Note one\n> goes on\n\n> Second note");
    expect(blocks.map((block) => block.type)).toEqual(["paragraph", "callout", "paragraph"]);
    expect(blocks[1]?.content).toEqual([
      { type: "text", text: "Note one", bold: false, italic: false },
      { type: "break" },
      { type: "text", text: "goes on", bold: false, italic: false },
    ]);
    expect(introductionText("> Second note")).toBe("Second note");
  });

  it("keeps plain text and markup characters that do not form a mark", () => {
    expect(introductionText("2 * 3 = 6 and snake_case")).toBe("2 * 3 = 6 and snake_case");
    expect(parseIntroduction("")).toEqual([]);
    expect(parseIntroduction("Line\r\nnext")[0]?.content).toHaveLength(3);
  });
});
