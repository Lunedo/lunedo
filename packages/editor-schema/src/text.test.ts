import { describe, expect, it } from "vitest";
import { slugify } from "./text.js";

describe("slugify", () => {
  it("turns umlauts into two letters and drops punctuation", () => {
    expect(slugify("Flüghäfen & Co. (Wien)")).toBe("flueghaefen-co-wien");
  });

  it("writes every umlaut in both cases and sharp s as two letters", () => {
    expect(slugify("ä ö ü")).toBe("ae-oe-ue");
    expect(slugify("Ä Ö Ü")).toBe("ae-oe-ue");
    expect(slugify("Äpfel Öfen Übung")).toBe("aepfel-oefen-uebung");
    expect(slugify("Straße STRAẞE")).toBe("strasse-strasse");
  });

  it("keeps umlauts written with a combining mark", () => {
    expect(slugify("Geräte")).toBe("geraete");
  });

  it("removes all other diacritics", () => {
    expect(slugify("Crème brûlée à la façon")).toBe("creme-brulee-a-la-facon");
    expect(slugify("Señor Ångström Dvořák")).toBe("senor-angstroem-dvorak");
    expect(slugify("Øresund Łódź Đakovo")).toBe("oresund-lodz-dakovo");
  });

  it("replaces symbols with a single hyphen", () => {
    expect(slugify("50 % & $ 10 € ? !")).toBe("50-10");
    expect(slugify("--a__b//c--")).toBe("a-b-c");
    expect(slugify("  Hello,   World!  ")).toBe("hello-world");
  });

  it("keeps letters of non-Latin scripts", () => {
    expect(slugify("Привет мир")).toBe("привет-мир");
    expect(slugify("Йошкар-Ола")).toBe("йошкар-ола");
    expect(slugify("Ελληνικά")).toBe("ελληνικά");
    expect(slugify("東京 タワー")).toBe("東京-タワー");
    expect(slugify("がぎ")).toBe("がぎ");
    expect(slugify("हिन्दी")).toBe("हिन्दी");
  });

  it("limits the slug to 80 characters and cuts at a hyphen", () => {
    const words = Array.from({ length: 20 }, (_, index) => `word${index}`).join(" ");
    const slug = slugify(words);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("-")).toBe(false);
    expect(words.toLowerCase().replaceAll(" ", "-").startsWith(`${slug}-`)).toBe(true);
    expect(slugify("x".repeat(100))).toBe("x".repeat(80));
    expect(slugify(`${"a".repeat(80)} b`)).toBe("a".repeat(80));
  });

  it("returns an empty slug when nothing remains", () => {
    expect(slugify("")).toBe("");
    expect(slugify("% & ? !")).toBe("");
  });
});
