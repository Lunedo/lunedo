import { describe, expect, it, vi } from "vitest";
import { createVitestConfig } from "../vitest.ts";

describe("createVitestConfig", () => {
  it("limits the Vitest workers to CI_PARALLELISM when it is set", () => {
    vi.stubEnv("CI_PARALLELISM", "2");
    expect(createVitestConfig().test?.maxWorkers).toBe(2);
  });

  it("uses the workers that the local budget gives each package", () => {
    vi.stubEnv("CI", "");
    vi.stubEnv("CI_PARALLELISM", "");
    vi.stubEnv("LUNEDO_TEST_WORKERS", "3");
    expect(createVitestConfig().test?.maxWorkers).toBe(3);
  });
});
