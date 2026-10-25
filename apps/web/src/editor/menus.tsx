import { contentColors } from "@lunedo/editor-schema";
import { Menu, Tooltip } from "@lunedo/ui";
import type { Editor } from "@tiptap/core";
import { CellSelection } from "@tiptap/pm/tables";
import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  Ban,
  BetweenHorizontalEnd,
  BetweenVerticalEnd,
  Bold,
  Combine,
  Highlighter,
  Italic,
  Link,
  ListChecks,
  type LucideIcon,
  MessageSquarePlus,
  PaintBucket,
  PanelTop,
  TableColumnsSplit,
  TableRowsSplit,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { translateKey } from "../i18n/translate.js";
import { displayKey } from "../shell/keyboard.js";
import type { EditorActions } from "./actions.js";
import { activeTable } from "./table-commands.js";

const BUTTON =
  "inline-flex h-control-sm min-w-control-sm items-center justify-center gap-1 rounded-sm px-1 text-text hover:bg-hover aria-pressed:bg-selected aria-pressed:text-selected-text";

function MenuButton({
  label,
  shortcut,
  icon: Icon,
  active,
  onClick,
  text,
}: {
  label: string;
  shortcut?: string;
  icon: LucideIcon;
  active?: boolean;
  onClick: () => void;
  text?: string;
}) {
  return (
    <Tooltip content={shortcut ? `${label} (${displayKey(shortcut)})` : label}>
      <button
        type="button"
        className={BUTTON}
        aria-label={label}
        aria-pressed={active === undefined ? undefined : active}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClick}
      >
        <Icon aria-hidden="true" className="size-icon-md" />
        {text ? <span className="text-sm">{text}</span> : null}
      </button>
    </Tooltip>
  );
}

export function SelectionMenu({ editor, actions }: { editor: Editor; actions: EditorActions }) {
  const { t } = useTranslation();
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      link: current.isActive("link"),
      highlight: current.isActive("highlight"),
      task: current.isActive("taskList"),
    }),
  });
  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: current, state: editorState }) => {
        const { selection } = editorState;
        if (selection.empty || selection instanceof CellSelection || !current.isEditable) return false;
        if (current.isActive("codeBlock")) return false;
        return editorState.doc.textBetween(selection.from, selection.to).trim().length > 0;
      }}
    >
      <div
        role="toolbar"
        aria-label={t("editor.selectionMenu.label")}
        className="flex items-center gap-1 rounded-md border border-border bg-surface p-1 shadow-popover"
      >
        <MenuButton
          label={t("editor.toolbar.bold")}
          shortcut="mod+b"
          icon={Bold}
          active={state.bold}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <MenuButton
          label={t("editor.toolbar.italic")}
          shortcut="mod+i"
          icon={Italic}
          active={state.italic}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <MenuButton
          label={t("editor.toolbar.link")}
          shortcut="mod+k"
          icon={Link}
          active={state.link}
          onClick={() => actions.openLinkDialog()}
        />
        <MenuButton
          label={t("editor.toolbar.highlight")}
          shortcut="mod+shift+h"
          icon={Highlighter}
          active={state.highlight}
          onClick={() => editor.chain().focus().toggleMark("highlight", { color: "yellow" }).run()}
        />
        {actions.comment ? (
          <MenuButton
            label={t("comments.commentOnSelection")}
            icon={MessageSquarePlus}
            onClick={() => actions.comment?.()}
          />
        ) : null}
        <MenuButton
          label={t("editor.selectionMenu.turnIntoTask")}
          shortcut="mod+shift+9"
          icon={ListChecks}
          active={state.task}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
        />
      </div>
    </BubbleMenu>
  );
}

export function TableMenu({ editor }: { editor: Editor }) {
  const { t } = useTranslation();
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const table = current.isActive("table") ? activeTable(current) : null;
      let header = false;
      if (table?.node.firstChild) {
        header = true;
        table.node.firstChild.forEach((cell) => {
          if (cell.type.spec.tableRole !== "header_cell") header = false;
        });
      }
      return { inTable: table !== null, header };
    },
  });
  if (!state.inTable) return null;
  const chain = () => editor.chain().focus();
  return (
    <div
      role="toolbar"
      aria-label={t("editor.table.label")}
      className="ld-table-menu flex flex-wrap items-center gap-1 border-t border-border pt-1"
    >
      <MenuButton
        label={t("editor.table.addRowAfter")}
        icon={BetweenHorizontalEnd}
        onClick={() => chain().addRowAfter().run()}
      />
      <MenuButton
        label={t("editor.table.deleteRow")}
        icon={TableRowsSplit}
        onClick={() => chain().deleteRow().run()}
      />
      <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
      <MenuButton
        label={t("editor.table.addColumnAfter")}
        icon={BetweenVerticalEnd}
        onClick={() => chain().addColumnAfter().run()}
      />
      <MenuButton
        label={t("editor.table.deleteColumn")}
        icon={TableColumnsSplit}
        onClick={() => chain().deleteColumn().run()}
      />
      <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
      <MenuButton
        label={t("editor.table.mergeOrSplit")}
        icon={Combine}
        onClick={() => chain().mergeOrSplit().run()}
      />
      <MenuButton
        label={t("editor.table.headerRow")}
        icon={PanelTop}
        active={state.header}
        onClick={() => chain().toggleHeaderRow().run()}
      />
      <Tooltip content={t("editor.table.background")}>
        <span className="inline-flex">
          <Menu
            align="start"
            trigger={
              <button
                type="button"
                className={BUTTON}
                aria-label={t("editor.table.background")}
                onMouseDown={(event) => event.preventDefault()}
              >
                <PaintBucket aria-hidden="true" className="size-icon-md" />
              </button>
            }
            items={[
              {
                label: t("editor.colors.none"),
                icon: Ban,
                onSelect: () => chain().setCellAttribute("background", null).run(),
              },
              ...contentColors.map((color) => ({
                label: translateKey(t, `editor.colors.${color}`),
                icon: PaintBucket,
                onSelect: () => chain().setCellAttribute("background", color).run(),
              })),
            ]}
          />
        </span>
      </Tooltip>
      <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
      <MenuButton
        label={t("editor.table.deleteTable")}
        icon={Trash2}
        onClick={() => chain().deleteTable().run()}
      />
    </div>
  );
}
