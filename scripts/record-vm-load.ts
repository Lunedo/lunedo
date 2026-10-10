import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { formatLoadSummary, type Reading, readingOf, sampleBetween } from "./vm-load.ts";

const INTERVAL_SECONDS = 5;

function read(): Reading {
  return readingOf(new Date(), readFileSync("/proc/stat", "utf8"), readFileSync("/proc/meminfo", "utf8"));
}

const [command, file, title] = process.argv.slice(2);

if (command === "record" && file) {
  let previous = read();
  setInterval(() => {
    const next = read();
    appendFileSync(file, `${JSON.stringify(sampleBetween(previous, next))}\n`);
    previous = next;
  }, INTERVAL_SECONDS * 1000);
} else if (command === "summary" && file && title) {
  const samples = existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line))
    : [];
  const summary = formatLoadSummary(title, samples, INTERVAL_SECONDS);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
} else {
  console.error(
    "Usage: node scripts/record-vm-load.ts record <file> | node scripts/record-vm-load.ts summary <file> <title>",
  );
  process.exit(2);
}
