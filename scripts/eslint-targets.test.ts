import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { eslintTargets } from "./eslint-targets.ts";

describe("eslintTargets", () => {
  it("lints every workspace in its own run and the root files last", () => {
    const directories: Record<string, string[]> = {
      [path.join("/repo", "apps")]: ["web", "api"],
      [path.join("/repo", "packages")]: ["server"],
    };
    const targets = eslintTargets("/repo", (directory) => directories[directory] ?? []);
    assert.deepEqual(targets, [
      ["apps/api"],
      ["apps/web"],
      ["packages/server"],
      ["scripts", "docker", "eslint.config.js"],
    ]);
  });
});
