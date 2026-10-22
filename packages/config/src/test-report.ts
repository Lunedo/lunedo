import { appendFileSync, mkdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

export type TestReportKind = "flaky" | "failed";

export interface TestReportEntry {
  kind: TestReportKind;
  file: string;
  test: string;
  job?: string;
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
  const directory = env.LUNEDO_TEST_REPORT_DIR;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  appendFileSync(
    join(directory, `${tool}-${process.pid}.jsonl`),
    `${JSON.stringify(env.LUNEDO_TEST_JOB ? { ...entry, job: env.LUNEDO_TEST_JOB } : entry)}\n`,
  );
}

export function failedAttemptsMessage(test: string, errors: readonly { message: string }[]): string {
  const first = errors[0]?.message.split("\n")[0]?.trim() ?? "no error was reported";
  const more = errors.length > 1 ? ` (and ${errors.length - 1} more)` : "";
  return `Passed on the retry: ${test}. The failed attempt ended with: ${first}${more}`;
}
