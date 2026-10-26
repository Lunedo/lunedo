import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";

const EVEN_WIDTHS: Record<number, number[]> = {
  2: [50, 50],
  3: [33, 34, 33],
};

function columnsOf(layout: ProseMirrorNode): ProseMirrorNode[] {
  const columns: ProseMirrorNode[] = [];
  layout.forEach((column) => {
    columns.push(column);
  });
  return columns;
}

export function dissolveLayout(tr: Transaction, position: number, layout: ProseMirrorNode): boolean {
  const blocks: ProseMirrorNode[] = [];
  for (const column of columnsOf(layout))
    column.forEach((block) => {
      blocks.push(block);
    });
  tr.replaceWith(position, position + layout.nodeSize, Fragment.from(blocks));
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(position + 1, tr.doc.content.size))));
  return true;
}

export function removeLayoutColumn(
  tr: Transaction,
  position: number,
  layout: ProseMirrorNode,
  index: number,
): boolean {
  const columns = columnsOf(layout);
  if (index < 0 || index >= columns.length) return false;
  const remaining = columns.filter((_, current) => current !== index);
  if (remaining.length < 2) {
    const blocks: ProseMirrorNode[] = [];
    for (const column of remaining)
      column.forEach((block) => {
        blocks.push(block);
      });
    tr.replaceWith(position, position + layout.nodeSize, Fragment.from(blocks));
  } else {
    const widths = EVEN_WIDTHS[remaining.length] ?? remaining.map(() => Math.round(100 / remaining.length));
    const resized = remaining.map((column, current) =>
      column.type.create({ ...column.attrs, width: widths[current] }, column.content, column.marks),
    );
    tr.replaceWith(position, position + layout.nodeSize, layout.copy(Fragment.from(resized)));
  }
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(position + 1, tr.doc.content.size))));
  return true;
}
