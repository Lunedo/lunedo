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
  it("show what an automatic value resolves to", () => {
    expect(dateFormatLabel(de, "auto", "de")).toBe("Automatisch (30.09.2026)");
    expect(timeFormatLabel(de, "auto", "de")).toBe("Automatisch (24-Stunden-Format)");
    expect(numberFormatLabel(de, "auto", "de")).toBe("Automatisch (1.234.567,89)");
    expect(weekStartLabel(de, "auto", "de")).toBe("Automatisch (Montag)");
    expect(weekStartLabel(en, "auto", "en")).toMatch(/^Automatic \((Sunday|Monday)\)$/);
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
