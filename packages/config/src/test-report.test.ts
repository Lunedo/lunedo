import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { failedAttemptsMessage, recordTestResult, retriesFromEnv } from "./test-report.ts";

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

  it("adds the job name when it is set", () => {
    const directory = mkdtempSync(join(tmpdir(), "report-"));
    recordTestResult(
      "vitest",
      { kind: "flaky", file: "a.ts", test: "t" },
      { PAGEHALL_TEST_REPORT_DIR: directory, PAGEHALL_TEST_JOB: "Unit tests (2 of 3)" },
    );
    const file = join(directory, `vitest-${process.pid}.jsonl`);
    expect(JSON.parse(readFileSync(file, "utf8")).job).toBe("Unit tests (2 of 3)");
  });

  it("writes nothing without a report directory", () => {
    expect(() => recordTestResult("vitest", { kind: "failed", file: "a.ts", test: "t" }, {})).not.toThrow();
  });
});

describe("failedAttemptsMessage", () => {
  it("names the test and the first line of the error of the failed attempt", () => {
    expect(
      failedAttemptsMessage("migrations > links invitations", [
        { message: "connect ECONNRESET\n    at Socket" },
        { message: "second" },
      ]),
    ).toBe(
      "Passed on the retry: migrations > links invitations. The failed attempt ended with: connect ECONNRESET (and 1 more)",
    );
  });

  it("says so when the failed attempt reported no error", () => {
    expect(failedAttemptsMessage("a test", [])).toMatch(/ended with: no error was reported$/);
  });
});
