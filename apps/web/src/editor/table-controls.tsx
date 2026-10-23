import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { Plus } from "lucide-react";
import { type RefObject, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const NEAR = 10;

interface Hover {
  table: HTMLTableElement;
  x: number;
  y: number;
}

interface Layout {
  top: number;
  left: number;
  width: number;
  height: number;
  column: { index: number; x: number } | null;
  row: { index: number; y: number } | null;
}

function cellAt(table: HTMLTableElement, row: number, column: number): HTMLElement | null {
  return (table.rows[row]?.cells[column] as HTMLElement | undefined) ?? null;
}

export function runInCell(
  editor: Editor,
  cell: HTMLElement | null,
  action: "addColumnAfter" | "addRowAfter",
): boolean {
  if (!cell) return false;
  const position = editor.view.posAtDOM(cell, 0);
  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.setSelection(TextSelection.near(tr.doc.resolve(position)));
      return true;
    })
    [action]()
    .run();
}

function layoutOf(hover: Hover, container: HTMLElement): Layout {
  const box = container.getBoundingClientRect();
  const bounds = hover.table.getBoundingClientRect();
  const first = hover.table.rows[0];
  let column: Layout["column"] = null;
  for (const [index, cell] of Array.from(first?.cells ?? []).entries()) {
    const edge = cell.getBoundingClientRect().right;
    if (Math.abs(edge - hover.x) <= NEAR) column = { index, x: edge - box.left };
  }
  let row: Layout["row"] = null;
  for (const [index, line] of Array.from(hover.table.rows).entries()) {
    const edge = line.getBoundingClientRect().bottom;
    if (Math.abs(edge - hover.y) <= NEAR) row = { index, y: edge - box.top };
  }
  return {
    top: bounds.top - box.top,
    left: bounds.left - box.left,
    width: bounds.width,
    height: bounds.height,
    column,
    row,
  };
}

const PLUS =
  "absolute z-10 flex size-control-sm -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-accent text-on-accent shadow-card hover:bg-accent-hover focus-visible:focus-ring";

export function TableControls({
  editor,
  container,
}: {
  editor: Editor;
  container: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<Hover | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const move = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-table-control]")) return;
      const table = target.closest<HTMLTableElement>(".ProseMirror table");
      setHover(table && editor.isEditable ? { table, x: event.clientX, y: event.clientY } : null);
    };
    const leave = () => setHover(null);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerleave", leave);
    return () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerleave", leave);
    };
  }, [container, editor]);

  const element = container.current;
  if (!hover || !element || !hover.table.isConnected) return null;
  const layout = layoutOf(hover, element);
  const lastRow = hover.table.rows.length - 1;
  return (
    <>
      {layout.column ? (
        <button
          type="button"
          data-table-control=""
          className={PLUS}
          style={{ left: layout.column.x, top: layout.top }}
          aria-label={t("editor.table.addColumnHere")}
          title={t("editor.table.addColumnHere")}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (layout.column)
              runInCell(editor, cellAt(hover.table, 0, layout.column.index), "addColumnAfter");
            setHover(null);
          }}
        >
          <Plus aria-hidden="true" className="size-icon-sm" />
        </button>
      ) : null}
      {layout.row ? (
        <button
          type="button"
          data-table-control=""
          className={PLUS}
          style={{ left: layout.left, top: layout.row.y }}
          aria-label={t("editor.table.addRowHere")}
          title={t("editor.table.addRowHere")}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (layout.row) runInCell(editor, cellAt(hover.table, layout.row.index, 0), "addRowAfter");
            setHover(null);
          }}
        >
          <Plus aria-hidden="true" className="size-icon-sm" />
        </button>
      ) : null}
      <button
        type="button"
        data-table-control=""
        className="absolute z-10 inline-flex h-control-sm -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-surface px-3 text-sm text-text-muted shadow-card hover:text-text focus-visible:focus-ring"
        style={{ left: layout.left + layout.width / 2, top: layout.top + layout.height - 4 }}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => runInCell(editor, cellAt(hover.table, lastRow, 0), "addRowAfter")}
      >
        <Plus aria-hidden="true" className="size-icon-sm" />
        {t("editor.table.addRowBelow")}
      </button>
    </>
  );
}
