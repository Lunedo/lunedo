import { describe, expect, it } from "vitest";
import { createFormatter, type FormatSettings } from "./format.js";

const base: FormatSettings = {
  language: "en",
  timeZone: "Europe/Vienna",
  dateFormat: "MM/DD/YYYY",
  timeFormat: "12h",
  numberFormat: "en-US",
  firstDayOfWeek: "sunday",
};

const moment = "2026-09-30T22:30:00.000Z";

describe("createFormatter", () => {
  it("writes dates in the chosen pattern and time zone", () => {
    expect(createFormatter({ ...base, dateFormat: "DD.MM.YYYY" }).date(moment)).toBe("01.10.2026");
    expect(createFormatter({ ...base, dateFormat: "YYYY-MM-DD" }).date(moment)).toBe("2026-10-01");
    expect(createFormatter({ ...base, dateFormat: "MM/DD/YYYY" }).date(moment)).toBe("10/01/2026");
    expect(createFormatter({ ...base, dateFormat: "DD/MM/YYYY", timeZone: "UTC" }).date(moment)).toBe(
      "30/09/2026",
    );
  });

  it("keeps every format when the language changes", () => {
    const german = createFormatter({ ...base, language: "de" });
    expect(german.date(moment)).toBe("10/01/2026");
    expect(german.number(1234.5)).toBe("1,234.5");
    expect(german.firstDayOfWeek).toBe("sunday");
    expect(german.time(moment)).toMatch(/12:30\s?AM/i);
  });

  it("uses the chosen clock", () => {
    expect(createFormatter({ ...base, timeFormat: "24h" }).time(moment)).toBe("00:30");
    expect(createFormatter({ ...base, timeFormat: "12h" }).time(moment)).toMatch(/12:30\s?AM/i);
  });

  it("formats numbers with the chosen separators", () => {
    expect(createFormatter({ ...base, numberFormat: "de-DE" }).number(1234.5)).toBe("1.234,5");
    expect(createFormatter({ ...base, numberFormat: "en-US" }).number(1234.5)).toBe("1,234.5");
  });

  it("describes recent moments relative to now and older ones as dates", () => {
    const formatter = createFormatter({ ...base, dateFormat: "YYYY-MM-DD" });
    const now = new Date("2026-10-01T10:00:00Z");
    expect(formatter.relative("2026-10-01T09:55:00Z", now)).toBe("5 minutes ago");
    expect(formatter.relative("2026-09-30T10:00:00Z", now)).toBe("yesterday");
    expect(formatter.relative("2026-07-01T10:00:00Z", now)).toBe("2026-07-01");
  });

  it("names byte sizes", () => {
    expect(createFormatter(base).bytes(212 * 1024 ** 3)).toBe("212 GB");
    expect(createFormatter(base).bytes(512)).toBe("512 byte");
  });

  it("uses the chosen first day of the week", () => {
    expect(createFormatter({ ...base, firstDayOfWeek: "sunday" }).firstDayOfWeek).toBe("sunday");
    expect(createFormatter({ ...base, firstDayOfWeek: "monday" }).firstDayOfWeek).toBe("monday");
  });
});
