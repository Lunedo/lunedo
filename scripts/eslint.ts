import { spawnSync } from "node:child_process";
import path from "node:path";
import { eslintTargets } from "./eslint-targets.ts";

const root = path.resolve(import.meta.dirname, "..");
const eslint = path.join(root, "node_modules/eslint/bin/eslint.js");

const failed: string[] = [];
for (const targets of eslintTargets(root)) {
  const result = spawnSync(
    process.execPath,
    [eslint, "--no-error-on-unmatched-pattern", ...targets, ...process.argv.slice(2)],
    { cwd: root, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) failed.push(targets.join(" "));
}

if (failed.length > 0) {
  console.error(`ESLint failed for: ${failed.join(", ")}`);
  process.exit(1);
}
