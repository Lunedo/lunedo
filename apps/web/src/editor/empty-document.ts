import type { NodeJson } from "@pagehall/editor-schema";

function isBlank(node: NodeJson): boolean {
  if (node.type === "text") return (node.text ?? "").trim() === "";
  if (node.type !== "paragraph") return false;
  return (node.content ?? []).every(isBlank);
}

export function isEmptyDocument(document: { content?: NodeJson[] } | null | undefined): boolean {
  return (document?.content ?? []).every(isBlank);
}
