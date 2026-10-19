import type { DocumentJson, NodeJson } from "./json.js";

export interface ArticleSection {
  key: string;
  title: string;
  icon: string | null;
  content: NodeJson[];
}

const IGNORED_LEAVES: ReadonlySet<string> = new Set([
  "paragraph",
  "placeholder",
  "templateField",
  "hardBreak",
]);

function hasContent(node: NodeJson): boolean {
  if (node.type === "text") return (node.text ?? "").trim().length > 0;
  const children = node.content ?? [];
  if (children.length === 0) return !IGNORED_LEAVES.has(node.type);
  return children.some(hasContent);
}

export function sectionEmpty(section: Pick<ArticleSection, "content">): boolean {
  return !section.content.some(hasContent);
}

export function articleSections(doc: DocumentJson): ArticleSection[] {
  const sections: ArticleSection[] = [];
  const visit = (node: NodeJson) => {
    if (node.type === "section") {
      const attrs = node.attrs ?? {};
      sections.push({
        key: String(attrs.key ?? ""),
        title: typeof attrs.title === "string" ? attrs.title : "",
        icon: typeof attrs.icon === "string" ? attrs.icon : null,
        content: node.content ?? [],
      });
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(doc);
  return sections;
}

export function emptySections(doc: DocumentJson, keys: readonly string[]): string[] {
  const sections = articleSections(doc);
  return keys.filter((key) => {
    const found = sections.filter((section) => section.key === key);
    return found.length === 0 || found.every(sectionEmpty);
  });
}
