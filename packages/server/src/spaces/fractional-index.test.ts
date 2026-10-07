import { describe, expect, it } from "vitest";
import { isValidPosition, PositionError, positionBetween } from "./fractional-index.js";

function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

describe("positionBetween", () => {
  it("starts a list in the middle of the range", () => {
    expect(positionBetween(null, null)).toBe("a0");
  });

  it("appends and prepends with short positions", () => {
    let last = positionBetween(null, null);
    for (let index = 0; index < 10_000; index++) {
      const next = positionBetween(last, null);
      expect(next > last).toBe(true);
      last = next;
    }
    expect(last.length).toBeLessThanOrEqual(4);
    let first = positionBetween(null, null);
    for (let index = 0; index < 10_000; index++) {
      const next = positionBetween(null, first);
      expect(next < first).toBe(true);
      first = next;
    }
    expect(first.length).toBeLessThanOrEqual(4);
  });

  it("keeps order and uniqueness for random inserts", () => {
    const next = random(42);
    const positions: string[] = [positionBetween(null, null)];
    for (let index = 0; index < 3000; index++) {
      const at = Math.floor(next() * (positions.length + 1));
      const lower = at === 0 ? null : (positions[at - 1] as string);
      const upper = at === positions.length ? null : (positions[at] as string);
      const position = positionBetween(lower, upper);
      expect(isValidPosition(position)).toBe(true);
      if (lower !== null) expect(position > lower).toBe(true);
      if (upper !== null) expect(position < upper).toBe(true);
      positions.splice(at, 0, position);
    }
    expect(new Set(positions).size).toBe(positions.length);
    expect([...positions].sort()).toEqual(positions);
  });

  it("stays short when items are inserted repeatedly at the same place", () => {
    let lower = positionBetween(null, null);
    const upper = positionBetween(lower, null);
    for (let index = 0; index < 500; index++) lower = positionBetween(lower, upper);
    expect(lower.length).toBeLessThan(120);
  });

  it("rejects bounds in the wrong order and invalid positions", () => {
    expect(() => positionBetween("a1", "a0")).toThrow(PositionError);
    expect(() => positionBetween("a0", "a0")).toThrow(PositionError);
    expect(() => positionBetween("a00", null)).toThrow(PositionError);
    expect(() => positionBetween("!", null)).toThrow(PositionError);
    expect(isValidPosition("")).toBe(false);
    expect(isValidPosition("a")).toBe(false);
    expect(isValidPosition("a0")).toBe(true);
    expect(isValidPosition("a0V")).toBe(true);
  });
});
