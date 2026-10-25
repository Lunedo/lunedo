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
  Code,
  Code2,
  Columns2,
  Columns3,
  Columns4,
  Eraser,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Info,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  type LucideIcon,
  MoreHorizontal,
  Palette,
  PanelLeft,
  PanelRight,
  Pilcrow,
  Plus,
  Quote,
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
import { type SlashCommandDefinition, slashCommands } from "./slash-items.js";

export interface ToolbarAction {
  id: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  hint?: string;
  active?: boolean;
  disabled?: boolean;
  run(): void;
}

export type ToolbarMenuEntry = ToolbarAction | { separator: true; id: string };

export interface ToolbarSection {
  label: string;
  actions: ToolbarAction[];
}

export type ToolbarTier = "base" | "movable";

export interface ToolbarItem extends ToolbarAction {
  group: string;
  tier: ToolbarTier;
  text?: string;
  menu?: ToolbarMenuEntry[];
  palette?: ToolbarSection[];
}

export function isSeparator(entry: ToolbarMenuEntry): entry is { separator: true; id: string } {
  return "separator" in entry;
}

const headingIcons: LucideIcon[] = [Heading1, Heading2, Heading3, Heading4];

const IN_OTHER_PLACES = new Set([
  "paragraph",
  "heading1",
  "heading2",
  "heading3",
  "heading4",
  "heading5",
  "heading6",
  "bulletList",
  "orderedList",
  "taskList",
  "blockquote",
  "codeBlock",
  "table",
  "columns2",
  "columns3",
  "columns4",
  "callout-info",
  "callout-tip",
  "callout-note",
  "callout-warning",
  "callout-error",
  "file",
  "mention",
  "emoji",
]);

const COLUMN_CHOICES: { id: string; widths: number[]; icon: LucideIcon }[] = [
  { id: "two", widths: [50, 50], icon: Columns2 },
  { id: "three", widths: [33, 34, 33], icon: Columns3 },
  { id: "four", widths: [25, 25, 25, 25], icon: Columns4 },
  { id: "sidebarLeft", widths: [33, 67], icon: PanelLeft },
  { id: "sidebarRight", widths: [67, 33], icon: PanelRight },
];

export function slashHint(command: SlashCommandDefinition, t: TFunction): string {
  const label = (definition: SlashCommandDefinition) => translateKey(t, definition.labelKey).toLowerCase();
  const own = label(command);
  const others = slashCommands.filter((entry) => entry.id !== command.id).map(label);
  const words = own.split(/\s+/);
  for (let count = 1; count <= words.length; count += 1) {
    const prefix = words.slice(0, count).join(" ");
    if (!others.some((other) => other.startsWith(prefix))) return `/${prefix}`;
  }
  return `/${own}`;
}

export function blockTypeLabel(editor: Editor, t: TFunction): string {
  for (let level = 1; level <= 6; level += 1) {
    if (editor.isActive("heading", { level })) return translateKey(t, `editor.blocks.heading${level}`);
  }
  if (editor.isActive("codeBlock")) return t("editor.blocks.codeBlock");
  if (editor.isActive("blockquote")) return t("editor.blocks.blockquote");
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
        item.disabled === right[index]?.disabled &&
        item.text === right[index]?.text &&
        item.icon === right[index]?.icon,
    )
  );
}

