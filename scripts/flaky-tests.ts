import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export interface FlakyEntry {
  kind: "flaky" | "failed";
  file: string;
  test: string;
  job: string;
}

export function readEntries(directory: string): FlakyEntry[] {
  const entries: FlakyEntry[] = [];
  const walk = (current: string) => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".jsonl")) {
        const job = relative(directory, current).split(sep)[0] ?? "";
        for (const line of readFileSync(path, "utf8").split("\n")) {
          if (line.trim().length === 0) continue;
          const parsed: Omit<FlakyEntry, "job"> = JSON.parse(line);
          entries.push({ ...parsed, job });
        }
      }
    }
  };
  walk(directory);
  return entries;
}

function cell(value: string): string {
  return value.replaceAll("|", "|").replaceAll("\n", " ");
}

function table(entries: readonly FlakyEntry[]): string[] {
  const unique = new Map(
    entries.map((entry) => [`${entry.job}\u0000${entry.file}\u0000${entry.test}`, entry]),
  );
  return [
    "| File | Test | Job |",
    "|---|---|---|",
    ...[...unique.values()].map((e) => `| ${cell(e.file)} | ${cell(e.test)} | ${cell(e.job)} |`),
  ];
}

export function formatSummary(entries: readonly FlakyEntry[], stress: boolean): string {
  const flaky = entries.filter((entry) => entry.kind === "flaky");
  const failed = entries.filter((entry) => entry.kind === "failed");
  const lines = ["## Flaky tests", ""];
  if (flaky.length === 0) lines.push("No test needed a retry in this run.");
  else lines.push(`${flaky.length} test(s) failed once and passed on the retry.`, "", ...table(flaky));
  if (stress) {
    lines.push("", "## Failed tests", "");
    if (failed.length === 0) lines.push("No test failed in this run.");
    else lines.push(`${failed.length} test(s) failed without retries.`, "", ...table(failed));
  }
  return `${lines.join("\n")}\n`;
}
