const privateFolders = ["ADRs", "Docs", "Prompts", "Testdata"].map((name) => `_${name}`);
const pattern = new RegExp(String.raw`\bADR[ -]?\d{4}\b|${privateFolders.join("|")}`, "g");

export interface PrivateReference {
  line: number;
  text: string;
}

// CLAUDE.md, rule on test-site fixtures: the anonymizing fixture script is the only file that may name the
// test data folder, because it must read the test site from exactly that path and refuse every other one.
const allowedReferences: ReadonlyMap<string, string> = new Map([
  ["packages/server/src/imports/testing/confluence-cloud/prepare.ts", `_${"Testdata"}`],
]);

export function findPrivateReferences(content: string, file?: string): PrivateReference[] {
  const allowed = file === undefined ? undefined : allowedReferences.get(file.replaceAll("\\", "/"));
  const references: PrivateReference[] = [];
  for (const [index, line] of content.split("\n").entries()) {
    for (const match of line.matchAll(pattern)) {
      if (match[0] !== allowed) references.push({ line: index + 1, text: match[0] });
    }
  }
  return references;
}

const textExtensions = new Set([
  "cjs",
  "css",
  "html",
  "js",
  "json",
  "jsonc",
  "md",
  "mjs",
  "mts",
  "sh",
  "sql",
  "svg",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
]);

export function isTextPath(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot > name.lastIndexOf("/") && textExtensions.has(name.slice(dot + 1).toLowerCase());
}