export function toolbarItems(editor: Editor, t: TFunction, actions: EditorActions): ToolbarItem[] {
  const chain = () => editor.chain().focus();
  const here = () => {
    const position = editor.state.selection.from;
    return { from: position, to: position };
  };
  const hintOf = (id: string) => {
    const command = slashCommands.find((entry) => entry.id === id);
    return command ? { hint: slashHint(command, t) } : {};
  };
  const runCommand = (id: string) => {
    const command = slashCommands.find((entry) => entry.id === id);
    command?.run(editor, here(), t);
  };
  const mark = (
    id: "bold" | "italic" | "underline" | "strike" | "code" | "subscript" | "superscript",
    icon: LucideIcon,
    shortcut: string,
  ): ToolbarAction => ({
    id,
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
  const currentAlignment = textAlignments.find((alignment) => editor.isActive({ textAlign: alignment }));
  const colorSwatch = (kind: "textColor" | "highlight", color: string | null): ToolbarAction => ({
    id: `${kind}-${color ?? "none"}`,
    label: color
      ? translateKey(t, `editor.colors.${color}`)
      : t(kind === "textColor" ? "editor.colors.default" : "editor.colors.none"),
    icon: color ? (kind === "textColor" ? Palette : Highlighter) : Ban,
    active: color ? editor.isActive(kind, { color }) : !editor.isActive(kind),
    run: () => (color ? chain().setMark(kind, { color }).run() : chain().unsetMark(kind).run()),
  });
  const insertable = slashCommands.filter(
    (command) =>
      (command.group === "blocks" || command.group === "inline") && !IN_OTHER_PLACES.has(command.id),
  );

  return [
    {
      id: "undo",
      group: "history",
      tier: "base",
      label: t("editor.toolbar.undo"),
      icon: Undo2,
      shortcut: "mod+z",
      run: () => chain().undo().run(),
    },
    {
      id: "redo",
      group: "history",
      tier: "base",
      label: t("editor.toolbar.redo"),
      icon: Redo2,
      shortcut: "mod+shift+z",
      run: () => chain().redo().run(),
    },
    {
      id: "blockType",
      group: "block",
      tier: "base",
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
        ...[1, 2, 3, 4].map((level) => ({
          id: `heading${level}`,
          label: translateKey(t, `editor.blocks.heading${level}`),
          icon: headingIcons[level - 1] ?? Heading4,
          shortcut: `mod+alt+${level}`,
          active: editor.isActive("heading", { level }),
          run: () => chain().setNode("heading", { level }).run(),
        })),
        { separator: true, id: "blockType-separator" },
        {
          id: "blockquote",
          label: t("editor.blocks.blockquote"),
          icon: Quote,
          shortcut: "mod+shift+b",
          active: editor.isActive("blockquote"),
          run: () => chain().toggleBlockquote().run(),
        },
        {
          id: "codeBlock",
          label: t("editor.blocks.codeBlock"),
          icon: Code2,
          shortcut: "mod+alt+c",
          active: editor.isActive("codeBlock"),
          run: () => chain().toggleCodeBlock().run(),
        },
      ],
    },
    { ...mark("bold", Bold, "mod+b"), group: "marks", tier: "base" },
    { ...mark("italic", Italic, "mod+i"), group: "marks", tier: "base" },
    { ...mark("underline", Underline, "mod+u"), group: "marks", tier: "base" },
    {
      id: "moreFormatting",
      group: "marks",
      tier: "base",
      label: t("editor.toolbar.moreFormatting"),
      icon: MoreHorizontal,
      active: ["strike", "code", "superscript", "subscript"].some((name) => editor.isActive(name)),
      run: () => undefined,
      menu: [
        mark("strike", Strikethrough, "mod+shift+s"),
        mark("code", Code, "mod+e"),
        mark("superscript", Superscript, "mod+."),
        mark("subscript", Subscript, "mod+,"),
        { separator: true, id: "moreFormatting-separator" },
        {
          id: "clearFormatting",
          label: t("editor.toolbar.clearFormatting"),
          icon: Eraser,
          run: () => chain().unsetAllMarks().run(),
        },
      ],
    },
    {
      id: "colors",
      group: "colors",
      tier: "movable",
      label: t("editor.toolbar.colors"),
      icon: Palette,
      shortcut: "mod+shift+h",
      active: editor.isActive("textColor") || editor.isActive("highlight"),
      run: () => undefined,
      palette: [
        {
          label: t("editor.toolbar.textColor"),
          actions: [
            colorSwatch("textColor", null),
            ...contentColors.map((color) => colorSwatch("textColor", color)),
          ],
        },
        {
          label: t("editor.toolbar.highlight"),
          actions: [
            colorSwatch("highlight", null),
            ...contentColors.map((color) => colorSwatch("highlight", color)),
          ],
        },
      ],
    },
    {
      id: "bulletList",
      group: "lists",
      tier: "base",
      label: t("editor.toolbar.bulletList"),
      icon: List,
      shortcut: "mod+shift+8",
      active: editor.isActive("bulletList"),
      run: () => chain().toggleBulletList().run(),
    },
    {
      id: "orderedList",
      group: "lists",
      tier: "base",
      label: t("editor.toolbar.orderedList"),
      icon: ListOrdered,
      shortcut: "mod+shift+7",
      active: editor.isActive("orderedList"),
      run: () => chain().toggleOrderedList().run(),
    },
    {
      id: "taskList",
      group: "lists",
      tier: "base",
      label: t("editor.toolbar.taskList"),
      icon: ListChecks,
      shortcut: "mod+shift+9",
      active: editor.isActive("taskList"),
      run: () => chain().toggleTaskList().run(),
    },
    {
      id: "outdent",
      group: "layout",
      tier: "movable",
      label: t("editor.toolbar.outdent"),
      icon: IndentDecrease,
      shortcut: "mod+[",
      run: () => chain().changeIndent(-1).run(),
    },
    {
      id: "indent",
      group: "layout",
      tier: "movable",
      label: t("editor.toolbar.indent"),
      icon: IndentIncrease,
      shortcut: "mod+]",
      run: () => chain().changeIndent(1).run(),
    },
    {
      id: "align",
      group: "layout",
      tier: "movable",
      label: t("editor.toolbar.align"),
      icon: alignmentIcons[currentAlignment ?? "left"],
      run: () => undefined,
      menu: textAlignments.map((alignment) => ({
        id: `align-${alignment}`,
        label: translateKey(t, `editor.toolbar.align${alignment[0]?.toUpperCase()}${alignment.slice(1)}`),
        icon: alignmentIcons[alignment],
        shortcut: alignmentKeys[alignment],
        active: currentAlignment === alignment,
        run: () => chain().setTextAlign(alignment).run(),
      })),
    },
    {
      id: "link",
      group: "inline",
      tier: "base",
      label: t("editor.toolbar.link"),
      icon: Link,
      shortcut: "mod+k",
      active: editor.isActive("link"),
      run: () => actions.openLinkDialog(),
    },
    ...(actions.pickFiles
      ? [
          {
            id: "file",
            group: "inline",
            tier: "base" as const,
            label: t("editor.toolbar.file"),
            icon: ImagePlus,
            run: () => actions.pickFiles?.(),
          },
        ]
      : []),
    {
      id: "mention",
      group: "inline",
      tier: "base",
      label: t("editor.toolbar.mention"),
      icon: AtSign,
      shortcut: "@",
      run: () => chain().insertContent(" @").run(),
    },
    {
      id: "emoji",
      group: "inline",
      tier: "base",
      label: t("editor.toolbar.emoji"),
      icon: Smile,
      run: () => actions.openEmojiPicker(),
    },
    {
      id: "table",
      group: "blocks",
      tier: "movable",
      label: t("editor.toolbar.table"),
      icon: Table,
      ...hintOf("table"),
      run: () => (actions.openTableSize ? actions.openTableSize() : runCommand("table")),
    },
    {
      id: "columns",
      group: "blocks",
      tier: "movable",
      label: t("editor.toolbar.columns"),
      icon: Columns2,
      run: () => undefined,
      menu: COLUMN_CHOICES.map((choice) => ({
        id: `columns-${choice.id}`,
        label: translateKey(t, `editor.toolbar.columnLayouts.${choice.id}`),
        icon: choice.icon,
        run: () =>
          chain()
            .insertContent({
              type: "columns",
              content: choice.widths.map((width) => ({
                type: "column",
                attrs: { width },
                content: [{ type: "paragraph" }],
              })),
            })
            .run(),
      })),
    },
    {
      id: "callout",
      group: "blocks",
      tier: "movable",
      label: t("editor.toolbar.callout"),
      icon: Info,
      ...hintOf("callout-info"),
      run: () => runCommand("callout-info"),
    },
    {
      id: "insert",
      group: "insert",
      tier: "base",
      label: t("editor.toolbar.insert"),
      icon: Plus,
      text: t("editor.toolbar.insert"),
      run: () => undefined,
      menu: insertable.map((command) => ({
        id: `insert-${command.id}`,
        label: translateKey(t, command.labelKey),
        icon: command.icon,
        hint: slashHint(command, t),
        run: () => command.run(editor, here(), t),
      })),
    },
    {
      id: "find",
      group: "tools",
      tier: "base",
      label: t("editor.toolbar.find"),
      icon: Search,
      shortcut: "mod+f",
      run: () => actions.openFind(),
    },
  ];
}
