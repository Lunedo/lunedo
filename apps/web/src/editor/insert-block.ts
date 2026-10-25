import type { Editor, JSONContent, Range } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

export function nearestOfType(editor: Editor, type: string, near: number): number | null {
  let found: number | null = null;
  editor.state.doc.descendants((node, position) => {
    if (node.type.name !== type) return true;
    if (found === null || Math.abs(position - near) < Math.abs(found - near)) found = position;
    return false;
  });
  return found;
}

export function insertBlock(editor: Editor, range: Range, content: JSONContent): boolean {
  const inserted = editor.chain().focus().deleteRange(range).insertContentAt(range.from, content).run();
  if (!inserted || !content.type) return inserted;
  const position = nearestOfType(editor, content.type, range.from);
  if (position === null) return inserted;
  const node = editor.state.doc.nodeAt(position);
  if (!node) return inserted;
  const tr = editor.state.tr;
  if (node.isAtom) {
    const after = position + node.nodeSize;
    if (after >= tr.doc.content.size) {
      const paragraph = editor.schema.nodes.paragraph?.create();
      if (paragraph) tr.insert(after, paragraph);
    }
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(after + 1, tr.doc.content.size))));
  } else {
    tr.setSelection(TextSelection.near(tr.doc.resolve(position + 1)));
  }
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

export function tableContent(rows: number, columns: number, header: boolean): JSONContent {
  const cell = (type: string) => ({ type, content: [{ type: "paragraph" }] });
  return {
    type: "table",
    content: Array.from({ length: rows }, (_, row) => ({
      type: "tableRow",
      content: Array.from({ length: columns }, () => cell(header && row === 0 ? "tableHeader" : "tableCell")),
    })),
  };
}
