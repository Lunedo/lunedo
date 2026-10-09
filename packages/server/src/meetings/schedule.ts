import { RRuleTemporal } from "rrule-temporal";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";

export const weekdays = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Weekday = (typeof weekdays)[number];

export const rhythmFrequencies = ["none", "daily", "weekly", "monthly", "yearly"] as const;
export type RhythmFrequency = (typeof rhythmFrequencies)[number];

export const MAX_INTERVAL = 52;

export const rhythmSchema = z
  .object({
    frequency: z.enum(rhythmFrequencies),
    interval: z.number().int().min(1).max(MAX_INTERVAL).default(1),
    weekdays: z.array(z.enum(weekdays)).max(7).optional(),
    monthDay: z.number().int().min(1).max(31).optional(),
    weekOfMonth: z
      .number()
      .int()
      .refine((value) => value === -1 || (value >= 1 && value <= 4), "Use 1 to 4, or -1 for the last")
      .optional(),
    weekday: z.enum(weekdays).optional(),
  })
  .strict();
export type Rhythm = z.output<typeof rhythmSchema>;

export class ScheduleError extends Error {
  override name = "ScheduleError";

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface Schedule {
  recurrence: string | null;
  startsOn: string;
  startTime: string;
  timeZone: string;
}

export interface Override {
  recurrenceId: Date;
  startsAt: Date | null;
}

export interface Occurrence {
  recurrenceId: Date;
  startsAt: Date;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const SEARCH_LIMIT = 1000;

export function isTimeZone(value: string): boolean {
  try {
    Temporal.Now.zonedDateTimeISO(value);
    return value.length <= 64;
  } catch {
    return false;
  }
}

function sortedDays(days: readonly Weekday[]): Weekday[] {
  return weekdays.filter((day) => days.includes(day));
}

export function recurrenceOf(rhythm: Rhythm): string | null {
  const interval = rhythm.interval > 1 ? `;INTERVAL=${rhythm.interval}` : "";
  switch (rhythm.frequency) {
    case "none":
      return null;
    case "daily":
      return `FREQ=DAILY${interval}`;
    case "weekly": {
      const days = sortedDays(rhythm.weekdays ?? []);
      if (days.length === 0) throw new ScheduleError("invalidRhythm", "Choose at least one weekday");
      return `FREQ=WEEKLY${interval};BYDAY=${days.join(",")}`;
    }
    case "monthly": {
      if (rhythm.monthDay !== undefined) return `FREQ=MONTHLY${interval};BYMONTHDAY=${rhythm.monthDay}`;
      if (rhythm.weekOfMonth !== undefined && rhythm.weekday) {
        return `FREQ=MONTHLY${interval};BYDAY=${rhythm.weekOfMonth}${rhythm.weekday}`;
      }
      throw new ScheduleError("invalidRhythm", "Choose a day of the month or a weekday of the month");
    }
    case "yearly":
      return `FREQ=YEARLY${interval}`;
  }
}

export function rhythmOf(recurrence: string | null): Rhythm | null {
  if (recurrence === null) return { frequency: "none", interval: 1 };
  const parts = new Map(
    recurrence.split(";").map((part) => {
      const [name = "", value = ""] = part.split("=");
      return [name.toUpperCase(), value.toUpperCase()] as const;
    }),
  );
  const known = new Set(["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY"]);
  if ([...parts.keys()].some((name) => !known.has(name))) return null;
  const interval = Number(parts.get("INTERVAL") ?? "1");
  if (!Number.isInteger(interval) || interval < 1 || interval > MAX_INTERVAL) return null;
  const byDay = parts.get("BYDAY");
  const byMonthDay = parts.get("BYMONTHDAY");
  switch (parts.get("FREQ")) {
    case "DAILY":
      return byDay || byMonthDay ? null : { frequency: "daily", interval };
    case "YEARLY":
      return byDay || byMonthDay ? null : { frequency: "yearly", interval };
    case "WEEKLY": {
      const days = (byDay ?? "").split(",");
      if (byMonthDay || !days.every((day): day is Weekday => (weekdays as readonly string[]).includes(day))) {
        return null;
      }
      return { frequency: "weekly", interval, weekdays: sortedDays(days) };
    }
    case "MONTHLY": {
      if (byMonthDay && !byDay) {
        const monthDay = Number(byMonthDay);
        return Number.isInteger(monthDay) && monthDay >= 1 && monthDay <= 31
          ? { frequency: "monthly", interval, monthDay }
          : null;
      }
      const match = byDay && !byMonthDay ? /^(-1|[1-4])(MO|TU|WE|TH|FR|SA|SU)$/.exec(byDay) : null;
      if (!match) return null;
      return {
        frequency: "monthly",
        interval,
        weekOfMonth: Number(match[1]),
        weekday: match[2] as Weekday,
      };
    }
    default:
      return null;
  }
}

export function validateSchedule(schedule: Schedule): void {
  if (!DATE.test(schedule.startsOn)) throw new ScheduleError("invalidSchedule", "Enter the first date");
  if (!TIME.test(schedule.startTime))
    throw new ScheduleError("invalidSchedule", "Enter a time such as 09:30");
  if (!isTimeZone(schedule.timeZone)) throw new ScheduleError("invalidTimeZone", "Choose a known time zone");
  try {
    Temporal.PlainDate.from(schedule.startsOn, { overflow: "reject" });
  } catch {
    throw new ScheduleError("invalidSchedule", "Enter the first date");
  }
  if (schedule.recurrence !== null) {
    try {
      new RRuleTemporal({ rruleString: schedule.recurrence, dtstart: start(schedule), temporal: Temporal });
    } catch {
      throw new ScheduleError("invalidRhythm", "The rhythm cannot be read");
    }
  }
}

function start(schedule: Schedule): Temporal.ZonedDateTime {
  return Temporal.PlainDateTime.from(`${schedule.startsOn}T${schedule.startTime}`).toZonedDateTime(
    schedule.timeZone,
    { disambiguation: "later" },
  );
}

export function firstStart(schedule: Schedule): Date {
  return new Date(start(schedule).epochMilliseconds);
}

function ruleOf(schedule: Schedule): RRuleTemporal | null {
  if (schedule.recurrence === null) return null;
  return new RRuleTemporal({
    rruleString: schedule.recurrence,
    dtstart: start(schedule),
    tzid: schedule.timeZone,
    temporal: Temporal,
  });
}

function instantOf(value: Date): Temporal.ZonedDateTime {
  return Temporal.Instant.fromEpochMilliseconds(value.getTime()).toZonedDateTimeISO("UTC");
}

export function occurrences(
  schedule: Schedule,
  overrides: readonly Override[],
  options: { after?: Date | null; limit: number },
): Occurrence[] {
  const rule = ruleOf(schedule);
  if (!rule) return [];
  const byId = new Map(overrides.map((override) => [override.recurrenceId.getTime(), override]));
  const result: Occurrence[] = [];
  let cursor = options.after ? instantOf(options.after) : start(schedule).subtract({ seconds: 1 });
  for (let examined = 0; examined < SEARCH_LIMIT && result.length < options.limit; examined += 1) {
    const next = rule.next(cursor, false);
    if (!next) break;
    cursor = next;
    const recurrenceId = new Date(next.epochMilliseconds);
    const override = byId.get(recurrenceId.getTime());
    if (override && override.startsAt === null) continue;
    result.push({ recurrenceId, startsAt: override?.startsAt ?? recurrenceId });
  }
  return result;
}

export function nextOccurrence(
  schedule: Schedule,
  overrides: readonly Override[],
  options: { after: Date | null; notBefore: Date },
): Occurrence | null {
  let after = options.after;
  for (let round = 0; round < 20; round += 1) {
    const batch = occurrences(schedule, overrides, { after, limit: 50 });
    if (batch.length === 0) return null;
    const found = batch.find((occurrence) => occurrence.startsAt.getTime() > options.notBefore.getTime());
    if (found) return found;
    after = batch.at(-1)?.recurrenceId ?? null;
  }
  return null;
}
