import type { Editor } from "@tiptap/core";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { CellSelection, findTable, TableMap } from "@tiptap/pm/tables";

export interface ActiveTable {
  node: ProseMirrorNode;
  pos: number;
  map: TableMap;
}

export function activeTable(editor: Editor): ActiveTable | null {
  const found = findTable(editor.state.selection.$from);
  if (!found) return null;
  return { node: found.node, pos: found.pos, map: TableMap.get(found.node) };
}

export function hasMergedCells(table: ProseMirrorNode): boolean {
  let merged = false;
  table.descendants((node) => {
    if (node.type.spec.tableRole === "cell" || node.type.spec.tableRole === "header_cell") {
      if (Number(node.attrs.colspan) > 1 || Number(node.attrs.rowspan) > 1) merged = true;
      return false;
    }
    return !merged;
  });
  return merged;
}

function cellPos(table: ActiveTable, row: number, column: number): number {
  return table.pos + 1 + (table.map.map[row * table.map.width + column] ?? 0);
}

export function selectRow(editor: Editor, table: ActiveTable, row: number): void {
  const $anchor = editor.state.doc.resolve(cellPos(table, row, 0));
  const $head = editor.state.doc.resolve(cellPos(table, row, table.map.width - 1));
  editor.view.dispatch(editor.state.tr.setSelection(CellSelection.rowSelection($anchor, $head)));
}

export function selectColumn(editor: Editor, table: ActiveTable, column: number): void {
  const $anchor = editor.state.doc.resolve(cellPos(table, 0, column));
  const $head = editor.state.doc.resolve(cellPos(table, table.map.height - 1, column));
  editor.view.dispatch(editor.state.tr.setSelection(CellSelection.colSelection($anchor, $head)));
}

function replaceRows(editor: Editor, table: ActiveTable, rows: ProseMirrorNode[]): boolean {
  const next = table.node.copy(Fragment.from(rows));
  editor.view.dispatch(editor.state.tr.replaceWith(table.pos, table.pos + table.node.nodeSize, next));
  return true;
}

function rowsOf(table: ProseMirrorNode): ProseMirrorNode[] {
  const rows: ProseMirrorNode[] = [];
  table.forEach((row) => {
    rows.push(row);
  });
  return rows;
}

export function moveRow(editor: Editor, table: ActiveTable, row: number, offset: -1 | 1): boolean {
  const rows = rowsOf(table.node);
  const target = row + offset;
  if (hasMergedCells(table.node) || target < 0 || target >= rows.length) return false;
  const moved = [...rows];
  const [current] = moved.splice(row, 1);
  if (!current) return false;
  moved.splice(target, 0, current);
  return replaceRows(editor, table, moved);
}

function withCells(row: ProseMirrorNode, cells: ProseMirrorNode[]): ProseMirrorNode {
  return row.copy(Fragment.from(cells));
}

function cellsOf(row: ProseMirrorNode): ProseMirrorNode[] {
  const cells: ProseMirrorNode[] = [];
  row.forEach((cell) => {
    cells.push(cell);
  });
  return cells;
}

export function moveColumn(editor: Editor, table: ActiveTable, column: number, offset: -1 | 1): boolean {
  const target = column + offset;
  if (hasMergedCells(table.node) || target < 0 || target >= table.map.width) return false;
  const rows = rowsOf(table.node).map((row) => {
    const cells = cellsOf(row);
    const [current] = cells.splice(column, 1);
    if (current) cells.splice(target, 0, current);
    return withCells(row, cells);
  });
  return replaceRows(editor, table, rows);
}

function headerRow(row: ProseMirrorNode): boolean {
  return cellsOf(row).every((cell) => cell.type.spec.tableRole === "header_cell");
}

export function sortByColumn(
  editor: Editor,
  table: ActiveTable,
  column: number,
  direction: "ascending" | "descending",
  locale: string,
): boolean {
  if (hasMergedCells(table.node)) return false;
  const rows = rowsOf(table.node);
  const head = rows[0] && headerRow(rows[0]) ? [rows[0]] : [];
  const body = rows.slice(head.length);
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const text = (row: ProseMirrorNode) => cellsOf(row)[column]?.textContent.trim() ?? "";
  const sorted = [...body].sort((left, right) => {
    const order = collator.compare(text(left), text(right));
    return direction === "ascending" ? order : -order;
  });
  return replaceRows(editor, table, [...head, ...sorted]);
}

export function deleteSelectedTablePart(editor: Editor): boolean {
  const { selection } = editor.state;
  if (!(selection instanceof CellSelection)) return false;
  const rows = selection.isRowSelection();
  const columns = selection.isColSelection();
  if (rows && columns) return editor.commands.deleteTable();
  if (rows) return editor.commands.deleteRow();
  if (columns) return editor.commands.deleteColumn();
  return false;
}
