import { describe, expect, it } from "vitest";
import { keepSeparatorWithWord } from "./separators.js";

describe("keepSeparatorWithWord", () => {
  it("glues a middle dot to the word before it so that no line starts with it", () => {
    expect(keepSeparatorWithWord("Platform weekly · 14 Oct 2026")).toBe("Platform weekly\u00A0· 14 Oct 2026");
    expect(keepSeparatorWithWord("No separator")).toBe("No separator");
  });
});
