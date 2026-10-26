import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const REFERENCE =
  /["'`(](?:\.\/|\/)?((?:assets\/)?[\w.-]+\.(?:js|css|woff2?|ttf|otf|svg|png|webp|wasm))["'`)?#]/g;

function referencesOf(text: string, from: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(REFERENCE)) {
    const name = match[1] ?? "";
    const file = name.startsWith("assets/") ? name : path.posix.join(path.posix.dirname(from), name);
    found.add(file);
  }
  return [...found];
}

export function pageFiles(dist: string, page: string): string[] {
  const seen = new Set<string>([page]);
  const queue = referencesOf(readFileSync(path.join(dist, page), "utf8"), page);
  while (queue.length > 0) {
    const file = queue.pop() ?? "";
    if (seen.has(file) || !existsSync(path.join(dist, file))) continue;
    seen.add(file);
    if (/\.(?:js|css)$/.test(file))
      queue.push(...referencesOf(readFileSync(path.join(dist, file), "utf8"), file));
  }
  return [...seen].sort();
}

export function copyPageFiles(dist: string, page: string, target: string): string[] {
  const files = pageFiles(dist, page);
  for (const file of files) {
    mkdirSync(path.dirname(path.join(target, file)), { recursive: true });
    copyFileSync(path.join(dist, file), path.join(target, file));
  }
  return files;
}

if (import.meta.main) {
  const [dist, page, target] = process.argv.slice(2);
  if (!dist || !page || !target) {
    console.error("Usage: node scripts/page-files.ts <dist folder> <page> <target folder>");
    process.exit(1);
  }
  const files = copyPageFiles(dist, page, target);
  console.log(`Copied ${files.length} files of ${page} to ${target}`);
}
