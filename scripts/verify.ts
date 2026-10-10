import { spawnSync } from "node:child_process";
import { verifySteps } from "./verify-steps.ts";

const base = process.argv[2] ?? "origin/main";
const fetched = spawnSync("git", ["fetch", "--quiet", "origin", "main"], { stdio: "inherit" });
if (fetched.status !== 0) console.warn("Could not fetch origin/main; comparing with the local copy.");

const pnpm = process.env.npm_execpath ?? "";

function invocation(command: string, args: readonly string[]): [string, string[]] {
  if (command === "node") return [process.execPath, [...args]];
  if (/\.[cm]?js$/.test(pnpm)) return [process.execPath, [pnpm, ...args]];
  return [pnpm || command, [...args]];
}

const failed: string[] = [];
for (const step of verifySteps(base)) {
  console.log(`\n${step.name}`);
  const [command, args] = invocation(step.command, step.args);
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error || result.status !== 0) failed.push(step.name);
}

if (failed.length > 0) {
  console.error(`\nFailed: ${failed.join(", ")}. Fix these before pushing.`);
  process.exit(1);
}
console.log("\nEvery check of the CI jobs passed.");
