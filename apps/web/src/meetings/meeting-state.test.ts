import { describe, expect, it } from "vitest";
import { isToday, meetingState } from "./queries.js";

const ZONE = "Europe/Vienna";
const NOW = new Date("2026-10-26T15:00:00.000Z");

describe("the state of a meeting", () => {
  it("is today on its date, before and after its time, until it is closed", () => {
    expect(
      meetingState({ state: "upcoming", next: true, startsAt: "2026-10-26T17:00:00.000Z" }, ZONE, NOW),
    ).toBe("today");
    expect(
      meetingState({ state: "upcoming", next: true, startsAt: "2026-10-26T07:00:00.000Z" }, ZONE, NOW),
    ).toBe("today");
    expect(
      meetingState({ state: "closed", next: false, startsAt: "2026-10-26T07:00:00.000Z" }, ZONE, NOW),
    ).toBe("closed");
  });

  it("is next only for a future date and open for a past date that was not closed", () => {
    expect(
      meetingState({ state: "upcoming", next: true, startsAt: "2026-11-02T09:00:00.000Z" }, ZONE, NOW),
    ).toBe("upcoming");
    expect(
      meetingState({ state: "upcoming", next: false, startsAt: "2026-11-09T09:00:00.000Z" }, ZONE, NOW),
    ).toBe("planned");
    expect(
      meetingState({ state: "upcoming", next: true, startsAt: "2026-10-19T09:00:00.000Z" }, ZONE, NOW),
    ).toBe("open");
  });

  it("uses the date in the time zone of the meeting", () => {
    expect(
      meetingState({ state: "upcoming", next: true, startsAt: "2026-10-26T23:30:00.000Z" }, ZONE, NOW),
    ).toBe("upcoming");
  });
});

describe("a meeting today", () => {
  it("is on the date of today in the time zone, whatever its time", () => {
    expect(isToday("2026-10-26T05:30:00.000Z", ZONE, NOW)).toBe(true);
    expect(isToday("2026-10-26T22:30:00.000Z", ZONE, NOW)).toBe(true);
    expect(isToday("2026-10-26T23:30:00.000Z", ZONE, NOW)).toBe(false);
    expect(isToday("2026-10-25T22:30:00.000Z", ZONE, NOW)).toBe(false);
  });
});
