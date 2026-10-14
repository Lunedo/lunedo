import type { TFunction } from "i18next";
import { weekdayLabel } from "../format/zoned.js";
import { translateKey } from "../i18n/translate.js";

export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type WeekdayCode = (typeof WEEKDAYS)[number];

export const RHYTHM_PRESETS = [
  "weekly",
  "everyNWeeks",
  "weekdays",
  "daily",
  "monthlyByDate",
  "monthlyByWeekday",
  "quarterly",
  "yearly",
  "none",
] as const;
export type RhythmPreset = (typeof RHYTHM_PRESETS)[number];

export interface Rhythm {
  frequency: "none" | "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  weekdays?: WeekdayCode[];
  monthDay?: number;
  weekOfMonth?: number;
  weekday?: WeekdayCode;
}

export interface RhythmChoice {
  preset: RhythmPreset;
  interval: number;
  weekdays: WeekdayCode[];
}

function parts(date: string): { weekday: WeekdayCode; day: number; weekOfMonth: number } {
  const value = new Date(`${date}T12:00:00Z`);
  const weekday = WEEKDAYS[(value.getUTCDay() + 6) % 7] ?? "MO";
  const day = value.getUTCDate();
  const nth = Math.ceil(day / 7);
  return { weekday, day, weekOfMonth: nth > 4 ? -1 : nth };
}

export function rhythmFor(choice: RhythmChoice, startsOn: string): Rhythm {
  const { weekday, day, weekOfMonth } = parts(startsOn);
  switch (choice.preset) {
    case "none":
      return { frequency: "none", interval: 1 };
    case "daily":
      return { frequency: "daily", interval: 1 };
    case "weekly":
      return { frequency: "weekly", interval: 1, weekdays: [weekday] };
    case "everyNWeeks":
      return { frequency: "weekly", interval: Math.max(2, choice.interval), weekdays: [weekday] };
    case "weekdays":
      return {
        frequency: "weekly",
        interval: 1,
        weekdays: choice.weekdays.length > 0 ? choice.weekdays : [weekday],
      };
    case "monthlyByDate":
      return { frequency: "monthly", interval: 1, monthDay: day };
    case "monthlyByWeekday":
      return { frequency: "monthly", interval: 1, weekOfMonth, weekday };
    case "quarterly":
      return { frequency: "monthly", interval: 3, monthDay: day };
    case "yearly":
      return { frequency: "yearly", interval: 1 };
  }
}

export function choiceOf(rhythm: Rhythm | null): RhythmChoice {
  const base = { interval: 2, weekdays: [] as WeekdayCode[] };
  if (!rhythm || rhythm.frequency === "none") return { ...base, preset: "none" };
  if (rhythm.frequency === "daily") return { ...base, preset: "daily" };
  if (rhythm.frequency === "yearly") return { ...base, preset: "yearly" };
  if (rhythm.frequency === "weekly") {
    const days = rhythm.weekdays ?? [];
    if (rhythm.interval > 1) return { preset: "everyNWeeks", interval: rhythm.interval, weekdays: days };
    return days.length > 1
      ? { preset: "weekdays", interval: 2, weekdays: days }
      : { ...base, preset: "weekly" };
  }
  if (rhythm.interval === 3 && rhythm.monthDay !== undefined) return { ...base, preset: "quarterly" };
  return { ...base, preset: rhythm.weekday ? "monthlyByWeekday" : "monthlyByDate" };
}

export function weekdayName(code: WeekdayCode, language: string, width: "long" | "short" = "long"): string {
  return weekdayLabel(WEEKDAYS.indexOf(code), language, width);
}

export function describeRhythm(t: TFunction, rhythm: Rhythm | null, language: string): string {
  if (!rhythm) return t("meetings.rhythm.custom");
  const days = (rhythm.weekdays ?? []).map((day) => weekdayName(day, language));
  const list = new Intl.ListFormat(language, { type: "conjunction" }).format(days);
  switch (rhythm.frequency) {
    case "none":
      return t("meetings.rhythm.describe.none");
    case "daily":
      return t("meetings.rhythm.describe.daily", { count: rhythm.interval });
    case "weekly":
      return t("meetings.rhythm.describe.weekly", { count: rhythm.interval, days: list });
    case "monthly":
      if (rhythm.weekday && rhythm.weekOfMonth !== undefined) {
        return t("meetings.rhythm.describe.monthlyByWeekday", {
          count: rhythm.interval,
          position: translateKey(
            t,
            `meetings.rhythm.position.${rhythm.weekOfMonth === -1 ? "last" : String(rhythm.weekOfMonth)}`,
          ),
          day: weekdayName(rhythm.weekday, language),
        });
      }
      return t("meetings.rhythm.describe.monthlyByDate", {
        count: rhythm.interval,
        day: rhythm.monthDay ?? 1,
      });
    case "yearly":
      return t("meetings.rhythm.describe.yearly", { count: rhythm.interval });
  }
}
