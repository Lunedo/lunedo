import { describe, expect, it } from "vitest";
import { isUuid, uuidv7, uuidv7Timestamp } from "./uuid.js";

describe("uuidv7", () => {
  it("produces valid version 7 UUIDs with the RFC variant", () => {
    const id = uuidv7();
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe("7");
    expect(["8", "9", "a", "b"]).toContain(id[19]);
  });

  it("encodes the timestamp in the first 48 bits", () => {
    const now = Date.now();
    expect(uuidv7Timestamp(uuidv7(now + 60_000))).toBe(now + 60_000);
  });

  it("is monotonic within the same millisecond and across calls", () => {
    const now = Date.now() + 120_000;
    const ids = Array.from({ length: 2000 }, () => uuidv7(now));
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never goes backwards when the clock does", () => {
    const later = uuidv7(Date.now() + 240_000);
    const earlierClock = uuidv7(Date.now());
    expect(earlierClock > later).toBe(true);
  });
});
