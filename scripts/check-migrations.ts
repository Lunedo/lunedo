import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { migrationOrderProblems, parseJournal } from "./migration-order.ts";

const folder = path.join(process.argv[2] ?? ".", "packages/server/drizzle");
const files = [
  ...readdirSync(folder).filter((file) => file.endsWith(".sql")),
  ...readdirSync(path.join(folder, "meta")).map((file) => `meta/${file}`),
];
const entries = parseJournal(readFileSync(path.join(folder, "meta", "_journal.json"), "utf8"));
const problems = migrationOrderProblems(entries, files);
if (problems.length > 0) {
  console.error("The migrations are out of order:");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error("See docs/development/environment.md#migration-number-conflicts.");
  process.exit(1);
}
console.log(`Checked the order of ${entries.length} ${entries.length === 1 ? "migration" : "migrations"}`);
