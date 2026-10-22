import { defineConfig, devices } from "@playwright/test";
import { BASE_URL } from "./e2e/support/environment.js";

const chrome = { ...devices["Desktop Chrome"] };

export default defineConfig({
  testDir: "e2e/screens",
  retries: 0,
  workers: 1,
  fullyParallel: false,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: BASE_URL,
    locale: "de-DE",
    timezoneId: "Europe/Vienna",
    reducedMotion: "reduce",
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    ...chrome,
  },
  projects: [
    { name: "setup", testMatch: /setup\.spec\.ts/, use: { locale: "en-US" } },
    { name: "content", testMatch: /content\.spec\.ts/, dependencies: ["setup"], use: { locale: "en-US" } },
    { name: "screens", testMatch: /screens\.spec\.ts/, dependencies: ["content"] },
  ],
});
