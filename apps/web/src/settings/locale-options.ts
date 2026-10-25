import {
  type DateFormat,
  dateFormats,
  numberFormats,
  type TimeFormat,
  timeFormats,
  type WeekStart,
  weekStarts,
} from "@lunedo/shared";
import type { TFunction } from "i18next";
import { createFormatter, defaultFormatSettings, type Formatter } from "../format/format.js";
import { timeZoneOptions } from "../format/time-zones.js";
import { supportedLanguages } from "../i18n/index.js";
import { translateKey } from "../i18n/translate.js";

const SAMPLE_NUMBER = 1234567.89;

function sampleOf(now: Date): Date {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 14, 30));
}

function formatterFor(language: string, dateFormat: DateFormat): Formatter {
  return createFormatter({ ...defaultFormatSettings, language, timeZone: "UTC", dateFormat });
}

export function dateFormatLabel(_t: TFunction, value: string, language: string, now = new Date()): string {
  const example = (format: DateFormat) => formatterFor(language, format).date(sampleOf(now));
  const label = example(value as DateFormat);
  const ambiguous = dateFormats.some((other) => other !== value && example(other) === label);
  return ambiguous ? `${label} (${value})` : label;
}

export function timeFormatLabel(_t: TFunction, value: string, now = new Date()): string {
  const twelve = value === "12h";
  return new Intl.DateTimeFormat("en", {
    timeZone: "UTC",
    hour: twelve ? "numeric" : "2-digit",
    minute: "2-digit",
    hour12: twelve,
  }).format(sampleOf(now));
}

export function numberFormatLabel(_t: TFunction, value: string): string {
  return new Intl.NumberFormat(value, { minimumFractionDigits: 2 }).format(SAMPLE_NUMBER);
}

export function weekStartLabel(t: TFunction, value: string): string {
  return translateKey(t, `preferences.weekdays.${value}`);
}

export function languageLabel(t: TFunction, value: unknown): string {
  return typeof value === "string" ? translateKey(t, `languages.${value}`) : "";
}

export interface PreferenceOptionSet {
  key: string;
  labelKey: string;
  options: (t: TFunction, language: string) => { value: string; label: string; group?: string }[];
  formatValue: (t: TFunction, value: unknown, language: string) => string;
}

export const localeOptionSets: PreferenceOptionSet[] = [
  {
    key: "locale.language",
    labelKey: "preferences.language",
    options: (t) =>
      supportedLanguages.map((language) => ({ value: language, label: languageLabel(t, language) })),
    formatValue: (t, value) => languageLabel(t, value),
  },
  {
    key: "locale.timeZone",
    labelKey: "preferences.timeZone",
    options: () => timeZoneOptions(),
    formatValue: (_t, value) => String(value ?? "").replaceAll("_", " "),
  },
  {
    key: "locale.dateFormat",
    labelKey: "preferences.dateFormat",
    options: (t, language) =>
      dateFormats.map((value) => ({ value, label: dateFormatLabel(t, value, language) })),
    formatValue: (t, value, language) => dateFormatLabel(t, String(value), language),
  },
  {
    key: "locale.timeFormat",
    labelKey: "preferences.timeFormat",
    options: (t) => timeFormats.map((value: TimeFormat) => ({ value, label: timeFormatLabel(t, value) })),
    formatValue: (t, value) => timeFormatLabel(t, String(value)),
  },
  {
    key: "locale.numberFormat",
    labelKey: "preferences.numberFormat",
    options: (t) => numberFormats.map((value) => ({ value, label: numberFormatLabel(t, value) })),
    formatValue: (t, value) => numberFormatLabel(t, String(value)),
  },
  {
    key: "locale.firstDayOfWeek",
    labelKey: "preferences.firstDayOfWeek",
    options: (t) => weekStarts.map((value: WeekStart) => ({ value, label: weekStartLabel(t, value) })),
    formatValue: (t, value) => weekStartLabel(t, String(value)),
  },
];

export function localeOptionSet(key: string): PreferenceOptionSet | undefined {
  return localeOptionSets.find((set) => set.key === key);
}
