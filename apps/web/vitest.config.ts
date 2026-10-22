import { createVitestConfig } from "@lunedo/config/vitest";

export default createVitestConfig({
  environment: "happy-dom",
  setupFiles: ["./vitest.setup.ts"],
  testTimeout: 20_000,
});
