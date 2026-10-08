import { defaultClientConditions, defaultServerConditions } from "vite";
import { defineProject, type UserWorkspaceConfig } from "vitest/config";

export const sourceCondition = "@pagehall/source";

export interface VitestPresetOptions {
  environment?: "node" | "happy-dom";
  setupFiles?: string[];
  /** Modules run once per test run, e.g. to create a test database. */
  globalSetup?: string[];
  testTimeout?: number;
}

export function parallelismLimit(value: string | undefined = process.env.CI_PARALLELISM): number | undefined {
  const limit = Number(value);
  return Number.isInteger(limit) && limit > 0 ? limit : undefined;
}

export function createVitestConfig(options: VitestPresetOptions = {}): UserWorkspaceConfig {
  return defineProject({
    resolve: { conditions: [sourceCondition, ...defaultClientConditions] },
    // "module" is a bundler condition; Node would load builds that only bundlers can resolve.
    ssr: {
      resolve: {
        conditions: [
          sourceCondition,
          ...defaultServerConditions.filter((condition) => condition !== "module"),
        ],
      },
    },
    test: {
      include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
      environment: options.environment ?? "node",
      setupFiles: options.setupFiles ?? [],
      globalSetup: options.globalSetup ?? [],
      testTimeout: options.testTimeout ?? 5000,
      maxWorkers: parallelismLimit(),
      hookTimeout: 60_000,
      restoreMocks: true,
      unstubGlobals: true,
      unstubEnvs: true,
    },
  });
}
