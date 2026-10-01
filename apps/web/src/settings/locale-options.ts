import {
  type DateFormat,
  dateFormats,
  numberFormats,
  type TimeFormat,
  timeFormats,
  type WeekStart,
  weekStarts,
} from "@pagehall/shared";
import type { TFunction } from "i18next";
import { createFormatter, type Formatter, regionalLocale } from "../format/format.js";
import { timeZoneOptions } from "../format/time-zones.js";
import { supportedLanguages } from "../i18n/index.js";
import { translateKey } from "../i18n/translate.js";

const SAMPLE = new Date(Date.UTC(2026, 8, 30, 14, 30));
const SAMPLE_NUMBER = 1234567.89;

function formatterFor(language: string, dateFormat: DateFormat = "auto"): Formatter {
  return createFormatter({
    language,
    timeZone: "UTC",
    dateFormat,
    timeFormat: "auto",
    numberFormat: "auto",
    firstDayOfWeek: "auto",
  });
}

export function automaticHourCycle(language: string): "24h" | "12h" {
  const cycle = new Intl.DateTimeFormat(regionalLocale(language), { hour: "numeric" }).resolvedOptions()
    .hourCycle;
  return cycle === "h11" || cycle === "h12" ? "12h" : "24h";
}

function automatic(t: TFunction, resolved: string): string {
  return t("preferences.automaticResolved", { value: resolved });
}

export function dateFormatLabel(t: TFunction, value: string, language: string): string {
  if (value === "auto") return automatic(t, formatterFor(language).date(SAMPLE));
  return `${value} (${formatterFor(language, value as DateFormat).date(SAMPLE)})`;
}

export function timeFormatLabel(t: TFunction, value: string, language: string): string {
  if (value === "auto") {
    return automatic(
      t,
      automaticHourCycle(language) === "24h" ? t("preferences.hours24") : t("preferences.hours12"),
    );
  }
  return value === "24h" ? t("preferences.time24") : t("preferences.time12");
}

export function numberFormatLabel(t: TFunction, value: string, language: string): string {
  const locale = value === "auto" ? regionalLocale(language) : value;
  const example = new Intl.NumberFormat(locale, { minimumFractionDigits: 2 }).format(SAMPLE_NUMBER);
  return value === "auto" ? automatic(t, example) : example;
}

export function weekStartLabel(t: TFunction, value: string, language: string): string {
  const day = value === "auto" ? formatterFor(language).firstDayOfWeek : value;
  const name = translateKey(t, `preferences.weekdays.${day}`);
  return value === "auto" ? automatic(t, name) : name;
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
    options: (t, language) =>
      timeFormats.map((value: TimeFormat) => ({ value, label: timeFormatLabel(t, value, language) })),
    formatValue: (t, value, language) => timeFormatLabel(t, String(value), language),
  },
  {
    key: "locale.numberFormat",
    labelKey: "preferences.numberFormat",
    options: (t, language) =>
      numberFormats.map((value) => ({ value, label: numberFormatLabel(t, value, language) })),
    formatValue: (t, value, language) => numberFormatLabel(t, String(value), language),
  },
  {
    key: "locale.firstDayOfWeek",
    labelKey: "preferences.firstDayOfWeek",
    options: (t, language) =>
      weekStarts.map((value: WeekStart) => ({ value, label: weekStartLabel(t, value, language) })),
    formatValue: (t, value, language) => weekStartLabel(t, String(value), language),
  },
];

export function localeOptionSet(key: string): PreferenceOptionSet | undefined {
  return localeOptionSets.find((set) => set.key === key);
}
