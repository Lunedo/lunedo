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
import { createFormatter, defaultFormatSettings, type Formatter } from "../format/format.js";
import { timeZoneOptions } from "../format/time-zones.js";
import { supportedLanguages } from "../i18n/index.js";
import { translateKey } from "../i18n/translate.js";

const SAMPLE = new Date(Date.UTC(2026, 8, 30, 14, 30));
const SAMPLE_NUMBER = 1234567.89;

function formatterFor(language: string, dateFormat: DateFormat): Formatter {
  return createFormatter({ ...defaultFormatSettings, language, timeZone: "UTC", dateFormat });
}

export function dateFormatLabel(_t: TFunction, value: string, language: string): string {
  return `${value} (${formatterFor(language, value as DateFormat).date(SAMPLE)})`;
}

export function timeFormatLabel(t: TFunction, value: string): string {
  return value === "24h" ? t("preferences.time24") : t("preferences.time12");
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
