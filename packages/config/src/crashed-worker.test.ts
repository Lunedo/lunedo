import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const vitest = path.join(
  path.dirname(createRequire(import.meta.url).resolve("vitest/package.json")),
  "vitest.mjs",
);

let root: string | undefined;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

function project(): string {
  root = mkdtempSync(path.join(packageRoot, ".crashed-worker-"));
  mkdirSync(path.join(root, "src"));
  writeFileSync(
    path.join(root, "vitest.config.ts"),
    'import { createVitestConfig } from "../vitest.ts";\n\nexport default createVitestConfig();\n',
  );
  writeFileSync(
    path.join(root, "src", "passes.test.ts"),
    'import { expect, it } from "vitest";\n\nit("passes", () => {\n  expect(1).toBe(1);\n});\n',
  );
  writeFileSync(
    path.join(root, "src", "crashes.test.ts"),
    'import { it } from "vitest";\n\nit("ends the worker", () => {\n  process.abort();\n});\n',
  );
  return root;
}

describe("a test worker that exits abnormally", () => {
  it("fails the run and names the file it was running", () => {
    const directory = project();
    const result = spawnSync(process.execPath, [vitest, "run", "--root", directory], {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, CI_RETRIES: "0", PAGEHALL_TEST_WORKERS: "1", NO_COLOR: "1" },
      timeout: 60_000,
    });
    const output = `${result.stdout}${result.stderr}`;
    expect(result.status, output).not.toBe(0);
    expect(output).toMatch(/Worker exited unexpectedly/);
    expect(output).toMatch(/crashes\.test\.ts/);
    expect(output).not.toMatch(/Test Files\s+2 passed/);
  }, 90_000);
});
