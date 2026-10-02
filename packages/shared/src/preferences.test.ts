import { describe, expect, it } from "vitest";
import {
  dateFormats,
  defaultFormats,
  formatDate,
  proposeFormats,
  timeFormats,
  weekStarts,
} from "./preferences.js";

describe("formats", () => {
  it("have only concrete values", () => {
    for (const values of [dateFormats, timeFormats, weekStarts] as readonly (readonly string[])[]) {
      expect(values).not.toContain("auto");
    }
  });

  it("propose formats from the language and the time zone", () => {
    expect(proposeFormats("de", "Europe/Vienna")).toEqual({
      dateFormat: "DD.MM.YYYY",
      timeFormat: "24h",
      numberFormat: "de-DE",
      firstDayOfWeek: "monday",
    });
    expect(proposeFormats("de", "Europe/Zurich").numberFormat).toBe("de-CH");
    expect(proposeFormats("en", "America/New_York")).toEqual(defaultFormats);
    expect(proposeFormats("en", "Europe/London")).toEqual({
      dateFormat: "DD/MM/YYYY",
      timeFormat: "24h",
      numberFormat: "en-US",
      firstDayOfWeek: "monday",
    });
  });

  it("formats a date in the given pattern and time zone", () => {
    const instant = new Date(Date.UTC(2026, 8, 30, 23, 30));
    expect(formatDate(instant, "DD.MM.YYYY", "UTC")).toBe("30.09.2026");
    expect(formatDate(instant, "MM/DD/YYYY", "UTC")).toBe("09/30/2026");
    expect(formatDate(instant, "YYYY-MM-DD", "Europe/Vienna")).toBe("2026-10-01");
    expect(formatDate(instant, "DD/MM/YYYY", "Europe/Vienna")).toBe("01/10/2026");
  });
});
