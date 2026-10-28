import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { GENERATE_COMMAND, renderReferences, staleReferences } from "./docs-reference.ts";
import { REFERENCES } from "./docs-references.ts";

const root = path.resolve(import.meta.dirname, "..");
const check = process.argv.includes("--check");
const pages = await renderReferences(root, REFERENCES);

if (check) {
  const problems = staleReferences(pages, (page) => {
    const file = path.join(root, page);
    return existsSync(file) ? readFileSync(file, "utf8") : undefined;
  });
  if (problems.length > 0) {
    console.error(`These generated reference pages differ from the code. Run ${GENERATE_COMMAND}:`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
} else {
  for (const [page, content] of pages) writeFileSync(path.join(root, page), content);
  console.log(`Wrote ${pages.size} reference pages.`);
}
