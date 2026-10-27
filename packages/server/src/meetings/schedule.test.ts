import { describe, expect, it } from "vitest";
import {
  nextOccurrence,
  occurrences,
  type Rhythm,
  recurrenceOf,
  rhythmOf,
  rhythmSchema,
  type Schedule,
  ScheduleError,
  validateSchedule,
} from "./schedule.js";

function schedule(recurrence: string | null, startsOn: string, startTime = "09:30"): Schedule {
  return { recurrence, startsOn, startTime, timeZone: "Europe/Vienna" };
}

function iso(dates: { startsAt: Date }[]): string[] {
  return dates.map((date) => date.startsAt.toISOString());
}

describe("rhythms", () => {
  const cases: [string, Rhythm, string | null][] = [
    ["no fixed rhythm", { frequency: "none", interval: 1 }, null],
    ["daily", { frequency: "daily", interval: 1 }, "FREQ=DAILY"],
    ["weekly", { frequency: "weekly", interval: 1, weekdays: ["MO"] }, "FREQ=WEEKLY;BYDAY=MO"],
    [
      "every two weeks",
      { frequency: "weekly", interval: 2, weekdays: ["TH"] },
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=TH",
    ],
    [
      "chosen weekdays",
      { frequency: "weekly", interval: 1, weekdays: ["MO", "WE", "FR"] },
      "FREQ=WEEKLY;BYDAY=MO,WE,FR",
    ],
    ["monthly by date", { frequency: "monthly", interval: 1, monthDay: 12 }, "FREQ=MONTHLY;BYMONTHDAY=12"],
    [
      "monthly on the first Tuesday",
      { frequency: "monthly", interval: 1, weekOfMonth: 1, weekday: "TU" },
      "FREQ=MONTHLY;BYDAY=1TU",
    ],
    [
      "quarterly on the last Friday",
      { frequency: "monthly", interval: 3, weekOfMonth: -1, weekday: "FR" },
      "FREQ=MONTHLY;INTERVAL=3;BYDAY=-1FR",
    ],
    ["yearly", { frequency: "yearly", interval: 1 }, "FREQ=YEARLY"],
  ];

  for (const [name, rhythm, rule] of cases) {
    it(`turn ${name} into a recurrence rule and back`, () => {
      expect(recurrenceOf(rhythm)).toBe(rule);
      expect(rhythmOf(rule)).toEqual(rhythm);
    });
  }

  it("orders weekdays and refuses a weekly rhythm without one", () => {
    expect(recurrenceOf({ frequency: "weekly", interval: 1, weekdays: ["FR", "MO"] })).toBe(
      "FREQ=WEEKLY;BYDAY=MO,FR",
    );
    expect(() => recurrenceOf({ frequency: "weekly", interval: 1, weekdays: [] })).toThrow(ScheduleError);
    expect(() => recurrenceOf({ frequency: "monthly", interval: 1 })).toThrow(ScheduleError);
  });

  it("report rules from elsewhere that the interface cannot show as unknown", () => {
    expect(rhythmOf("FREQ=WEEKLY;BYDAY=MO;COUNT=10")).toBeNull();
    expect(rhythmOf("FREQ=MONTHLY;BYDAY=2TU,4TU")).toBeNull();
  });
});

