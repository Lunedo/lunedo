import { appendFileSync } from "node:fs";
import { parseOwner, prepareCache } from "./ci-cache.ts";

const [owner, root] = process.argv.slice(2);

try {
  if (!root) throw new Error("Usage: node scripts/prepare-ci-cache.ts <host|container> <directory>");
  const env = prepareCache(root, parseOwner(owner), process.env.RUNNER_NAME);
  const lines = Object.entries(env).map(([name, value]) => `${name}=${value}`);
  console.log(lines.join("\n"));
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `${lines.join("\n")}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(`::error title=CI cache on the runner::${message}`);
  process.exit(1);
}
