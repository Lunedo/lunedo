import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { formatSummary, readEntries } from "./flaky-tests.ts";

describe("formatSummary", () => {
  it("says so when no test needed a retry", () => {
    assert.match(formatSummary([], false), /No test needed a retry/);
  });

  it("lists file, test and job of every flaky test once", () => {
    const entry = { kind: "flaky" as const, file: "a/b.test.ts", test: "x | y", job: "unit-1" };
    const text = formatSummary([entry, entry], false);
    assert.equal(text.match(/a\/b\.test\.ts/g)?.length, 1);
    assert.match(text, /\| a\/b\.test\.ts \| x \\| y \| unit-1 \|/);
    assert.doesNotMatch(text, /Failed tests/);
  });

  it("lists failed tests only for the stress run", () => {
    const failed = { kind: "failed" as const, file: "c.test.ts", test: "t", job: "e2e" };
    assert.match(formatSummary([failed], true), /Failed tests[\s\S]*c\.test\.ts/);
    assert.match(formatSummary([], true), /No test failed/);
  });
});

describe("readEntries", () => {
  it("takes the job from the artifact folder", () => {
    const root = mkdtempSync(join(tmpdir(), "flaky-"));
    mkdirSync(join(root, "test-reports-unit-2"));
    writeFileSync(
      join(root, "test-reports-unit-2", "vitest-1.jsonl"),
      `${JSON.stringify({ kind: "flaky", file: "f.ts", test: "t" })}\n\n`,
    );
    assert.deepEqual(readEntries(root), [
      { kind: "flaky", file: "f.ts", test: "t", job: "test-reports-unit-2" },
    ]);
  });
});
