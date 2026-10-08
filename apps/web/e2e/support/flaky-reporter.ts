import { recordTestResult, repositoryPath } from "@pagehall/config/test-report";
import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";

export default class FlakyReporter implements Reporter {
  onTestEnd(test: TestCase, result: TestResult): void {
    const outcome = test.outcome();
    const flaky = outcome === "flaky" && result.status === "passed";
    const failed = outcome === "unexpected" && result.retry === test.retries;
    if (!flaky && !failed) return;
    recordTestResult("playwright", {
      kind: flaky ? "flaky" : "failed",
      file: repositoryPath(test.location.file),
      test: test.titlePath().slice(2).join(" > "),
    });
  }
}
