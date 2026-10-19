import { isKnowledgeBase } from "../knowledge-bases/queries.js";

export type CreatableKind = "page" | "folder" | "link" | "whiteboard";

const STANDARD: readonly CreatableKind[] = ["page", "folder", "whiteboard", "link"];
const KNOWLEDGE_BASE: readonly CreatableKind[] = ["page", "folder"];

export function creatableKinds(space: { type: string }): readonly CreatableKind[] {
  return isKnowledgeBase(space) ? KNOWLEDGE_BASE : STANDARD;
}

export function canContain(space: { type: string }, kind: string): boolean {
  return isKnowledgeBase(space) ? kind === "folder" : kind === "page" || kind === "folder";
}
