import { Temporal } from "temporal-polyfill";
import type { BackupClass } from "./naming.js";

export interface BackupSchedule {
  dailyTime: string;
  weeklyDay: number | null;
  monthlyDay: number | null;
  timeZone: string;
}

export const DAILY_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function zoned(at: Date, timeZone: string): Temporal.ZonedDateTime {
  return Temporal.Instant.fromEpochMilliseconds(at.getTime()).toZonedDateTimeISO(timeZone);
}

function slotOn(date: Temporal.PlainDate, schedule: BackupSchedule): Date {
  const [hour = 0, minute = 0] = schedule.dailyTime.split(":").map(Number);
  return new Date(
    date.toZonedDateTime({ timeZone: schedule.timeZone, plainTime: new Temporal.PlainTime(hour, minute) })
      .epochMilliseconds,
  );
}

export function latestSlot(now: Date, schedule: BackupSchedule): Date {
  const today = zoned(now, schedule.timeZone).toPlainDate();
  const slot = slotOn(today, schedule);
  return slot.getTime() <= now.getTime() ? slot : slotOn(today.subtract({ days: 1 }), schedule);
}

export function nextSlot(now: Date, schedule: BackupSchedule): Date {
  const today = zoned(now, schedule.timeZone).toPlainDate();
  const slot = slotOn(today, schedule);
  return slot.getTime() > now.getTime() ? slot : slotOn(today.add({ days: 1 }), schedule);
}

export function classOfSlot(slot: Date, schedule: BackupSchedule): BackupClass {
  const date = zoned(slot, schedule.timeZone);
  if (schedule.monthlyDay !== null && date.day === Math.min(schedule.monthlyDay, date.daysInMonth)) {
    return "monthly";
  }
  if (schedule.weeklyDay !== null && date.dayOfWeek === schedule.weeklyDay) return "weekly";
  return "daily";
}
