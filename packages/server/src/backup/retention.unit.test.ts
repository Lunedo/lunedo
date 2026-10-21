import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { type BackupName, backupName, parseBackupName } from "./naming.js";
import { expiredBackups, type RetentionPolicy } from "./retention.js";
import { type BackupSchedule, classOfSlot, latestSlot, nextSlot } from "./schedule.js";

const policy: RetentionPolicy = { daily: 7, weekly: 4, monthly: 6, beforeUpdate: 3 };

const vienna: BackupSchedule = { dailyTime: "02:30", weeklyDay: 7, monthlyDay: 1, timeZone: "Europe/Vienna" };

function simulateYear(schedule: BackupSchedule, start: Date, days: number) {
  let kept: BackupName[] = [];
  const deleted: BackupName[] = [];
  let cursor = start;
  for (let day = 0; day < days; day += 1) {
    const slot = nextSlot(cursor, schedule);
    const created = parseBackupName(backupName(classOfSlot(slot, schedule), slot));
    if (!created) throw new Error("unparsable name");
    kept.push(created);
    const expired = expiredBackups(kept, policy);
    deleted.push(...expired);
    kept = kept.filter((backup) => !expired.includes(backup));
    cursor = new Date(slot.getTime() + 60_000);
  }
  return { kept, deleted };
}

function localDate(date: Date, timeZone: string) {
  return Temporal.Instant.fromEpochMilliseconds(date.getTime()).toZonedDateTimeISO(timeZone);
}

describe("backup names", () => {
  it("round-trips the class and the creation time", () => {
    const created = new Date("2026-10-21T02:00:07.123Z");
    for (const backupClass of ["daily", "weekly", "monthly", "manual", "beforeUpdate"] as const) {
      const parsed = parseBackupName(backupName(backupClass, created, "0a1b2c3d"));
      expect(parsed).toEqual({
        name: expect.stringMatching(/^pagehall-backup-20261021T020007Z-/),
        backupClass,
        createdAt: new Date("2026-10-21T02:00:07.000Z"),
      });
    }
    expect(backupName("beforeUpdate", created, "0a1b2c3d")).toBe(
      "pagehall-backup-20261021T020007Z-before-update-0a1b2c3d.phbak",
    );
  });

  it.each([
    "backup.phbak",
    "pagehall-backup-20261021T020007Z-daily-0a1b2c3d.phbak.partial",
    "pagehall-backup-20261021T020007Z-hourly-0a1b2c3d.phbak",
    "pagehall-backup-20261021T020007Z-daily-0A1B2C3D.phbak",
    "../pagehall-backup-20261021T020007Z-daily-0a1b2c3d.phbak",
    "pagehall-backup-20261341T020007Z-daily-0a1b2c3d.phbak",
    "notes/pagehall-backup-20261021T020007Z-daily-0a1b2c3d.phbak",
  ])("does not recognize %s", (name) => {
    expect(parseBackupName(name)).toBeNull();
  });
});

