import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { releaseJobProblems } from "./release-jobs.ts";

const root = process.argv[2] ?? ".";
const directory = path.join(root, ".github", "workflows");
const workflows: Record<string, string> = {};
for (const file of readdirSync(directory)) {
  if (/\.ya?ml$/.test(file))
    workflows[`.github/workflows/${file}`] = readFileSync(path.join(directory, file), "utf8");
}

const problems = releaseJobProblems(workflows);
if (problems.length > 0) {
  console.error("Jobs that publish releases are not isolated from pull request code:");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`Checked the release jobs of ${Object.keys(workflows).length} workflows`);
