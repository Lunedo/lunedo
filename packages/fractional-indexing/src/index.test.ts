import { describe, expect, it } from "vitest";
import { generateKeyBetween, generateNKeysBetween, validateOrderKey } from "./index.js";

describe("generateKeyBetween", () => {
  it.each([
    [null, null, "a0"],
    [null, "a0", "Zz"],
    [null, "Zz", "Zy"],
    ["a0", null, "a1"],
    ["a1", null, "a2"],
    ["Zz", null, "a0"],
    ["a0", "a1", "a0V"],
    ["a1", "a2", "a1V"],
    ["a0V", "a1", "a0l"],
    ["Zz", "a0", "ZzV"],
    ["Zz", "a1", "a0"],
    [null, "Y00", "Xzzz"],
    ["bzz", null, "c000"],
    ["a0", "a0V", "a0G"],
    ["a0", "a0G", "a08"],
    ["b125", "b129", "b127"],
    ["a0", "a1V", "a1"],
    ["Zz", "a01", "a0"],
    [null, "a0V", "a0"],
    [null, "b999", "b99"],
    ["zzzzzzzzzzzzzzzzzzzzzzzzzzz", null, "zzzzzzzzzzzzzzzzzzzzzzzzzzzV"],
  ])("puts a key between %s and %s", (a, b, expected) => {
    expect(generateKeyBetween(a, b)).toBe(expected);
  });

  it.each([
    ["a0", "a0"],
    ["a1", "a0"],
    ["a00", null],
    ["A00000000000000000000000000", null],
    ["0", null],
  ])("refuses %s and %s", (a, b) => {
    expect(() => generateKeyBetween(a, b)).toThrow();
  });

  it("keeps keys ordered when inserting repeatedly at both ends and in the middle", () => {
    const keys = [generateKeyBetween(null, null)];
    for (let round = 0; round < 300; round++) {
      const position = round % 3;
      if (position === 0) keys.unshift(generateKeyBetween(null, keys[0]));
      else if (position === 1) keys.push(generateKeyBetween(keys.at(-1), null));
      else {
        const index = Math.floor(keys.length / 2);
        keys.splice(index, 0, generateKeyBetween(keys[index - 1], keys[index]));
      }
    }
    const sorted = [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(keys).toEqual(sorted);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(() => validateOrderKey(key)).not.toThrow();
  });
});

describe("generateNKeysBetween", () => {
  it("creates keys at the start, the end and between two keys", () => {
    expect(generateNKeysBetween(null, null, 5)).toEqual(["a0", "a1", "a2", "a3", "a4"]);
    expect(generateNKeysBetween("a4", null, 3)).toEqual(["a5", "a6", "a7"]);
    expect(generateNKeysBetween(null, "a0", 3)).toEqual(["Zx", "Zy", "Zz"]);
    expect(generateNKeysBetween("a0", "a2", 0)).toEqual([]);
    const between = generateNKeysBetween("a0", "a1", 20);
    expect(between).toHaveLength(20);
    expect(
      between.every(
        (key, index) => key > "a0" && key < "a1" && (index === 0 || key > (between[index - 1] ?? "")),
      ),
    ).toBe(true);
  });
});
