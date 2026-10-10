import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { type Manifest, patchesOf, patchProblems } from "./patched-dependencies.ts";

const root = process.argv[2] ?? ".";
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const manifests: Manifest[] = [{ file: "package.json", content: read("package.json") }];
for (const group of ["apps", "packages"]) {
  for (const entry of readdirSync(path.join(root, group), { withFileTypes: true })) {
    const file = `${group}/${entry.name}/package.json`;
    if (entry.isDirectory() && existsSync(path.join(root, file)))
      manifests.push({ file, content: read(file) });
  }
}

const problems = patchProblems(patchesOf(read("pnpm-workspace.yaml")), manifests, read("pnpm-lock.yaml"));
if (problems.length > 0) {
  console.error("A patched dependency changed:");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
