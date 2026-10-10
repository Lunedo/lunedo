import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { uncoveredCommands, verifySteps, workflowCommands } from "./verify-steps.ts";

const workflow = readFileSync(path.join(import.meta.dirname, "../.github/workflows/ci.yml"), "utf8");

const sample = `jobs:
  checks:
    steps:
      - run: corepack enable
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - name: Compare
        run: |
          if [ "$X" = "true" ]; then
            node scripts/check-api-compatibility.ts "$BASE" --allow-breaking
          else
            node scripts/check-api-compatibility.ts "$BASE"
          fi
      - name: Folded
        run: >-
          node scripts/check-new.ts
          --strict
  unit:
    steps:
      - run: pnpm exec turbo run test
`;

describe("verify", () => {
  it("runs every check command of the CI jobs it mirrors", () => {
    assert.deepEqual(uncoveredCommands(workflow, verifySteps("origin/main")), []);
  });

  it("reads single-line, literal and folded run steps of one job and skips setup and shell syntax", () => {
    assert.deepEqual(workflowCommands(sample, "checks"), [
      "pnpm lint",
      'node scripts/check-api-compatibility.ts "$BASE" --allow-breaking',
      'node scripts/check-api-compatibility.ts "$BASE"',
      "node scripts/check-new.ts --strict",
    ]);
  });

  it("names a check command that verify does not run", () => {
    const withNewCheck = workflow.replace(
      "      - run: pnpm i18n:check\n",
      "      - run: pnpm i18n:check\n      - run: node scripts/check-something-new.ts\n",
    );
    assert.notEqual(withNewCheck, workflow);
    assert.deepEqual(uncoveredCommands(withNewCheck, verifySteps("origin/main")), [
      "node scripts/check-something-new.ts",
    ]);
  });

  it("notices a check that verify stopped running", () => {
    const steps = verifySteps("origin/main").filter((step) => step.args[0] !== "i18n:check");
    assert.deepEqual(uncoveredCommands(workflow, steps), ["pnpm i18n:check"]);
  });

  it("compares the API and sign-off with the given base", () => {
    const args = verifySteps("abc123").flatMap((step) => step.args);
    assert.ok(args.includes("abc123"));
    assert.ok(args.includes("abc123..HEAD"));
    assert.ok(!args.includes("--allow-breaking"));
  });
});
