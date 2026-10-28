import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { documentationTargets } from "../packages/shared/src/documentation.ts";
import { checkDocs, ROOT_DOCUMENTS } from "./docs-check.ts";
import { GENERATE_COMMAND, renderReferences, staleReferences } from "./docs-reference.ts";
import { REFERENCES } from "./docs-references.ts";

const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
})
  .split("\0")
  .filter((name) => name !== "" && existsSync(name));

const read = (names: string[]) => new Map(names.map((name) => [name, readFileSync(name, "utf8")]));
const problems: string[] = checkDocs({
  files: read(listed.filter((name) => name.startsWith("docs/") || ROOT_DOCUMENTS.includes(name))),
  paths: new Set(listed),
  targets: documentationTargets,
  code: read(listed.filter((name) => /^(apps|packages)\/[^/]+\/src\/.*\.(ts|tsx|mts|js|mjs)$/.test(name))),
});

const generated = await renderReferences(process.cwd(), REFERENCES);
for (const problem of staleReferences(generated, (page) =>
  existsSync(page) ? readFileSync(page, "utf8") : undefined,
)) {
  problems.push(`${problem}; generated pages change only through ${GENERATE_COMMAND}`);
}

if (problems.length > 0) {
  console.error(
    "The documentation has broken links, targets, navigation entries or outdated generated pages:",
  );
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
