import { isAbsolute, join } from "node:path";
import type { Reporter, TestCase } from "vitest/node";
import { recordTestResult, repositoryPath } from "./test-report.ts";

export default class FlakyReporter implements Reporter {
  onTestCaseResult(testCase: TestCase): void {
    const state = testCase.result().state;
    const flaky = state === "passed" && testCase.diagnostic()?.flaky === true;
    if (!flaky && state !== "failed") return;
    const module = testCase.module;
    const absolute = isAbsolute(module.moduleId)
      ? module.moduleId
      : join(process.cwd(), module.relativeModuleId);
    recordTestResult("vitest", {
      kind: flaky ? "flaky" : "failed",
      file: repositoryPath(absolute),
      test: testCase.fullName,
    });
  }
}
