import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { playwrightImageProblems } from "./playwright-image.ts";

const root = process.argv[2] ?? ".";
const directory = path.join(root, ".github", "workflows");
const workflows: Record<string, string> = {};
for (const file of readdirSync(directory)) {
  if (/\.ya?ml$/.test(file))
    workflows[`.github/workflows/${file}`] = readFileSync(path.join(directory, file), "utf8");
}

const problems = playwrightImageProblems(workflows, readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8"));
if (problems.length > 0) {
  console.error("The Playwright image does not match @playwright/test:");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
