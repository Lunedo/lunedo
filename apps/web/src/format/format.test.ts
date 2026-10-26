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
  it("says how far away a date is in days, months or years", () => {
    const now = new Date("2026-10-26T10:00:00.000Z");
    const distance = (value: string, language = "en") =>
      createFormatter({ ...base, language }).distance(value, now);
    expect(distance("2026-11-05T10:00:00.000Z")).toBe("in 10 days");
    expect(distance("2027-02-21T10:00:00.000Z")).toBe("in 4 months");
    expect(distance("2028-10-26T10:00:00.000Z")).toBe("in 2 years");
    expect(distance("2027-02-21T10:00:00.000Z", "de")).toBe("in 4 Monaten");
  });

  it("writes dates in the chosen pattern and time zone", () => {
    expect(createFormatter({ ...base, dateFormat: "DD.MM.YYYY" }).date(moment)).toBe("01.10.2026");
    expect(createFormatter({ ...base, dateFormat: "YYYY-MM-DD" }).date(moment)).toBe("2026-10-01");
    expect(createFormatter({ ...base, dateFormat: "MM/DD/YYYY" }).date(moment)).toBe("10/01/2026");
    expect(createFormatter({ ...base, dateFormat: "DD/MM/YYYY", timeZone: "UTC" }).date(moment)).toBe(
      "30/09/2026",
    );
  });

  it("spells the month out so that day and month cannot be mixed up", () => {
    const english = createFormatter({ ...base, dateFormat: "D MMM YYYY", timeFormat: "24h" });
    expect(english.date("2026-10-07T09:30:00.000Z")).toBe("7 Oct 2026");
    expect(english.dateTime("2026-10-07T07:30:00.000Z")).toBe("7 Oct 2026, 09:30");
    expect(english.date("2026-09-06T10:00:00.000Z")).toBe("6 Sep 2026");
    const german = createFormatter({ ...base, language: "de", dateFormat: "D MMM YYYY", timeFormat: "24h" });
    expect(german.date("2026-10-07T09:30:00.000Z")).toBe("7. Okt. 2026");
    expect(german.dateTime("2026-10-07T07:30:00.000Z")).toBe("7. Okt. 2026, 09:30");
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

  it("writes short dates: relative today, yesterday, day and month this year, with the year before", () => {
    const formatter = createFormatter({ ...base, language: "de", timeZone: "Europe/Vienna" });
    const now = new Date("2026-10-23T12:00:00Z");
    expect(formatter.short("2026-10-23T10:00:00Z", now)).toBe("vor 2 Std.");
    expect(formatter.short("2026-10-23T11:59:40Z", now)).toBe("in dieser Minute");
    expect(formatter.short("2026-10-22T08:00:00Z", now)).toBe("gestern");
    expect(formatter.short("2026-10-20T08:00:00Z", now)).toBe("20. Okt.");
    expect(formatter.short("2025-10-22T08:00:00Z", now)).toBe("22. Okt. 2025");
    expect(formatter.short("2026-10-26T08:00:00Z", now)).toBe("26. Okt.");
    expect(formatter.short("2026-10-24T08:00:00Z", now)).toBe("morgen");
  });

  it("writes days and dates with times by the same rule", () => {
    const formatter = createFormatter({
      ...base,
      language: "de",
      timeZone: "Europe/Vienna",
      timeFormat: "24h",
    });
    const now = new Date("2026-10-23T12:00:00Z");
    expect(formatter.day("2026-10-23T05:00:00Z", now)).toBe("heute");
    expect(formatter.day("2026-10-22T23:30:00Z", now)).toBe("heute");
    expect(formatter.day("2026-10-26T12:00:00Z", now)).toBe("26. Okt.");
    expect(formatter.day("2027-01-04T12:00:00Z", now)).toBe("4. Jan. 2027");
    expect(formatter.shortDateTime("2026-10-26T07:30:00Z", now)).toBe("26. Okt., 08:30");
    expect(formatter.shortDateTime("2026-10-23T14:00:00Z", now)).toBe("heute, 16:00");
    expect(formatter.calendarDate("2026-10-23T14:00:00Z", now)).toBe("23. Okt.");
    expect(formatter.calendarDateTime("2025-10-23T14:00:00Z", now)).toBe("23. Okt. 2025, 16:00");
    expect(formatter.weekdayDate("2026-11-02T08:00:00Z", now)).toBe("Montag, 2. Nov.");
    expect(formatter.weekdayDate("2027-01-04T08:00:00Z", now)).toBe("Montag, 4. Jan. 2027");
    expect(formatter.weekdayDateTime("2026-11-02T08:00:00Z", now)).toBe("Montag, 2. Nov., 09:00");
  });

  it("names byte sizes", () => {
    expect(createFormatter(base).bytes(212 * 1024 ** 3)).toBe("212 GB");
    expect(createFormatter(base).bytes(512)).toBe("512 bytes");
    expect(createFormatter(base).bytes(70)).toBe("70 bytes");
    expect(createFormatter(base).bytes(1)).toBe("1 byte");
    expect(createFormatter({ ...base, language: "de", numberFormat: "de-DE" }).bytes(70)).toBe("70 Byte");
  });

  it("uses the chosen first day of the week", () => {
    expect(createFormatter({ ...base, firstDayOfWeek: "sunday" }).firstDayOfWeek).toBe("sunday");
    expect(createFormatter({ ...base, firstDayOfWeek: "monday" }).firstDayOfWeek).toBe("monday");
  });
});
