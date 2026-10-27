import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { documentationTargets } from "../packages/shared/src/documentation.ts";
import { checkDocs, ROOT_DOCUMENTS } from "./docs-check.ts";

const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
})
  .split("\0")
  .filter((name) => name !== "" && existsSync(name));

const read = (names: string[]) => new Map(names.map((name) => [name, readFileSync(name, "utf8")]));
const problems = checkDocs({
  files: read(listed.filter((name) => name.startsWith("docs/") || ROOT_DOCUMENTS.includes(name))),
  paths: new Set(listed),
  targets: documentationTargets,
  code: read(listed.filter((name) => /^(apps|packages)\/[^/]+\/src\/.*\.(ts|tsx|mts|js|mjs)$/.test(name))),
});

if (problems.length > 0) {
  console.error("The documentation has broken links, targets or navigation entries:");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
