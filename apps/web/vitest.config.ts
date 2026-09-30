import { createVitestConfig } from "@pagehall/config/vitest";

export default createVitestConfig({ environment: "happy-dom", setupFiles: ["./vitest.setup.ts"] });
