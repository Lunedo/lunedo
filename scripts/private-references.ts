const privateFolders = ["ADRs", "Docs", "Prompts", "Testdata"].map((name) => `_${name}`);
const pattern = new RegExp(String.raw`\bADR[ -]?\d{4}\b|${privateFolders.join("|")}`, "g");

export interface PrivateReference {
  line: number;
  text: string;
}

export function findPrivateReferences(content: string): PrivateReference[] {
  const references: PrivateReference[] = [];
  for (const [index, line] of content.split("\n").entries()) {
    for (const match of line.matchAll(pattern)) references.push({ line: index + 1, text: match[0] });
  }
  return references;
}
