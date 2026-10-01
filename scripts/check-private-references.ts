import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { findPrivateReferences } from "./private-references.ts";

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
for (const source of sources) {
  const content = source.content();
  if (content.includes("\0")) continue;
  for (const reference of findPrivateReferences(content)) {
    findings.push(`${source.name}:${reference.line}: ${reference.text}`);
  }
}
if (findings.length > 0) {
  console.error("References to private project documents are not allowed; state the reason itself instead:");
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}
