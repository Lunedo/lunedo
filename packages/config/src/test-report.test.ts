import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recordTestResult, retriesFromEnv } from "./test-report.ts";

describe("retriesFromEnv", () => {
  it("retries once in CI and never locally", () => {
    expect(retriesFromEnv({ CI: "true" })).toBe(1);
    expect(retriesFromEnv({})).toBe(0);
  });

  it("lets CI_RETRIES turn retries off for the stress run", () => {
    expect(retriesFromEnv({ CI: "true", CI_RETRIES: "0" })).toBe(0);
  });

  it.each(["", "x", "-1", "1.5"])("ignores %j", (value) => {
    expect(retriesFromEnv({ CI: "true", CI_RETRIES: value })).toBe(1);
  });
});

describe("recordTestResult", () => {
  it("appends one JSON line per result to the report directory", () => {
    const directory = mkdtempSync(join(tmpdir(), "report-"));
    recordTestResult(
      "vitest",
      { kind: "flaky", file: "a.ts", test: "t" },
      { PAGEHALL_TEST_REPORT_DIR: directory },
    );
    const file = join(directory, `vitest-${process.pid}.jsonl`);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ kind: "flaky", file: "a.ts", test: "t" });
  });

  it("writes nothing without a report directory", () => {
    expect(() => recordTestResult("vitest", { kind: "failed", file: "a.ts", test: "t" }, {})).not.toThrow();
  });
});
