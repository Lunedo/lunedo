import { contentColors, textAlignments } from "@lunedo/editor-schema";
import type { Editor } from "@tiptap/core";
import type { TFunction } from "i18next";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AtSign,
  Ban,
  Bold,
  Calendar,
  Code,
  Eraser,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Highlighter,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  type LucideIcon,
  Palette,
  Pilcrow,
  Plus,
  Redo2,
  Search,
  Smile,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  Underline,
  Undo2,
} from "lucide-react";
import { translateKey } from "../i18n/translate.js";
import type { EditorActions } from "./actions.js";
import { slashCommands } from "./slash-items.js";

export interface ToolbarAction {
  id: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  run(): void;
}

export interface ToolbarItem extends ToolbarAction {
  group: string;
  text?: string;
  menu?: ToolbarAction[];
  essential?: boolean;
  overflowOnly?: boolean;
}

const layout: { id: string; group: string; essential?: boolean }[] = [
  { id: "undo", group: "history", essential: true },
  { id: "redo", group: "history" },
  { id: "blockType", group: "block", essential: true },
  { id: "bold", group: "marks", essential: true },
  { id: "italic", group: "marks", essential: true },
  { id: "underline", group: "marks" },
  { id: "link", group: "link", essential: true },
  { id: "bulletList", group: "lists" },
  { id: "orderedList", group: "lists" },
  { id: "taskList", group: "lists" },
  { id: "table", group: "insert" },
  { id: "insert", group: "insert", essential: true },
  { id: "strike", group: "format" },
  { id: "code", group: "format" },
  { id: "textColor", group: "format" },
  { id: "highlight", group: "format" },
  { id: "clearFormatting", group: "format" },
  { id: "align", group: "layout" },
  { id: "outdent", group: "layout" },
  { id: "indent", group: "layout" },
  { id: "mention", group: "inline" },
  { id: "emoji", group: "inline" },
  { id: "date", group: "inline" },
  { id: "find", group: "tools" },
];

const overflowOnly = ["subscript", "superscript"];

const headingIcons: LucideIcon[] = [Heading1, Heading2, Heading3, Heading4, Heading5, Heading6];

