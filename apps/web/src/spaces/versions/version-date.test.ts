import { afterEach, describe, expect, it, vi } from "vitest";
import { createFormatter, defaultFormatSettings } from "../../format/format.js";
import { versionDate } from "./versions-screen.js";

describe("dates in the version list", () => {
  afterEach(() => vi.useRealTimers());

  it("say today with the time, and only the date for older versions", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T15:00:00Z"));
    const format = createFormatter({
      ...defaultFormatSettings,
      language: "de",
      timeZone: "UTC",
      timeFormat: "24h",
    });
    expect(versionDate(format, "2026-10-23T14:02:00Z")).toBe("heute, 14:02");
    expect(versionDate(format, "2026-10-20T09:00:00Z")).toBe("20. Okt.");
    expect(versionDate(format, "2025-10-20T09:00:00Z")).toBe("20. Okt. 2025");
  });
});
