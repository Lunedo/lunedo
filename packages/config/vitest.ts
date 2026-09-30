import { defaultClientConditions, defaultServerConditions } from "vite";
import { defineProject, type UserWorkspaceConfig } from "vitest/config";

export const sourceCondition = "@pagehall/source";

export interface VitestPresetOptions {
  environment?: "node" | "happy-dom";
  setupFiles?: string[];
}

export function createVitestConfig(options: VitestPresetOptions = {}): UserWorkspaceConfig {
  return defineProject({
    resolve: { conditions: [sourceCondition, ...defaultClientConditions] },
    ssr: { resolve: { conditions: [sourceCondition, ...defaultServerConditions] } },
    test: {
      include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
      environment: options.environment ?? "node",
      setupFiles: options.setupFiles ?? [],
      restoreMocks: true,
      unstubGlobals: true,
      unstubEnvs: true,
    },
  });
}
