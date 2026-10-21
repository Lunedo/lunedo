import de from "emojibase-data/de/compact.json";
import en from "emojibase-data/en/compact.json";
import { describe, expect, it } from "vitest";
import { toEntries, usableEmoji } from "./emoji-picker.js";

const RGI = /^\p{RGI_Emoji}$/v;

describe("emoji picker data", () => {
  it.each([
    ["en", en],
    ["de", de],
  ])("offers the same stored values in %s as before", (_language, data) => {
    const offered = new Set(toEntries(data).map((entry) => entry.emoji));
    for (const emoji of ["👍", "⌚", "❤️", "🏳️‍🌈", "👩‍💻", "1️⃣", "🇦🇹", "☺️", "✔️"]) {
      expect(offered.has(emoji), emoji).toBe(true);
    }
    expect(offered.has("👍️")).toBe(false);
    expect(offered.has("⌚️")).toBe(false);
  });

  it("offers only values that reactions and emoji nodes accept", () => {
    for (const entry of toEntries(en)) expect(RGI.test(entry.emoji), entry.emoji).toBe(true);
  });

  it("keeps values stored with a redundant variation selector equal to the current ones", () => {
    expect(usableEmoji("👍️")).toBe("👍");
    expect(usableEmoji("⌚️")).toBe("⌚");
    expect(usableEmoji("❤️")).toBe("❤️");
    expect(usableEmoji("not an emoji")).toBeNull();
  });
});
