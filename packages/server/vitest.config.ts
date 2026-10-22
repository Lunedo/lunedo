import { createVitestConfig } from "@lunedo/config/vitest";

export default createVitestConfig({ globalSetup: ["./src/testing/global-setup.ts"], testTimeout: 20_000 });