describe("occurrences", () => {
  it("of a weekly series follow the rule", () => {
    expect(iso(occurrences(schedule("FREQ=WEEKLY;BYDAY=MO", "2026-10-12"), [], { limit: 3 }))).toEqual([
      "2026-10-12T07:30:00.000Z",
      "2026-10-19T07:30:00.000Z",
      "2026-10-26T08:30:00.000Z",
    ]);
  });

  it("keep the local time across the change from summer to winter time", () => {
    const [before, after] = occurrences(schedule("FREQ=WEEKLY;BYDAY=FR", "2026-10-23"), [], { limit: 2 });
    expect(before?.startsAt.toISOString()).toBe("2026-10-23T07:30:00.000Z");
    expect(after?.startsAt.toISOString()).toBe("2026-10-30T08:30:00.000Z");
  });

  it("keep the local time across the change from winter to summer time", () => {
    const list = occurrences(schedule("FREQ=WEEKLY;INTERVAL=2;BYDAY=TH", "2027-03-18", "14:00"), [], {
      limit: 2,
    });
    expect(iso(list)).toEqual(["2027-03-18T13:00:00.000Z", "2027-04-01T12:00:00.000Z"]);
  });

  it("of every two weeks skip the weeks between", () => {
    expect(
      iso(occurrences(schedule("FREQ=WEEKLY;INTERVAL=2;BYDAY=TH", "2026-10-15", "14:00"), [], { limit: 3 })),
    ).toEqual(["2026-10-15T12:00:00.000Z", "2026-10-29T13:00:00.000Z", "2026-11-12T13:00:00.000Z"]);
  });

  it("of a monthly series by weekday fall on the first Tuesday", () => {
    expect(iso(occurrences(schedule("FREQ=MONTHLY;BYDAY=1TU", "2026-10-06"), [], { limit: 3 }))).toEqual([
      "2026-10-06T07:30:00.000Z",
      "2026-11-03T08:30:00.000Z",
      "2026-12-01T08:30:00.000Z",
    ]);
  });

  it("of a quarterly series come every three months", () => {
    expect(
      iso(occurrences(schedule("FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=6", "2026-10-06"), [], { limit: 3 })),
    ).toEqual(["2026-10-06T07:30:00.000Z", "2027-01-06T08:30:00.000Z", "2027-04-06T07:30:00.000Z"]);
  });

  it("leave out exception dates and use moved times", () => {
    const list = occurrences(
      schedule("FREQ=WEEKLY;BYDAY=MO", "2026-10-12"),
      [
        { recurrenceId: new Date("2026-10-19T07:30:00.000Z"), startsAt: null },
        {
          recurrenceId: new Date("2026-10-26T08:30:00.000Z"),
          startsAt: new Date("2026-10-27T13:00:00.000Z"),
        },
      ],
      { limit: 3 },
    );
    expect(list.map((entry) => [entry.recurrenceId.toISOString(), entry.startsAt.toISOString()])).toEqual([
      ["2026-10-12T07:30:00.000Z", "2026-10-12T07:30:00.000Z"],
      ["2026-10-26T08:30:00.000Z", "2026-10-27T13:00:00.000Z"],
      ["2026-11-02T08:30:00.000Z", "2026-11-02T08:30:00.000Z"],
    ]);
  });

  it("do not exist without a fixed rhythm", () => {
    expect(occurrences(schedule(null, "2026-10-12"), [], { limit: 3 })).toEqual([]);
    expect(
      nextOccurrence(schedule(null, "2026-10-12"), [], {
        after: null,
        notBefore: new Date("2026-10-01T00:00:00Z"),
      }),
    ).toBeNull();
  });
});

describe("the next occurrence", () => {
  const weekly = schedule("FREQ=WEEKLY;BYDAY=MO", "2026-10-12");

  it("follows the closed one", () => {
    const next = nextOccurrence(weekly, [], {
      after: new Date("2026-10-12T07:30:00.000Z"),
      notBefore: new Date("2026-10-12T09:00:00.000Z"),
    });
    expect(next?.startsAt.toISOString()).toBe("2026-10-19T07:30:00.000Z");
  });

  it("starts after the moment of closing when the meeting is closed late", () => {
    const next = nextOccurrence(weekly, [], {
      after: new Date("2026-10-12T07:30:00.000Z"),
      notBefore: new Date("2026-11-04T12:00:00.000Z"),
    });
    expect(next?.recurrenceId.toISOString()).toBe("2026-11-09T08:30:00.000Z");
  });

  it("skips a cancelled occurrence", () => {
    const next = nextOccurrence(
      weekly,
      [{ recurrenceId: new Date("2026-10-19T07:30:00.000Z"), startsAt: null }],
      {
        after: new Date("2026-10-12T07:30:00.000Z"),
        notBefore: new Date("2026-10-12T09:00:00.000Z"),
      },
    );
    expect(next?.startsAt.toISOString()).toBe("2026-10-26T08:30:00.000Z");
  });
});

describe("validation", () => {
  it("refuses unknown time zones, impossible dates and unreadable rules", () => {
    expect(() => validateSchedule({ ...schedule(null, "2026-10-12"), timeZone: "Mars/Olympus" })).toThrow(
      ScheduleError,
    );
    expect(() => validateSchedule(schedule(null, "2026-02-30"))).toThrow(ScheduleError);
    expect(() => validateSchedule(schedule(null, "2026-10-12", "25:00"))).toThrow(ScheduleError);
    expect(() => validateSchedule(schedule("FREQ=SOMETIMES", "2026-10-12"))).toThrow(ScheduleError);
    expect(() => validateSchedule(schedule("FREQ=WEEKLY;BYDAY=MO", "2026-10-12"))).not.toThrow();
  });
});

describe("the week of the month", () => {
  const monthly = { frequency: "monthly", weekday: "TU" } as const;

  it.each([-1, 1, 2, 3, 4])("accepts %i", (weekOfMonth) => {
    expect(rhythmSchema.safeParse({ ...monthly, weekOfMonth }).success).toBe(true);
  });

  it.each([0, 5, -2, 53, 1.5])("refuses %s", (weekOfMonth) => {
    expect(rhythmSchema.safeParse({ ...monthly, weekOfMonth }).success).toBe(false);
  });
});
