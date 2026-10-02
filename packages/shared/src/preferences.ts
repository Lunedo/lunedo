import { z } from "zod";

export const colorModes = ["system", "light", "dark"] as const;
export type ColorMode = (typeof colorModes)[number];

export const textSizes = [0.875, 0.9375, 1, 1.125, 1.25] as const;
export type TextSize = (typeof textSizes)[number];

export const densities = ["default", "compact"] as const;
export type Density = (typeof densities)[number];

export const fonts = ["default", "readable"] as const;
export type Font = (typeof fonts)[number];

export const dateFormats = ["DD.MM.YYYY", "DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"] as const;
export type DateFormat = (typeof dateFormats)[number];

export const timeFormats = ["24h", "12h"] as const;
export type TimeFormat = (typeof timeFormats)[number];

export const numberFormats = ["en-US", "de-DE", "de-CH", "fr-FR"] as const;
export type NumberFormat = (typeof numberFormats)[number];

export const weekStarts = ["monday", "sunday", "saturday"] as const;
export type WeekStart = (typeof weekStarts)[number];

export interface Formats {
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  numberFormat: NumberFormat;
  firstDayOfWeek: WeekStart;
}

export const formatsSchema = z
  .object({
    dateFormat: z.enum(dateFormats),
    timeFormat: z.enum(timeFormats),
    numberFormat: z.enum(numberFormats),
    firstDayOfWeek: z.enum(weekStarts),
  })
  .strict();

export const defaultFormats: Formats = {
  dateFormat: "MM/DD/YYYY",
  timeFormat: "12h",
  numberFormat: "en-US",
  firstDayOfWeek: "sunday",
};

const GERMAN_FORMATS: Formats = {
  dateFormat: "DD.MM.YYYY",
  timeFormat: "24h",
  numberFormat: "de-DE",
  firstDayOfWeek: "monday",
};

const INTERNATIONAL_ENGLISH_FORMATS: Formats = {
  dateFormat: "DD/MM/YYYY",
  timeFormat: "24h",
  numberFormat: "en-US",
  firstDayOfWeek: "monday",
};

const SWISS_TIME_ZONES = new Set(["Europe/Zurich", "Europe/Vaduz"]);

export function proposeFormats(language: string, timeZone: string): Formats {
  if (language === "de") {
    return SWISS_TIME_ZONES.has(timeZone) ? { ...GERMAN_FORMATS, numberFormat: "de-CH" } : GERMAN_FORMATS;
  }
  return timeZone.startsWith("America/") || timeZone.startsWith("US/")
    ? defaultFormats
    : INTERNATIONAL_ENGLISH_FORMATS;
}

export interface DateParts {
  day: string;
  month: string;
  year: string;
}

export function dateParts(date: Date, timeZone: string): DateParts {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return { day: part("day"), month: part("month"), year: part("year") };
}

const DATE_PATTERNS: Record<DateFormat, (parts: DateParts) => string> = {
  "DD.MM.YYYY": ({ day, month, year }) => `${day}.${month}.${year}`,
  "DD/MM/YYYY": ({ day, month, year }) => `${day}/${month}/${year}`,
  "MM/DD/YYYY": ({ day, month, year }) => `${month}/${day}/${year}`,
  "YYYY-MM-DD": ({ day, month, year }) => `${year}-${month}-${day}`,
};

export function formatDate(date: Date, format: DateFormat, timeZone: string): string {
  return DATE_PATTERNS[format](dateParts(date, timeZone));
}

export const accentColors = ["petrol", "blue", "violet", "amber", "red", "green", "gray"] as const;
export type AccentColor = (typeof accentColors)[number];
