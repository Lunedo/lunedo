import { appendFileSync } from "node:fs";
import { cacheAccess, parseOwner, prepareCache } from "./ci-cache.ts";

const [owner, root] = process.argv.slice(2);

try {
  if (!root) throw new Error("Usage: node scripts/prepare-ci-cache.ts <host|e2e> <directory>");
  const access = cacheAccess(process.env.GITHUB_EVENT_NAME, process.env.GITHUB_REF);
  const env = prepareCache(root, parseOwner(owner), process.env.RUNNER_NAME, access);
  const lines = Object.entries(env).map(([name, value]) => `${name}=${value}`);
  console.log(lines.join("\n"));
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `${lines.join("\n")}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(`::error title=CI cache on the runner::${message}`);
  process.exit(1);
}
