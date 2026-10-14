import { describe, expect, it } from "vitest";
import { initI18n } from "../i18n/index.js";
import { choiceOf, describeRhythm, rhythmFor } from "./rhythm.js";

describe("rhythm presets", () => {
  it("take the weekday and day of the month from the first date", () => {
    const choice = { interval: 2, weekdays: [] };
    expect(rhythmFor({ ...choice, preset: "weekly" }, "2026-10-12")).toEqual({
      frequency: "weekly",
      interval: 1,
      weekdays: ["MO"],
    });
    expect(rhythmFor({ ...choice, preset: "everyNWeeks", interval: 3 }, "2026-10-15")).toEqual({
      frequency: "weekly",
      interval: 3,
      weekdays: ["TH"],
    });
    expect(rhythmFor({ ...choice, preset: "monthlyByWeekday" }, "2026-10-06")).toEqual({
      frequency: "monthly",
      interval: 1,
      weekOfMonth: 1,
      weekday: "TU",
    });
    expect(rhythmFor({ ...choice, preset: "monthlyByWeekday" }, "2026-10-30")).toMatchObject({
      weekOfMonth: -1,
    });
    expect(rhythmFor({ ...choice, preset: "quarterly" }, "2026-10-06")).toEqual({
      frequency: "monthly",
      interval: 3,
      monthDay: 6,
    });
    expect(rhythmFor({ ...choice, preset: "weekdays", weekdays: ["MO", "FR"] }, "2026-10-06")).toEqual({
      frequency: "weekly",
      interval: 1,
      weekdays: ["MO", "FR"],
    });
    expect(rhythmFor({ ...choice, preset: "none" }, "2026-10-06")).toEqual({
      frequency: "none",
      interval: 1,
    });
  });

  it("come back from a stored rhythm", () => {
    expect(choiceOf({ frequency: "monthly", interval: 3, monthDay: 6 }).preset).toBe("quarterly");
    expect(choiceOf({ frequency: "weekly", interval: 2, weekdays: ["TH"] })).toMatchObject({
      preset: "everyNWeeks",
      interval: 2,
    });
    expect(choiceOf({ frequency: "weekly", interval: 1, weekdays: ["MO", "WE"] }).preset).toBe("weekdays");
    expect(choiceOf(null).preset).toBe("none");
  });

  it("are described in words in both languages", async () => {
    const english = await initI18n(["en"]);
    const german = await initI18n(["de"]);
    const rhythm = { frequency: "monthly" as const, interval: 1, weekOfMonth: 1, weekday: "TU" as const };
    expect(describeRhythm(english.t, rhythm, "en")).toBe("Monthly on the first Tuesday");
    expect(describeRhythm(german.t, rhythm, "de")).toBe("Monatlich am ersten Dienstag");
    expect(describeRhythm(english.t, { frequency: "weekly", interval: 2, weekdays: ["TH"] }, "en")).toBe(
      "Every 2 weeks on Thursday",
    );
  });
});
