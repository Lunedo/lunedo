import { execFileSync, spawnSync } from "node:child_process";
import { shellcheckArguments, shellScripts } from "./shell-scripts.ts";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const scripts = shellScripts(execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n"));
const result = spawnSync("docker", shellcheckArguments(root, scripts), {
  stdio: "inherit",
  env: { ...process.env, MSYS_NO_PATHCONV: "1" },
});
if (result.error) {
  console.error(`shellcheck could not run in Docker: ${result.error.message}. Start Docker and try again.`);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Checked ${scripts.length} shell scripts`);
