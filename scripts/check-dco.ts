import { execFileSync } from "node:child_process";
import { commitsWithoutSignOff, gitLogFormat, parseGitLog } from "./dco.ts";

const range = process.argv[2];
if (!range) {
  console.error("Usage: node scripts/check-dco.ts <base>..<head>");
  process.exit(2);
}

const output = execFileSync("git", ["log", "--no-merges", `--format=${gitLogFormat}`, range], {
  encoding: "utf8",
});
const missing = commitsWithoutSignOff(parseGitLog(output));

if (missing.length > 0) {
  console.error("Commits without a Developer Certificate of Origin sign-off by their author:");
  for (const commit of missing)
    console.error(`  ${commit.sha.slice(0, 12)} ${commit.message.split("\n")[0]}`);
  console.error("Sign off with `git commit -s`. See CONTRIBUTING.md.");
  process.exit(1);
}
console.log("All commits are signed off.");
