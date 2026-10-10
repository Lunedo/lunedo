import { endToEndWorkers } from "@pagehall/config/parallelism";
import { retriesFromEnv } from "@pagehall/config/test-report";
import { defineConfig, devices } from "@playwright/test";
import { BASE_URL } from "./e2e/support/environment.js";

const ci = Boolean(process.env.CI);
const identityProviders = process.env.PAGEHALL_E2E_IDP === "1";
const sweeps = process.env.PAGEHALL_E2E_SWEEPS !== "false";
const chrome = { ...devices["Desktop Chrome"] };
const afterSetup = identityProviders ? ["idp"] : ["setup"];

export default defineConfig({
  testDir: "e2e",
  forbidOnly: ci,
  retries: retriesFromEnv(),
  workers: endToEndWorkers(),
  fullyParallel: true,
  timeout: 60_000,
  expect: { timeout: 10_000, toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: "disabled" } },
  reporter: ci ? [["list"], ["html", { open: "never" }], ["./e2e/support/flaky-reporter.ts"]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    locale: "en-US",
    timezoneId: "Europe/Vienna",
    reducedMotion: "reduce",
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
  },
  projects: [
    {
      name: "setup",
      testMatch: /setup\/.*\.spec\.ts/,
      fullyParallel: false,
      ...(identityProviders ? {} : { teardown: "instance" }),
      use: chrome,
    },
    {
      name: "flows",
      testMatch: /flows\/.*\.spec\.ts/,
      dependencies: afterSetup,
      use: chrome,
    },
    {
      name: "components",
      testMatch: /components\/.*\.spec\.ts/,
      dependencies: afterSetup,
      use: chrome,
    },
    ...(sweeps
      ? [
          {
            name: "sweeps",
            testMatch: /sweeps\/.*\.spec\.ts/,
            dependencies: [...afterSetup, "flows", "components"],
            use: chrome,
          },
        ]
      : []),
    {
      name: "instance",
      testMatch: /instance\/.*\.spec\.ts/,
      workers: 1,
      fullyParallel: false,
      ...(identityProviders ? { dependencies: ["flows", "components"] } : {}),
      use: chrome,
    },
    ...(identityProviders
      ? [
          {
            name: "idp",
            testMatch: /idp\/.*\.spec\.ts/,
            dependencies: ["setup"],
            workers: 1,
            fullyParallel: false,
            use: {
              ...chrome,
              launchOptions: { args: ["--host-resolver-rules=MAP *.localhost 127.0.0.1"] },
            },
          },
        ]
      : []),
  ],
});
