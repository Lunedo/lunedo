import type { DateFormat, NumberFormat, TimeFormat, WeekStart } from "@pagehall/shared";

export interface FormatSettings {
  language: string;
  timeZone: string;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  numberFormat: NumberFormat;
  firstDayOfWeek: WeekStart;
}

export type Weekday = "monday" | "sunday" | "saturday";

export interface Formatter {
  settings: FormatSettings;
  date(value: Date | string): string;
  time(value: Date | string): string;
  dateTime(value: Date | string): string;
  relative(value: Date | string, now?: Date): string;
  number(value: number): string;
  percent(value: number): string;
  bytes(value: number): string;
  firstDayOfWeek: Weekday;
}

const WEEKDAYS: Record<number, Weekday> = { 1: "monday", 6: "saturday", 7: "sunday" };

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function weekStartOf(locale: string): Weekday {
  try {
    const info = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const firstDay = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay;
    if (firstDay !== undefined) return WEEKDAYS[firstDay] ?? "monday";
  } catch {
    return "monday";
  }
  return locale.startsWith("en-US") ? "sunday" : "monday";
}

function regionalLocale(language: string): string {
  const browser = globalThis.navigator?.language ?? "";
  return browser.toLowerCase().startsWith(`${language}-`) ? browser : language;
}

function dateParts(date: Date, timeZone: string): { day: string; month: string; year: string } {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return { day: part("day"), month: part("month"), year: part("year") };
}

const PATTERNS: Record<
  Exclude<DateFormat, "auto">,
  (parts: { day: string; month: string; year: string }) => string
> = {
  "DD.MM.YYYY": ({ day, month, year }) => `${day}.${month}.${year}`,
  "DD/MM/YYYY": ({ day, month, year }) => `${day}/${month}/${year}`,
  "MM/DD/YYYY": ({ day, month, year }) => `${month}/${day}/${year}`,
  "YYYY-MM-DD": ({ day, month, year }) => `${year}-${month}-${day}`,
};

export function createFormatter(settings: FormatSettings): Formatter {
  const locale = regionalLocale(settings.language);
  const numberLocale = settings.numberFormat === "auto" ? locale : settings.numberFormat;
  const hour12 = settings.timeFormat === "auto" ? undefined : settings.timeFormat === "12h";
  const timeFormatter = new Intl.DateTimeFormat(locale, {
    timeZone: settings.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    ...(hour12 === undefined ? {} : { hour12 }),
  });
  const autoDate = new Intl.DateTimeFormat(locale, { timeZone: settings.timeZone, dateStyle: "medium" });
  const numbers = new Intl.NumberFormat(numberLocale);
  const percent = new Intl.NumberFormat(numberLocale, { style: "percent", maximumFractionDigits: 1 });
  const relative = new Intl.RelativeTimeFormat(settings.language, { numeric: "auto" });

  const date = (value: Date | string) => {
    const parsed = toDate(value);
    if (settings.dateFormat === "auto") return autoDate.format(parsed);
    return PATTERNS[settings.dateFormat](dateParts(parsed, settings.timeZone));
  };
  const time = (value: Date | string) => timeFormatter.format(toDate(value));

  return {
    settings,
    date,
    time,
    dateTime: (value) => `${date(value)} ${time(value)}`,
    relative(value, now = new Date()) {
      const seconds = Math.round((toDate(value).getTime() - now.getTime()) / 1000);
      const absolute = Math.abs(seconds);
      if (absolute < 60) return relative.format(seconds, "second");
      if (absolute < 3600) return relative.format(Math.round(seconds / 60), "minute");
      if (absolute < 86_400) return relative.format(Math.round(seconds / 3600), "hour");
      if (absolute < 30 * 86_400) return relative.format(Math.round(seconds / 86_400), "day");
      return date(value);
    },
    number: (value) => numbers.format(value),
    percent: (value) => percent.format(value),
    bytes(value) {
      const units = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"] as const;
      let size = value;
      let unit = 0;
      while (size >= 1024 && unit < units.length - 1) {
        size /= 1024;
        unit += 1;
      }
      return new Intl.NumberFormat(numberLocale, {
        style: "unit",
        unit: units[unit],
        unitDisplay: "short",
        maximumFractionDigits: unit === 0 ? 0 : 1,
      }).format(size);
    },
    firstDayOfWeek: settings.firstDayOfWeek === "auto" ? weekStartOf(locale) : settings.firstDayOfWeek,
  };
}

export const defaultFormatSettings: FormatSettings = {
  language: "en",
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  dateFormat: "auto",
  timeFormat: "auto",
  numberFormat: "auto",
  firstDayOfWeek: "auto",
};
