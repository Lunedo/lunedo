import { describe, expect, it } from "vitest";
import { endToEndWorkers, localBudget, parallelismLimit, turboPlan, vitestWorkers } from "./parallelism.ts";

const linux = { cores: 16, platform: "linux" } as const;
const windows = { cores: 16, platform: "win32" } as const;

describe("localBudget", () => {
  it("uses every core on Linux and half of them on Windows", () => {
    expect(localBudget({}, linux)).toBe(16);
    expect(localBudget({}, windows)).toBe(8);
    expect(localBudget({}, { cores: 1, platform: "win32" })).toBe(1);
  });

  it("takes PAGEHALL_PARALLELISM over the default", () => {
    expect(localBudget({ PAGEHALL_PARALLELISM: "12" }, windows)).toBe(12);
  });

  it.each(["", "0", "-1", "2.5", "all"])("ignores the override %j", (value) => {
    expect(localBudget({ PAGEHALL_PARALLELISM: value }, windows)).toBe(8);
  });
});

describe("turboPlan", () => {
  it("keeps tasks times workers within the budget", () => {
    for (const cores of [1, 2, 4, 8, 12, 16, 32, 64]) {
      for (const platform of ["linux", "win32"] as const) {
        const plan = turboPlan({}, { cores, platform });
        const budget = localBudget({}, { cores, platform });
        expect(plan).toBeDefined();
        expect((plan?.concurrency ?? 0) * (plan?.workers ?? 0)).toBeLessThanOrEqual(budget);
        expect(plan?.concurrency).toBeGreaterThanOrEqual(1);
        expect(plan?.workers).toBeGreaterThanOrEqual(1);
      }
    }
    expect(turboPlan({}, windows)).toEqual({ concurrency: 2, workers: 4 });
    expect(turboPlan({}, linux)).toEqual({ concurrency: 4, workers: 4 });
    expect(turboPlan({}, { cores: 6, platform: "linux" })).toEqual({ concurrency: 1, workers: 6 });
  });

  it("plans nothing in CI", () => {
    expect(turboPlan({ CI: "true" }, windows)).toBeUndefined();
  });
});

describe("vitestWorkers", () => {
  it("follows CI_PARALLELISM wherever it is set", () => {
    expect(vitestWorkers({ CI: "true", CI_PARALLELISM: "3" }, windows)).toBe(3);
    expect(vitestWorkers({ CI_PARALLELISM: "3", PAGEHALL_TEST_WORKERS: "1" }, windows)).toBe(3);
  });

  it("leaves CI without CI_PARALLELISM to Vitest", () => {
    expect(vitestWorkers({ CI: "true" }, windows)).toBeUndefined();
  });

  it("uses the share that the Turbo plan gave each task, or the whole budget for a single package", () => {
    expect(vitestWorkers({ PAGEHALL_TEST_WORKERS: "2" }, windows)).toBe(2);
    expect(vitestWorkers({}, windows)).toBe(8);
    expect(vitestWorkers({}, linux)).toBe(16);
  });
});

describe("endToEndWorkers", () => {
  it("uses CI_PARALLELISM in CI and 3 when it is not set", () => {
    expect(endToEndWorkers({ CI: "true", CI_PARALLELISM: "4" })).toBe(4);
    expect(endToEndWorkers({ CI: "true" })).toBe(3);
  });

  it("uses 3 locally unless PAGEHALL_E2E_WORKERS says otherwise", () => {
    expect(endToEndWorkers({})).toBe(3);
    expect(endToEndWorkers({ PAGEHALL_E2E_WORKERS: "6" })).toBe(6);
    expect(endToEndWorkers({ PAGEHALL_E2E_WORKERS: "none" })).toBe(3);
  });
});

describe("parallelismLimit", () => {
  it("returns a positive whole number", () => {
    expect(parallelismLimit({ CI_PARALLELISM: "3" })).toBe(3);
  });

  it.each([undefined, "", "0", "-2", "1.5", "many"])("ignores %j so the defaults apply", (value) => {
    expect(parallelismLimit({ CI_PARALLELISM: value })).toBeUndefined();
  });
});
