import { describe, expect, it } from "vitest";
import { createVitestConfig, parallelismLimit } from "../vitest.ts";

describe("parallelismLimit", () => {
  it("returns a positive whole number", () => {
    expect(parallelismLimit("3")).toBe(3);
  });

  it.each([undefined, "", "0", "-2", "1.5", "many"])("ignores %j so the defaults apply", (value) => {
    expect(parallelismLimit(value)).toBeUndefined();
  });

  it("limits the Vitest workers when CI_PARALLELISM is set", () => {
    process.env.CI_PARALLELISM = "2";
    try {
      expect(createVitestConfig().test?.maxWorkers).toBe(2);
    } finally {
      delete process.env.CI_PARALLELISM;
    }
    expect(createVitestConfig().test?.maxWorkers).toBeUndefined();
  });
});
