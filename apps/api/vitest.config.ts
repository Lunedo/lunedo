import { createVitestConfig } from "@pagehall/config/vitest";

export default createVitestConfig({
  globalSetup: ["../../packages/server/src/testing/global-setup.ts"],
  testTimeout: 30_000,
});