describe("backup schedule", () => {
  it("runs at the daily time of the instance time zone, also across daylight saving changes", () => {
    const schedule = { ...vienna, weeklyDay: null, monthlyDay: null };
    expect(nextSlot(new Date("2026-10-24T12:00:00Z"), schedule)).toEqual(new Date("2026-10-25T00:30:00Z"));
    expect(nextSlot(new Date("2026-10-25T12:00:00Z"), schedule)).toEqual(new Date("2026-10-26T01:30:00Z"));
    expect(nextSlot(new Date("2026-03-28T12:00:00Z"), schedule)).toEqual(new Date("2026-03-29T01:30:00Z"));
    expect(latestSlot(new Date("2026-10-26T01:29:59Z"), schedule)).toEqual(new Date("2026-10-25T00:30:00Z"));
    expect(latestSlot(new Date("2026-10-26T01:30:00Z"), schedule)).toEqual(new Date("2026-10-26T01:30:00Z"));
  });

  it("classes a run by its local date: monthly before weekly before daily", () => {
    expect(classOfSlot(new Date("2026-11-01T01:30:00Z"), vienna)).toBe("monthly");
    expect(classOfSlot(new Date("2026-11-08T01:30:00Z"), vienna)).toBe("weekly");
    expect(classOfSlot(new Date("2026-11-09T01:30:00Z"), vienna)).toBe("daily");
    expect(classOfSlot(new Date("2026-11-08T01:30:00Z"), { ...vienna, weeklyDay: null })).toBe("daily");
  });

  it("uses the local date, not the UTC date", () => {
    const tokyo: BackupSchedule = {
      dailyTime: "01:00",
      weeklyDay: null,
      monthlyDay: 1,
      timeZone: "Asia/Tokyo",
    };
    expect(classOfSlot(new Date("2026-10-31T16:00:00Z"), tokyo)).toBe("monthly");
  });

  it("runs the monthly backup on the last day of shorter months", () => {
    const end = { ...vienna, weeklyDay: null, monthlyDay: 31 };
    expect(classOfSlot(new Date("2027-02-28T01:30:00Z"), end)).toBe("monthly");
    expect(classOfSlot(new Date("2026-11-30T01:30:00Z"), end)).toBe("monthly");
    expect(classOfSlot(new Date("2026-11-29T01:30:00Z"), end)).toBe("daily");
  });
});

describe("grandfather-father-son retention", () => {
  it("keeps 7 daily, 4 weekly and 6 monthly backups over a simulated year", () => {
    const { kept, deleted } = simulateYear(vienna, new Date("2026-01-01T00:00:00Z"), 365);
    const byClass = (backupClass: string) => kept.filter((backup) => backup.backupClass === backupClass);
    expect(byClass("daily")).toHaveLength(7);
    expect(byClass("weekly")).toHaveLength(4);
    expect(byClass("monthly")).toHaveLength(6);
    expect(kept).toHaveLength(17);
    expect(deleted).toHaveLength(365 - 17);
    expect(
      byClass("monthly").map((backup) =>
        localDate(backup.createdAt, vienna.timeZone).toPlainDate().toString(),
      ),
    ).toEqual(["2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01", "2026-12-01"]);
    for (const backup of byClass("weekly"))
      expect(localDate(backup.createdAt, vienna.timeZone).dayOfWeek).toBe(7);
    const newest = kept.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
    expect(localDate(newest.createdAt, vienna.timeZone).toPlainDate().toString()).toBe("2026-12-31");
  });

  it("does not delete a monthly backup because of the daily count", () => {
    const { kept } = simulateYear(vienna, new Date("2026-05-31T12:00:00Z"), 10);
    const monthly = kept.find((backup) => backup.backupClass === "monthly");
    expect(monthly && localDate(monthly.createdAt, vienna.timeZone).toPlainDate().toString()).toBe(
      "2026-06-01",
    );
    expect(kept.filter((backup) => backup.backupClass === "daily")).toHaveLength(7);
  });

  it("keeps manual backups until they are deleted and the last three before updates", () => {
    const at = (day: number) => new Date(Date.UTC(2026, 0, day, 3));
    const backups = [
      ...Array.from({ length: 5 }, (_, index) => parseBackupName(backupName("manual", at(index + 1)))),
      ...Array.from({ length: 5 }, (_, index) => parseBackupName(backupName("beforeUpdate", at(index + 1)))),
    ].filter((backup): backup is BackupName => backup !== null);
    const expired = expiredBackups(backups, policy);
    expect(expired.map((backup) => backup.backupClass)).toEqual(["beforeUpdate", "beforeUpdate"]);
    expect(expired.map((backup) => backup.createdAt)).toEqual([at(2), at(1)]);
  });

  it("deletes nothing when every class is within its count", () => {
    const backups = ["daily", "weekly", "monthly", "beforeUpdate"].map((backupClass, index) =>
      parseBackupName(
        backupName(backupClass as BackupName["backupClass"], new Date(Date.UTC(2026, 0, index + 1))),
      ),
    ) as BackupName[];
    expect(expiredBackups(backups, { daily: 1, weekly: 1, monthly: 1, beforeUpdate: 1 })).toEqual([]);
  });
});
