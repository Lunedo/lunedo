import type { Node as ProseMirrorNode, Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import type { DocumentJson } from "./json.js";

export const MAX_QUOTE_LENGTH = 1000;
export const ANCHOR_CONTEXT_LENGTH = 64;

export interface TextAnchor {
  exact: string;
  prefix: string;
  suffix: string;
}

interface Textblock {
  text: string;
  positions: number[];
}

function textblocks(doc: ProseMirrorNode): Textblock[] {
  const blocks: Textblock[] = [];
  doc.descendants((node, position) => {
    if (!node.isTextblock) return true;
    const block: Textblock = { text: "", positions: [] };
    node.forEach((child, offset) => {
      if (!child.isText || !child.text) return;
      for (let index = 0; index < child.text.length; index += 1) {
        block.positions.push(position + 1 + offset + index);
      }
      block.text += child.text;
    });
    blocks.push(block);
    return false;
  });
  return blocks;
}

function commonSuffix(left: string, right: string): number {
  let length = 0;
  while (
    length < left.length &&
    length < right.length &&
    left[left.length - 1 - length] === right[right.length - 1 - length]
  ) {
    length += 1;
  }
  return length;
}

function commonPrefix(left: string, right: string): number {
  let length = 0;
  while (length < left.length && length < right.length && left[length] === right[length]) length += 1;
  return length;
}

export function isValidAnchor(anchor: TextAnchor): boolean {
  return (
    anchor.exact.trim().length > 0 &&
    anchor.exact.length <= MAX_QUOTE_LENGTH &&
    anchor.prefix.length <= ANCHOR_CONTEXT_LENGTH &&
    anchor.suffix.length <= ANCHOR_CONTEXT_LENGTH
  );
}

export function locateAnchor(doc: ProseMirrorNode, anchor: TextAnchor): { from: number; to: number } | null {
  if (!isValidAnchor(anchor)) return null;
  let best: { from: number; to: number; score: number } | null = null;
  for (const block of textblocks(doc)) {
    let index = block.text.indexOf(anchor.exact);
    while (index !== -1) {
      const score =
        commonSuffix(block.text.slice(0, index), anchor.prefix) +
        commonPrefix(block.text.slice(index + anchor.exact.length), anchor.suffix);
      if (!best || score > best.score) {
        const from = block.positions[index] as number;
        const to = (block.positions[index + anchor.exact.length - 1] as number) + 1;
        best = { from, to, score };
      }
      index = block.text.indexOf(anchor.exact, index + 1);
    }
  }
  return best ? { from: best.from, to: best.to } : null;
}

export function anchorAt(doc: ProseMirrorNode, from: number, to: number): TextAnchor | null {
  for (const block of textblocks(doc)) {
    const start = block.positions.findIndex((position) => position >= from);
    if (start === -1 || (block.positions[start] as number) >= to) continue;
    let end = start;
    while (end < block.positions.length && (block.positions[end] as number) < to) end += 1;
    const anchor = {
      exact: block.text.slice(start, end),
      prefix: block.text.slice(Math.max(0, start - ANCHOR_CONTEXT_LENGTH), start),
      suffix: block.text.slice(end, end + ANCHOR_CONTEXT_LENGTH),
    };
    return isValidAnchor(anchor) ? anchor : null;
  }
  return null;
}

export function addInlineCommentMark(
  schema: Schema,
  json: DocumentJson,
  anchor: TextAnchor,
  threadId: string,
): DocumentJson | null {
  const doc = schema.nodeFromJSON(json);
  const range = locateAnchor(doc, anchor);
  const markType = schema.marks.inlineComment;
  if (!range || !markType) return null;
  const transaction = EditorState.create({ doc }).tr.addMark(
    range.from,
    range.to,
    markType.create({ threadId }),
  );
  return transaction.doc.toJSON() as DocumentJson;
}

export function hasAnchor(schema: Schema, json: DocumentJson, anchor: TextAnchor): boolean {
  return locateAnchor(schema.nodeFromJSON(json), anchor) !== null;
}
