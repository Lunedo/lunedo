import { Menu, type MenuItem } from "@lunedo/ui";
import type { Editor } from "@tiptap/core";
import {
  ArrowDown,
  ArrowDownAZ,
  ArrowDownZA,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  GripHorizontal,
  GripVertical,
  PanelLeft,
  Trash2,
} from "lucide-react";
import { type RefObject, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { translateKey } from "../i18n/translate.js";
import {
  type ActiveTable,
  activeTable,
  hasHeaderColumn,
  hasMergedCells,
  moveColumn,
  moveRow,
  selectColumn,
  selectRow,
  sortByColumn,
} from "./table-commands.js";

interface Placement {
  table: ActiveTable;
  top: number;
  left: number;
  rows: { top: number; height: number }[];
  columns: { left: number; width: number }[];
}

function placementOf(editor: Editor, container: HTMLElement): Placement | null {
  if (!editor.isEditable) return null;
  const table = activeTable(editor);
  if (!table) return null;
  const dom = editor.view.nodeDOM(table.pos);
  const element =
    dom instanceof HTMLElement ? (dom.matches("table") ? dom : dom.querySelector("table")) : null;
  if (!(element instanceof HTMLTableElement)) return null;
  const box = container.getBoundingClientRect();
  const bounds = element.getBoundingClientRect();
  return {
    table,
    top: bounds.top - box.top,
    left: bounds.left - box.left,
    rows: Array.from(element.rows).map((row) => {
      const rect = row.getBoundingClientRect();
      return { top: rect.top - box.top, height: rect.height };
    }),
    columns: Array.from(element.rows[0]?.cells ?? []).map((cell) => {
      const rect = cell.getBoundingClientRect();
      return { left: rect.left - box.left, width: rect.width };
    }),
  };
}

export function TableGrips({
  editor,
  container,
}: {
  editor: Editor;
  container: RefObject<HTMLElement | null>;
}) {
  const { t, i18n } = useTranslation();
  const [placement, setPlacement] = useState<Placement | null>(null);

  useEffect(() => {
    const update = () => {
      const element = container.current;
      setPlacement(element ? placementOf(editor, element) : null);
    };
    update();
    editor.on("transaction", update);
    editor.on("focus", update);
    window.addEventListener("resize", update);
    return () => {
      editor.off("transaction", update);
      editor.off("focus", update);
      window.removeEventListener("resize", update);
    };
  }, [editor, container]);

  if (!placement) return null;
  const { table } = placement;
  const chain = () => editor.chain().focus();
  const merged = hasMergedCells(table.node);
  const notWithMerged = t("editor.table.notWithMerged");
  const label = (key: string, blocked: boolean) =>
    blocked ? `${translateKey(t, key)} (${notWithMerged})` : translateKey(t, key);

  const rowMenu = (row: number): MenuItem[] => [
    {
      label: t("editor.table.insertRowAbove"),
      icon: BetweenHorizontalStart,
      onSelect: () => {
        selectRow(editor, table, row);
        chain().addRowBefore().run();
      },
    },
    {
      label: t("editor.table.insertRowBelow"),
      icon: BetweenHorizontalEnd,
      onSelect: () => {
        selectRow(editor, table, row);
        chain().addRowAfter().run();
      },
    },
    { type: "separator" },
    {
      label: label("editor.table.moveRowUp", merged),
      icon: ArrowUp,
      disabled: merged || row === 0,
      onSelect: () => moveRow(editor, table, row, -1),
    },
    {
      label: label("editor.table.moveRowDown", merged),
      icon: ArrowDown,
      disabled: merged || row === table.map.height - 1,
      onSelect: () => moveRow(editor, table, row, 1),
    },
    { type: "separator" },
    {
      label: t("editor.table.deleteRow"),
      icon: Trash2,
      danger: true,
      onSelect: () => {
        selectRow(editor, table, row);
        chain().deleteRow().run();
      },
    },
  ];

  const columnMenu = (column: number): MenuItem[] => [
    {
      label: t("editor.table.insertColumnLeft"),
      icon: BetweenVerticalStart,
      onSelect: () => {
        selectColumn(editor, table, column);
        chain().addColumnBefore().run();
      },
    },
    {
      label: t("editor.table.insertColumnRight"),
      icon: BetweenVerticalEnd,
      onSelect: () => {
        selectColumn(editor, table, column);
        chain().addColumnAfter().run();
      },
    },
    { type: "separator" },
    {
      label: label("editor.table.moveColumnLeft", merged),
      icon: ArrowLeft,
      disabled: merged || column === 0,
      onSelect: () => moveColumn(editor, table, column, -1),
    },
    {
      label: label("editor.table.moveColumnRight", merged),
      icon: ArrowRight,
      disabled: merged || column === table.map.width - 1,
      onSelect: () => moveColumn(editor, table, column, 1),
    },
    {
      label: label("editor.table.sortAscending", merged),
      icon: ArrowDownAZ,
      disabled: merged,
      onSelect: () => sortByColumn(editor, table, column, "ascending", i18n.language),
    },
    {
      label: label("editor.table.sortDescending", merged),
      icon: ArrowDownZA,
      disabled: merged,
      onSelect: () => sortByColumn(editor, table, column, "descending", i18n.language),
    },
    ...(column === 0
      ? [
          { type: "separator" as const },
          {
            label: t("editor.table.headerColumn"),
            icon: PanelLeft,
            checked: hasHeaderColumn(table.node),
            onSelect: () => {
              selectColumn(editor, table, column);
              chain().toggleHeaderColumn().run();
            },
          },
        ]
      : []),
    { type: "separator" },
    {
      label: t("editor.table.deleteColumn"),
      icon: Trash2,
      danger: true,
      onSelect: () => {
        selectColumn(editor, table, column);
        chain().deleteColumn().run();
      },
    },
  ];

  return (
    <>
      {placement.rows.map((row, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity besides their position
          key={`row-${index}`}
          data-table-control=""
          className="ld-table-grip"
          data-axis="row"
          style={{ top: row.top + row.height / 2, left: placement.left }}
        >
          <Menu
            align="start"
            side="left"
            trigger={
              <button
                type="button"
                className="ld-table-grip-button"
                aria-label={t("editor.table.rowActions", { number: index + 1 })}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectRow(editor, table, index)}
              >
                <GripVertical aria-hidden="true" className="size-icon-sm" />
              </button>
            }
            items={rowMenu(index)}
          />
        </span>
      ))}
      {placement.columns.map((column, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: columns have no identity besides their position
          key={`column-${index}`}
          data-table-control=""
          className="ld-table-grip"
          data-axis="column"
          style={{ top: placement.top, left: column.left + column.width / 2 }}
        >
          <Menu
            align="center"
            trigger={
              <button
                type="button"
                className="ld-table-grip-button"
                aria-label={t("editor.table.columnActions", { number: index + 1 })}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectColumn(editor, table, index)}
              >
                <GripHorizontal aria-hidden="true" className="size-icon-sm" />
              </button>
            }
            items={columnMenu(index)}
          />
        </span>
      ))}
    </>
  );
}
