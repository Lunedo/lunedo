import { Button, Checkbox, Field, Input, Popover } from "@lunedo/ui";
import type { Editor } from "@tiptap/core";
import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { insertBlock, tableContent } from "./insert-block.js";

export const GRID_COLUMNS = 8;
export const GRID_ROWS = 6;
const MAX_SIZE = 20;

export interface TableSize {
  columns: number;
  rows: number;
  header: boolean;
}

export function insertTable(editor: Editor, size: TableSize): boolean {
  const position = editor.state.selection.from;
  return insertBlock(
    editor,
    { from: position, to: position },
    tableContent(size.rows, size.columns, size.header),
  );
}

function clamp(value: number): number {
  return Math.min(Math.max(Math.round(value), 1), MAX_SIZE);
}

export function TableSizePicker({
  editor,
  open,
  onOpenChange,
}: {
  editor: Editor;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [columns, setColumns] = useState(3);
  const [rows, setRows] = useState(3);
  const [header, setHeader] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const grid = useRef<HTMLFieldSetElement>(null);
  const anchor = useMemo(() => {
    return {
      getBoundingClientRect: () => {
        try {
          const coords = editor.view.coordsAtPos(editor.state.selection.from);
          return new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top);
        } catch {
          return new DOMRect();
        }
      },
    };
  }, [editor]);

  const insert = (size: TableSize) => {
    onOpenChange(false);
    insertTable(editor, size);
  };

  const submit = () => {
    if (!Number.isFinite(columns) || !Number.isFinite(rows) || columns < 1 || rows < 1) {
      setError(t("editor.tableSize.invalid", { max: MAX_SIZE }));
      return;
    }
    insert({ columns: clamp(columns), rows: clamp(rows), header });
  };

  const moveFocus = (event: KeyboardEvent<HTMLFieldSetElement>) => {
    const moves: Record<string, [number, number]> = {
      ArrowRight: [1, 0],
      ArrowLeft: [-1, 0],
      ArrowDown: [0, 1],
      ArrowUp: [0, -1],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const nextColumns = Math.min(Math.max(columns + move[0], 1), GRID_COLUMNS);
    const nextRows = Math.min(Math.max(rows + move[1], 1), GRID_ROWS);
    setColumns(nextColumns);
    setRows(nextRows);
    grid.current?.querySelector<HTMLButtonElement>(`[data-cell="${nextColumns}x${nextRows}"]`)?.focus();
  };

  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      anchor={anchor}
      align="start"
      label={t("editor.tableSize.title")}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        if (!editor.isDestroyed) editor.commands.focus();
      }}
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold" aria-live="polite">
          {t("editor.tableSize.heading", { columns, rows })}
        </p>
        <fieldset
          ref={grid}
          aria-label={t("editor.tableSize.grid")}
          className="grid gap-1"
          style={{ gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))` }}
          onKeyDown={moveFocus}
        >
          {Array.from({ length: GRID_ROWS }, (_, row) =>
            Array.from({ length: GRID_COLUMNS }, (_, column) => {
              const cellColumns = column + 1;
              const cellRows = row + 1;
              const active = cellColumns <= columns && cellRows <= rows;
              return (
                <button
                  key={`${cellColumns}x${cellRows}`}
                  type="button"
                  data-cell={`${cellColumns}x${cellRows}`}
                  tabIndex={cellColumns === columns && cellRows === rows ? 0 : -1}
                  aria-label={t("editor.tableSize.cell", { columns: cellColumns, rows: cellRows })}
                  aria-pressed={active}
                  onMouseEnter={() => {
                    setColumns(cellColumns);
                    setRows(cellRows);
                  }}
                  onFocus={() => {
                    setColumns(cellColumns);
                    setRows(cellRows);
                  }}
                  onClick={() => insert({ columns: cellColumns, rows: cellRows, header })}
                  className={`size-control-sm rounded-sm border focus-visible:focus-ring ${active ? "border-accent bg-accent" : "border-border bg-surface-sunken"}`}
                />
              );
            }),
          )}
        </fieldset>
        <form
          className="flex flex-wrap items-end gap-2"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Field label={t("editor.tableSize.columns")} {...(error ? { error } : {})}>
            <Input
              type="number"
              min={1}
              max={MAX_SIZE}
              value={String(columns)}
              onChange={(event) => {
                setColumns(Number(event.target.value));
                setError(null);
              }}
            />
          </Field>
          <Field label={t("editor.tableSize.rows")}>
            <Input
              type="number"
              min={1}
              max={MAX_SIZE}
              value={String(rows)}
              onChange={(event) => {
                setRows(Number(event.target.value));
                setError(null);
              }}
            />
          </Field>
          <Checkbox checked={header} onCheckedChange={setHeader} label={t("editor.tableSize.header")} />
          <Button type="submit" variant="primary">
            {t("editor.tableSize.insert")}
          </Button>
        </form>
        <p className="text-xs text-text-muted">{t("editor.tableSize.tip")}</p>
      </div>
    </Popover>
  );
}
