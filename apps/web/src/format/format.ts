import {
  type DateFormat,
  defaultFormats,
  formatDate,
  type NumberFormat,
  type TimeFormat,
  type WeekStart,
} from "@pagehall/shared";
import { browserTimeZone } from "./time-zones.js";

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

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function createFormatter(settings: FormatSettings): Formatter {
  const numberLocale = settings.numberFormat;
  const timeFormatter = new Intl.DateTimeFormat(settings.language, {
    timeZone: settings.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: settings.timeFormat === "12h",
  });
  const numbers = new Intl.NumberFormat(numberLocale);
  const percent = new Intl.NumberFormat(numberLocale, { style: "percent", maximumFractionDigits: 2 });
  const relative = new Intl.RelativeTimeFormat(settings.language, { numeric: "auto" });

  const date = (value: Date | string) =>
    formatDate(toDate(value), settings.dateFormat, settings.timeZone, settings.language);
  const time = (value: Date | string) => timeFormatter.format(toDate(value));

  return {
    settings,
    date,
    time,
    dateTime: (value) => `${date(value)}, ${time(value)}`,
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
        unitDisplay: unit === 0 ? "long" : "short",
        maximumFractionDigits: unit === 0 ? 0 : 1,
      }).format(size);
    },
    firstDayOfWeek: settings.firstDayOfWeek,
  };
}

export const defaultFormatSettings: FormatSettings = {
  language: "en",
  timeZone: browserTimeZone(),
  ...defaultFormats,
};
