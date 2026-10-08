import { appendFileSync, mkdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

export type TestReportKind = "flaky" | "failed";

export interface TestReportEntry {
  kind: TestReportKind;
  file: string;
  test: string;
}

export function retriesFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const override = Number(env.CI_RETRIES);
  if (env.CI_RETRIES !== undefined && env.CI_RETRIES !== "" && Number.isInteger(override) && override >= 0) {
    return override;
  }
  return env.CI ? 1 : 0;
}

export function repositoryPath(absoluteFile: string, env: NodeJS.ProcessEnv = process.env): string {
  const root = env.GITHUB_WORKSPACE ?? process.cwd();
  return relative(root, absoluteFile).split(sep).join("/");
}

export function recordTestResult(
  tool: string,
  entry: TestReportEntry,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const directory = env.PAGEHALL_TEST_REPORT_DIR;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  appendFileSync(join(directory, `${tool}-${process.pid}.jsonl`), `${JSON.stringify(entry)}\n`);
}
