import { describe, expect, it } from "vitest";
import { withLanguageNumberFormat } from "./language-formats.js";

const entry = (key: string, value: unknown, source: string) => ({ key, value, source });

describe("number format default", () => {
  it("follows the language a person chose when they set no number format", () => {
    const list = withLanguageNumberFormat([
      entry("locale.language", "de", "user"),
      entry("locale.timeZone", "Europe/Vienna", "organization"),
      entry("locale.numberFormat", "en-US", "organization"),
    ]);
    expect(list.find((item) => item.key === "locale.numberFormat")).toEqual(
      entry("locale.numberFormat", "de-DE", "default"),
    );
    expect(
      new Intl.NumberFormat("de-DE", { style: "percent", maximumFractionDigits: 2 }).format(0.5301),
    ).toMatch(/^53,01\s%$/);
  });

  it("follows the inherited language when nothing sets a number format", () => {
    const list = withLanguageNumberFormat([
      entry("locale.language", "de", "organization"),
      entry("locale.timeZone", "Europe/Zurich", "organization"),
      entry("locale.numberFormat", "en-US", "default"),
    ]);
    expect(list.at(-1)?.value).toBe("de-CH");
  });

  it("keeps a number format the person or their organization chose for the same language", () => {
    const own = [entry("locale.language", "de", "user"), entry("locale.numberFormat", "en-US", "user")];
    expect(withLanguageNumberFormat(own)).toEqual(own);
    const organization = [
      entry("locale.language", "en", "organization"),
      entry("locale.numberFormat", "de-DE", "organization"),
    ];
    expect(withLanguageNumberFormat(organization)).toEqual(organization);
  });
});
