import type { TFunction } from "i18next";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "../i18n/index.js";
import {
  dateFormatLabel,
  localeOptionSet,
  numberFormatLabel,
  timeFormatLabel,
  weekStartLabel,
} from "./locale-options.js";

const TODAY = new Date(2026, 9, 24, 9, 0);
let en: TFunction;
let de: TFunction;

beforeAll(async () => {
  en = (await initI18n(["en"])).getFixedT("en");
  de = (await initI18n(["de"])).getFixedT("de");
});

describe("locale options", () => {
  it("keep a format when the language changes", () => {
    expect(dateFormatLabel(de, "MM/DD/YYYY", "de", TODAY)).toBe("10/24/2026");
    expect(dateFormatLabel(en, "DD.MM.YYYY", "en", TODAY)).toBe("24.10.2026");
    expect(timeFormatLabel(de, "12h", TODAY)).toBe("2:30 PM");
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

  it("show only an example with today's date, and the format only where two examples look alike", () => {
    expect(dateFormatLabel(de, "D MMM YYYY", "de", TODAY)).toBe("24. Okt. 2026");
    expect(dateFormatLabel(en, "DD/MM/YYYY", "en", new Date(2026, 9, 10))).toBe("10/10/2026 (DD/MM/YYYY)");
    expect(dateFormatLabel(en, "MM/DD/YYYY", "en", new Date(2026, 9, 10))).toBe("10/10/2026 (MM/DD/YYYY)");
    expect(timeFormatLabel(en, "24h", TODAY)).toBe("14:30");
  });

  it("show an example of the result in every format option", () => {
    const labels = (key: string) =>
      localeOptionSet(key)
        ?.options(en, "en")
        .map((option) => option.label);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(TODAY);
    expect(labels("locale.dateFormat")?.join(" ")).not.toMatch(/YYYY|MMM/);
    vi.useRealTimers();
    expect(labels("locale.timeFormat")).toEqual(["14:30", "2:30 PM"]);
    expect(labels("locale.numberFormat")).toContain("1.234.567,89");
  });
});
