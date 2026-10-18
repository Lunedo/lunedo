import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { findPrivateReferences, isTextPath } from "./private-references.ts";

const usage = "Usage: node scripts/check-private-references.ts [--staged | --message <file>]";
const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

function files(staged: boolean): { name: string; content: () => string }[] {
  const names = staged
    ? git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z")
    : git("ls-files", "-z");
  return names
    .split("\0")
    .filter(Boolean)
    .map((name) => ({
      name,
      content: () => (staged ? git("show", `:${name}`) : readFileSync(name, "utf8")),
    }));
}

const [mode, file] = process.argv.slice(2);
const sources =
  mode === "--message" && file
    ? [{ name: "commit message", content: () => readFileSync(file, "utf8") }]
    : mode === undefined || mode === "--staged"
      ? files(mode === "--staged")
      : null;
if (!sources) {
  console.error(usage);
  process.exit(2);
}

const findings: string[] = [];
const binary: string[] = [];
for (const source of sources) {
  const content = source.content();
  if (content.includes("\0")) {
    if (isTextPath(source.name)) binary.push(source.name);
    continue;
  }
  for (const reference of findPrivateReferences(content)) {
    findings.push(`${source.name}:${reference.line}: ${reference.text}`);
  }
}
if (binary.length > 0) {
  console.error(
    "Text files must not contain NUL characters; git treats them as binary. Write them as escapes:",
  );
  for (const name of binary) console.error(`  ${name}`);
}
if (findings.length > 0) {
  console.error("References to private project documents are not allowed; state the reason itself instead:");
  for (const finding of findings) console.error(`  ${finding}`);
}
if (binary.length > 0 || findings.length > 0) process.exit(1);
