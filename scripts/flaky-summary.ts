import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { formatSummary, readEntries } from "./flaky-tests.ts";

const [directory, output] = process.argv.slice(2);
if (!directory || !output) {
  console.error("Usage: node scripts/flaky-summary.ts <reports directory> <output file>");
  process.exit(2);
}
const entries = existsSync(directory) ? readEntries(directory) : [];
const summary = formatSummary(entries, process.env.GITHUB_EVENT_NAME === "schedule");
writeFileSync(output, summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(summary);
