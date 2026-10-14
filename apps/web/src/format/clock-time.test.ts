import { describe, expect, it } from "vitest";
import { clockTime } from "./clock-time.js";

describe("clockTime", () => {
  it("shows a stored time of day in the format of the language", () => {
    expect(clockTime("08:00", "de")).toBe("8:00");
    expect(clockTime("17:30", "en-US")).toMatch(/^5:30\sPM$/);
  });
});
