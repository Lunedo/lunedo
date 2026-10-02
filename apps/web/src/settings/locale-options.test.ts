import type { TFunction } from "i18next";
import { beforeAll, describe, expect, it } from "vitest";
import { initI18n } from "../i18n/index.js";
import {
  dateFormatLabel,
  localeOptionSet,
  numberFormatLabel,
  timeFormatLabel,
  weekStartLabel,
} from "./locale-options.js";

let en: TFunction;
let de: TFunction;

beforeAll(async () => {
  en = (await initI18n(["en"])).getFixedT("en");
  de = (await initI18n(["de"])).getFixedT("de");
});

describe("locale options", () => {
  it("keep a format when the language changes", () => {
    expect(dateFormatLabel(de, "MM/DD/YYYY", "de")).toBe("MM/DD/YYYY (09/30/2026)");
    expect(dateFormatLabel(en, "DD.MM.YYYY", "en")).toBe("DD.MM.YYYY (30.09.2026)");
    expect(timeFormatLabel(de, "12h")).toBe("12-Stunden-Format (2:30 PM)");
    expect(numberFormatLabel(de, "en-US")).toBe("1,234,567.89");
    expect(weekStartLabel(de, "sunday")).toBe("Sonntag");
  });

  it("offer only concrete values", () => {
    for (const key of [
      "locale.dateFormat",
      "locale.timeFormat",
      "locale.numberFormat",
      "locale.firstDayOfWeek",
    ]) {
      const options = localeOptionSet(key)?.options(en, "en") ?? [];
      expect(options.length).toBeGreaterThan(1);
      expect(options.map((option) => option.value)).not.toContain("auto");
      expect(options.map((option) => option.label).join(" ")).not.toMatch(/Automatic/);
    }
  });

  it("show an example of the result in every format option", () => {
    const labels = (key: string) =>
      localeOptionSet(key)
        ?.options(en, "en")
        .map((option) => option.label);
    expect(labels("locale.dateFormat")).toContain("DD.MM.YYYY (30.09.2026)");
    expect(labels("locale.dateFormat")).toContain("YYYY-MM-DD (2026-09-30)");
    expect(labels("locale.timeFormat")).toEqual(
      expect.arrayContaining(["24-hour (14:30)", "12-hour (2:30 PM)"]),
    );
    expect(labels("locale.numberFormat")).toContain("1.234.567,89");
  });
});
