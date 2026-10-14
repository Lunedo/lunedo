import { describe, expect, it } from "vitest";
import { instantInZone, instantToZoned, zonedToInstant } from "./zoned.js";

describe("scheduling in the author's time zone", () => {
  it("turns a local date and time into the instant of that zone", () => {
    expect(zonedToInstant("2026-10-14", "07:00", "Europe/Vienna")?.toISOString()).toBe(
      "2026-10-14T05:00:00.000Z",
    );
    expect(zonedToInstant("2026-12-14", "07:00", "Europe/Vienna")?.toISOString()).toBe(
      "2026-12-14T06:00:00.000Z",
    );
    expect(zonedToInstant("2026-10-14", "07:00", "America/New_York")?.toISOString()).toBe(
      "2026-10-14T11:00:00.000Z",
    );
    expect(zonedToInstant("2026-10-14", "7 am", "UTC")).toBeNull();
  });

  it("shows a stored instant in the zone it was scheduled in", () => {
    expect(instantToZoned("2026-10-14T05:00:00.000Z", "Europe/Vienna")).toEqual({
      date: "2026-10-14",
      time: "07:00",
    });
  });
});

describe("local times", () => {
  it("turn a local date and time into the right instant on both sides of a daylight saving change", () => {
    expect(instantInZone("2026-10-23", "09:30", "Europe/Vienna").toISOString()).toBe(
      "2026-10-23T07:30:00.000Z",
    );
    expect(instantInZone("2026-10-30", "09:30", "Europe/Vienna").toISOString()).toBe(
      "2026-10-30T08:30:00.000Z",
    );
    expect(instantInZone("2026-10-30", "09:30", "America/New_York").toISOString()).toBe(
      "2026-10-30T13:30:00.000Z",
    );
  });
});
