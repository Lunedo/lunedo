import { contentColors } from "@pagehall/editor-schema";
import { Menu, Tooltip } from "@pagehall/ui";
import type { Editor } from "@tiptap/core";
import { CellSelection } from "@tiptap/pm/tables";
import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  Bold,
  Columns3,
  Combine,
  Highlighter,
  Italic,
  Link,
  ListChecks,
  type LucideIcon,
  PaintBucket,
  PanelLeft,
  PanelTop,
  Rows3,
  Split,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { translateKey } from "../i18n/translate.js";
import { displayKey } from "../shell/keyboard.js";
import type { EditorActions } from "./actions.js";

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
  const inTable = useEditorState({ editor, selector: ({ editor: current }) => current.isActive("table") });
  if (!inTable) return null;
  const chain = () => editor.chain().focus();
  const run = (action: () => boolean) => () => {
    action();
  };
  return (
    <div
      role="toolbar"
      aria-label={t("editor.table.label")}
      className="ph-table-menu flex flex-wrap items-center gap-1 border-t border-border pt-1"
    >
      <Menu
        align="start"
        trigger={
          <button type="button" className={BUTTON} onMouseDown={(event) => event.preventDefault()}>
            <Rows3 aria-hidden="true" className="size-icon-md" />
            <span className="text-sm">{t("editor.table.rows")}</span>
          </button>
        }
        items={[
          { label: t("editor.table.addRowBefore"), onSelect: run(() => chain().addRowBefore().run()) },
          { label: t("editor.table.addRowAfter"), onSelect: run(() => chain().addRowAfter().run()) },
          {
            label: t("editor.table.deleteRow"),
            danger: true,
            onSelect: run(() => chain().deleteRow().run()),
          },
        ]}
      />
      <Menu
        align="start"
        trigger={
          <button type="button" className={BUTTON} onMouseDown={(event) => event.preventDefault()}>
            <Columns3 aria-hidden="true" className="size-icon-md" />
            <span className="text-sm">{t("editor.table.columns")}</span>
          </button>
        }
        items={[
          { label: t("editor.table.addColumnBefore"), onSelect: run(() => chain().addColumnBefore().run()) },
          { label: t("editor.table.addColumnAfter"), onSelect: run(() => chain().addColumnAfter().run()) },
          {
            label: t("editor.table.deleteColumn"),
            danger: true,
            onSelect: run(() => chain().deleteColumn().run()),
          },
        ]}
      />
      <MenuButton
        label={t("editor.table.mergeCells")}
        icon={Combine}
        onClick={run(() => chain().mergeCells().run())}
      />
      <MenuButton
        label={t("editor.table.splitCell")}
        icon={Split}
        onClick={run(() => chain().splitCell().run())}
      />
      <MenuButton
        label={t("editor.table.headerRow")}
        icon={PanelTop}
        onClick={run(() => chain().toggleHeaderRow().run())}
      />
      <MenuButton
        label={t("editor.table.headerColumn")}
        icon={PanelLeft}
        onClick={run(() => chain().toggleHeaderColumn().run())}
      />
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
            onSelect: run(() => chain().setCellAttribute("background", null).run()),
          },
          ...contentColors.map((color) => ({
            label: translateKey(t, `editor.colors.${color}`),
            onSelect: run(() => chain().setCellAttribute("background", color).run()),
          })),
        ]}
      />
      <MenuButton
        label={t("editor.table.deleteTable")}
        icon={Trash2}
        onClick={run(() => chain().deleteTable().run())}
      />
    </div>
  );
}
