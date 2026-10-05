import { defineConfig, devices } from "@playwright/test";
import { BASE_URL } from "./e2e/support/environment.js";

const ci = Boolean(process.env.CI);
const identityProviders = process.env.PAGEHALL_E2E_IDP === "1";

export default defineConfig({
  testDir: "e2e",
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 10_000, toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: "disabled" } },
  reporter: ci ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    locale: "en-US",
    timezoneId: "Europe/Vienna",
    reducedMotion: "reduce",
  },
  projects: [
    {
      name: "setup",
      testMatch: /setup\/.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "flows",
      testMatch: /flows\/.*\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "components",
      testMatch: /components\/.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    ...(identityProviders
      ? [
          {
            name: "idp",
            testMatch: /idp\/.*\.spec\.ts/,
            dependencies: ["setup"],
            use: {
              ...devices["Desktop Chrome"],
              launchOptions: { args: ["--host-resolver-rules=MAP *.localhost 127.0.0.1"] },
            },
          },
        ]
      : []),
  ],
});
