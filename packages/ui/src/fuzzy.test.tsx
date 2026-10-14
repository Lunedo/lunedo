import { describe, expect, it } from "vitest";
import { fuzzyMatch, highlightParts } from "./fuzzy.js";

describe("fuzzyMatch", () => {
  it("matches letters in order and marks them", () => {
    const match = fuzzyMatch("nwpg", "New page in IT Operations");
    expect(match).not.toBeNull();
    expect(highlightParts("New page in IT Operations", match?.ranges ?? [])).toEqual([
      { text: "N", highlighted: true },
      { text: "e", highlighted: false },
      { text: "w", highlighted: true },
      { text: " ", highlighted: false },
      { text: "p", highlighted: true },
      { text: "a", highlighted: false },
      { text: "g", highlighted: true },
      { text: "e in IT Operations", highlighted: false },
    ]);
  });

  it("ranks a connected match at the start of a word above scattered letters", () => {
    const connected = fuzzyMatch("new pa", "New page from template");
    const scattered = fuzzyMatch("new pa", "New blog post about a tool");
    expect(connected?.ranges).toEqual([
      [0, 3],
      [4, 6],
    ]);
    expect(connected?.score ?? 0).toBeGreaterThan(scattered?.score ?? -Infinity);
  });

  it("ignores case and accents and refuses letters out of order", () => {
    expect(fuzzyMatch("uber", "Über uns")?.ranges).toEqual([[0, 4]]);
    expect(fuzzyMatch("sg", "Go to settings")).not.toBeNull();
    expect(fuzzyMatch("tes", "Settings")).toBeNull();
  });

  it("falls back to the first occurrence when a word start leads nowhere", () => {
    expect(fuzzyMatch("ac", "xac a")?.ranges).toEqual([[1, 3]]);
  });
});