function todayIso(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function blockTypeLabel(editor: Editor, t: TFunction): string {
  for (let level = 1; level <= 6; level += 1) {
    if (editor.isActive("heading", { level })) return translateKey(t, `editor.blocks.heading${level}`);
  }
  if (editor.isActive("codeBlock")) return t("editor.blocks.codeBlock");
  return t("editor.blocks.paragraph");
}

export function sameToolbarItems(
  left: readonly ToolbarItem[],
  right: readonly ToolbarItem[] | null,
): boolean {
  return (
    right !== null &&
    left.length === right.length &&
    left.every(
      (item, index) =>
        item.id === right[index]?.id &&
        item.active === right[index]?.active &&
        item.text === right[index]?.text &&
        item.icon === right[index]?.icon,
    )
  );
}

export function toolbarItems(editor: Editor, t: TFunction, actions: EditorActions): ToolbarItem[] {
  const chain = () => editor.chain().focus();
  const mark = (
    id: "bold" | "italic" | "underline" | "strike" | "code" | "subscript" | "superscript",
    icon: LucideIcon,
    shortcut: string,
  ): ToolbarItem => ({
    id,
    group: "marks",
    label: translateKey(t, `editor.toolbar.${id}`),
    icon,
    shortcut,
    active: editor.isActive(id),
    run: () => chain().toggleMark(id).run(),
  });
  const alignmentIcons = { left: AlignLeft, center: AlignCenter, right: AlignRight, justify: AlignJustify };
  const alignmentKeys = {
    left: "mod+shift+l",
    center: "mod+shift+e",
    right: "mod+shift+r",
    justify: "mod+shift+j",
  };
  const current = textAlignments.find((alignment) => editor.isActive({ textAlign: alignment }));
  const insertable = slashCommands.filter(
    (command) => command.group === "blocks" || command.group === "inline",
  );
  const items: ToolbarItem[] = [
    {
      id: "undo",
      group: "history",
      label: t("editor.toolbar.undo"),
      icon: Undo2,
      shortcut: "mod+z",
      run: () => chain().undo().run(),
    },
    {
      id: "redo",
      group: "history",
      label: t("editor.toolbar.redo"),
      icon: Redo2,
      shortcut: "mod+shift+z",
      run: () => chain().redo().run(),
    },
    {
      id: "blockType",
      group: "block",
      label: t("editor.toolbar.blockType"),
      icon: Pilcrow,
      text: blockTypeLabel(editor, t),
      run: () => undefined,
      menu: [
        {
          id: "paragraph",
          label: t("editor.blocks.paragraph"),
          icon: Pilcrow,
          shortcut: "mod+alt+0",
          active: editor.isActive("paragraph"),
          run: () => chain().setParagraph().run(),
        },
        ...[1, 2, 3, 4, 5, 6].map((level) => ({
          id: `heading${level}`,
          label: translateKey(t, `editor.blocks.heading${level}`),
          icon: headingIcons[level - 1] ?? Heading6,
          shortcut: `mod+alt+${level}`,
          active: editor.isActive("heading", { level }),
          run: () => chain().setNode("heading", { level }).run(),
        })),
      ],
    },
    mark("bold", Bold, "mod+b"),
    mark("italic", Italic, "mod+i"),
    mark("underline", Underline, "mod+u"),
    mark("strike", Strikethrough, "mod+shift+s"),
    mark("code", Code, "mod+e"),
    mark("subscript", Subscript, "mod+,"),
    mark("superscript", Superscript, "mod+."),
    {
      id: "textColor",
      group: "marks",
      label: t("editor.toolbar.textColor"),
      icon: Palette,
      run: () => undefined,
      menu: [
        {
          id: "color-default",
          label: t("editor.colors.default"),
          icon: Ban,
          run: () => chain().unsetMark("textColor").run(),
        },
        ...contentColors.map((color) => ({
          id: `color-${color}`,
          label: translateKey(t, `editor.colors.${color}`),
          icon: Palette,
          active: editor.isActive("textColor", { color }),
          run: () => chain().setMark("textColor", { color }).run(),
        })),
      ],
    },
    {
      id: "highlight",
      group: "marks",
      label: t("editor.toolbar.highlight"),
      icon: Highlighter,
      run: () => undefined,
      menu: [
        {
          id: "highlight-none",
          label: t("editor.colors.none"),
          icon: Ban,
          run: () => chain().unsetMark("highlight").run(),
        },
        ...contentColors.map((color) => ({
          id: `highlight-${color}`,
          label: translateKey(t, `editor.colors.${color}`),
          icon: Highlighter,
          active: editor.isActive("highlight", { color }),
          run: () => chain().setMark("highlight", { color }).run(),
        })),
      ],
    },
    {
      id: "clearFormatting",
      group: "marks",
      label: t("editor.toolbar.clearFormatting"),
      icon: Eraser,
      run: () => chain().unsetAllMarks().run(),
    },
    {
      id: "bulletList",
      group: "lists",
      label: t("editor.toolbar.bulletList"),
      icon: List,
      shortcut: "mod+shift+8",
      active: editor.isActive("bulletList"),
      run: () => chain().toggleBulletList().run(),
    },
    {
      id: "orderedList",
      group: "lists",
      label: t("editor.toolbar.orderedList"),
      icon: ListOrdered,
      shortcut: "mod+shift+7",
      active: editor.isActive("orderedList"),
      run: () => chain().toggleOrderedList().run(),
    },
    {
      id: "taskList",
      group: "lists",
      label: t("editor.toolbar.taskList"),
      icon: ListChecks,
      shortcut: "mod+shift+9",
      active: editor.isActive("taskList"),
      run: () => chain().toggleTaskList().run(),
    },
    {
      id: "align",
      group: "lists",
      label: t("editor.toolbar.align"),
      icon: alignmentIcons[current ?? "left"],
      run: () => undefined,
      menu: textAlignments.map((alignment) => ({
        id: `align-${alignment}`,
        label: translateKey(t, `editor.toolbar.align${alignment[0]?.toUpperCase()}${alignment.slice(1)}`),
        icon: alignmentIcons[alignment],
        shortcut: alignmentKeys[alignment],
        active: current === alignment,
        run: () => chain().setTextAlign(alignment).run(),
      })),
    },
    {
      id: "outdent",
      group: "lists",
      label: t("editor.toolbar.outdent"),
      icon: IndentDecrease,
      shortcut: "mod+[",
      run: () => chain().changeIndent(-1).run(),
    },
    {
      id: "indent",
      group: "lists",
      label: t("editor.toolbar.indent"),
      icon: IndentIncrease,
      shortcut: "mod+]",
      run: () => chain().changeIndent(1).run(),
    },
    {
      id: "link",
      group: "insert",
      label: t("editor.toolbar.link"),
      icon: Link,
      shortcut: "mod+k",
      active: editor.isActive("link"),
      run: () => actions.openLinkDialog(),
    },
    {
      id: "table",
      group: "insert",
      label: t("editor.toolbar.table"),
      icon: Table,
      run: () =>
        actions.openTableSize
          ? actions.openTableSize()
          : chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
    {
      id: "mention",
      group: "insert",
      label: t("editor.toolbar.mention"),
      icon: AtSign,
      shortcut: "@",
      run: () => chain().insertContent(" @").run(),
    },
    {
      id: "emoji",
      group: "insert",
      label: t("editor.toolbar.emoji"),
      icon: Smile,
      run: () => actions.openEmojiPicker(),
    },
    {
      id: "date",
      group: "insert",
      label: t("editor.toolbar.date"),
      icon: Calendar,
      run: () =>
        chain()
          .insertContent({ type: "date", attrs: { date: todayIso() } })
          .run(),
    },
    {
      id: "insert",
      group: "insert",
      label: t("editor.toolbar.insert"),
      icon: Plus,
      text: t("editor.toolbar.insert"),
      run: () => undefined,
      menu: insertable.map((command) => ({
        id: `insert-${command.id}`,
        label: translateKey(t, command.labelKey),
        icon: command.icon,
        run: () => {
          const position = editor.state.selection.from;
          command.run(editor, { from: position, to: position }, t);
        },
      })),
    },
    {
      id: "find",
      group: "tools",
      label: t("editor.toolbar.find"),
      icon: Search,
      shortcut: "mod+f",
      run: () => actions.openFind(),
    },
  ];
  const byId = new Map(items.map((item) => [item.id, item]));
  const arranged = layout.flatMap(({ id, group, essential }): ToolbarItem[] => {
    const item = byId.get(id);
    return item ? [{ ...item, group, ...(essential ? { essential } : {}) }] : [];
  });
  const pinned = overflowOnly.flatMap((id): ToolbarItem[] => {
    const item = byId.get(id);
    return item ? [{ ...item, overflowOnly: true }] : [];
  });
  return [...arranged, ...pinned];
}
