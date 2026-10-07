import type { DocumentJson, NodeJson } from "./json.js";
import type { PageLinkTarget } from "./module.js";

const encoder = new TextEncoder();

function visit(node: NodeJson, callback: (node: NodeJson) => void): void {
  callback(node);
  for (const child of node.content ?? []) visit(child, callback);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function extractPageLinks(doc: DocumentJson): PageLinkTarget[] {
  const links: PageLinkTarget[] = [];
  visit(doc, (node) => {
    if (node.type !== "pageLink") return;
    links.push({
      pageId: stringOrNull(node.attrs?.pageId),
      spaceId: stringOrNull(node.attrs?.spaceId),
      title: stringOrNull(node.attrs?.title),
    });
  });
  return links;
}

export function extractMentions(doc: DocumentJson): string[] {
  const ids = new Set<string>();
  visit(doc, (node) => {
    const id = node.type === "mention" ? stringOrNull(node.attrs?.id) : null;
    if (id) ids.add(id);
  });
  return [...ids];
}

export function documentSize(doc: unknown): number {
  return encoder.encode(JSON.stringify(doc)).length;
}

export function emptyDocument(): DocumentJson {
  return { type: "doc", content: [{ type: "paragraph", attrs: { textAlign: "left", indent: 0 } }] };
}
