import type { Editor, Range } from "@tiptap/core";
import type { TFunction } from "i18next";
import {
  AtSign,
  Calendar,
  ChevronRight,
  ClipboardList,
  Code2,
  Columns2,
  Columns3,
  Columns4,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Info,
  List,
  ListChecks,
  ListOrdered,
  ListTree,
  type LucideIcon,
  Minus,
  Paperclip,
  Pilcrow,
  Quote,
  Sigma,
  Smile,
  SquareFunction,
  Table,
  Tag,
} from "lucide-react";
import { translateKey } from "../i18n/translate.js";
import { editorActions } from "./actions.js";
import { pageScopeOf } from "./extensions/page-scope.js";
import type { SuggestionItem } from "./extensions/suggestions.js";
import { COLUMN_LAYOUTS } from "./nodes/block-views.js";

export type SlashGroup = "text" | "lists" | "blocks" | "inline";

export interface SlashCommandDefinition {
  id: string;
  group: SlashGroup;
  icon: LucideIcon;
  labelKey: string;
  descriptionKey: string;
  keywords: string[];
  hint?: string;
  run(editor: Editor, range: Range, t: TFunction): void;
}

function todayIso(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const headingIcons = [Heading1, Heading2, Heading3, Heading4, Heading5, Heading6];

function columns(count: number) {
  const widths = COLUMN_LAYOUTS[count]?.[0] ?? [];
  return {
    type: "columns",
    content: widths.map((width) => ({ type: "column", attrs: { width }, content: [{ type: "paragraph" }] })),
  };
}

export const slashCommands: SlashCommandDefinition[] = [
  {
    id: "paragraph",
    group: "text",
    icon: Pilcrow,
    labelKey: "editor.blocks.paragraph",
    descriptionKey: "editor.blocks.paragraphDescription",
    keywords: ["text", "paragraph", "absatz"],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  ...headingIcons.map(
    (icon, index): SlashCommandDefinition => ({
      id: `heading${index + 1}`,
      group: "text",
      icon,
      labelKey: `editor.blocks.heading${index + 1}`,
      descriptionKey: "editor.blocks.headingDescription",
      keywords: ["heading", "title", "überschrift", `h${index + 1}`],
      hint: `${"#".repeat(index + 1)}`,
      run: (editor, range) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setNode("heading", { level: index + 1 })
          .run(),
    }),
  ),
  {
    id: "bulletList",
    group: "lists",
    icon: List,
    labelKey: "editor.blocks.bulletList",
    descriptionKey: "editor.blocks.bulletListDescription",
    keywords: ["bullet", "list", "liste", "aufzählung"],
    hint: "-",
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: "orderedList",
    group: "lists",
    icon: ListOrdered,
    labelKey: "editor.blocks.orderedList",
    descriptionKey: "editor.blocks.orderedListDescription",
    keywords: ["numbered", "ordered", "list", "nummeriert"],
    hint: "1.",
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: "taskList",
    group: "lists",
    icon: ListChecks,
    labelKey: "editor.blocks.taskList",
    descriptionKey: "editor.blocks.taskListDescription",
    keywords: ["task", "todo", "checkbox", "aufgabe"],
    hint: "[ ]",
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    id: "blockquote",
    group: "blocks",
    icon: Quote,
    labelKey: "editor.blocks.blockquote",
    descriptionKey: "editor.blocks.blockquoteDescription",
    keywords: ["quote", "zitat"],
    hint: ">",
    run: (editor, range) => editor.chain().focus().deleteRange(range).setBlockquote().run(),
  },
  {
    id: "codeBlock",
    group: "blocks",
    icon: Code2,
    labelKey: "editor.blocks.codeBlock",
    descriptionKey: "editor.blocks.codeBlockDescription",
    keywords: ["code", "snippet", "programm"],
    hint: "```",
    run: (editor, range) => editor.chain().focus().deleteRange(range).setCodeBlock().run(),
  },
  ...(["info", "tip", "note", "warning", "error"] as const).map(
    (variant): SlashCommandDefinition => ({
      id: `callout-${variant}`,
      group: "blocks",
      icon: Info,
      labelKey: `editor.blocks.callout.${variant}`,
      descriptionKey: "editor.blocks.calloutDescription",
      keywords: ["callout", "panel", "hinweis", variant],
      run: (editor, range) => editor.chain().focus().deleteRange(range).wrapIn("callout", { variant }).run(),
    }),
  ),
  {
    id: "expand",
    group: "blocks",
    icon: ChevronRight,
    labelKey: "editor.blocks.expand",
    descriptionKey: "editor.blocks.expandDescription",
    keywords: ["expand", "toggle", "details", "aufklappen"],
    run: (editor, range) => editor.chain().focus().deleteRange(range).wrapIn("expand").run(),
  },
  ...(
    [
      [2, Columns2],
      [3, Columns3],
      [4, Columns4],
    ] as const
  ).map(
    ([count, icon]): SlashCommandDefinition => ({
      id: `columns${count}`,
      group: "blocks",
      icon,
      labelKey: `editor.blocks.columns${count}`,
      descriptionKey: "editor.blocks.columnsDescription",
      keywords: ["columns", "layout", "spalten"],
      run: (editor, range) => editor.chain().focus().deleteRange(range).insertContent(columns(count)).run(),
    }),
  ),
  {
    id: "horizontalRule",
    group: "blocks",
    icon: Minus,
    labelKey: "editor.blocks.horizontalRule",
    descriptionKey: "editor.blocks.horizontalRuleDescription",
    keywords: ["divider", "line", "rule", "trennlinie"],
    hint: "---",
    run: (editor, range) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    id: "table",
    group: "blocks",
    icon: Table,
    labelKey: "editor.blocks.table",
    descriptionKey: "editor.blocks.tableDescription",
    keywords: ["table", "grid", "tabelle"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: "taskReport",
    group: "blocks",
    icon: ClipboardList,
    labelKey: "editor.blocks.taskReport",
    descriptionKey: "editor.blocks.taskReportDescription",
    keywords: ["tasks", "report", "aufgaben", "bericht"],
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: "taskReport", attrs: { spaceId: pageScopeOf(editor) } })
        .run(),
  },
  {
    id: "tableOfContents",
    group: "blocks",
    icon: ListTree,
    labelKey: "editor.blocks.tableOfContents",
    descriptionKey: "editor.blocks.tableOfContentsDescription",
    keywords: ["toc", "contents", "inhaltsverzeichnis"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).insertContent({ type: "tableOfContents" }).run(),
  },
  {
    id: "blockMath",
    group: "blocks",
    icon: SquareFunction,
    labelKey: "editor.blocks.blockMath",
    descriptionKey: "editor.blocks.blockMathDescription",
    keywords: ["math", "formula", "latex", "formel", "katex"],
    hint: "$$",
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: "blockMath", attrs: { latex: "" } })
        .run(),
  },
  {
    id: "inlineMath",
    group: "inline",
    icon: Sigma,
    labelKey: "editor.blocks.inlineMath",
    descriptionKey: "editor.blocks.inlineMathDescription",
    keywords: ["math", "formula", "latex", "formel", "inline"],
    hint: "$",
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: "inlineMath", attrs: { latex: "" } })
        .run(),
  },
  {
    id: "status",
    group: "inline",
    icon: Tag,
    labelKey: "editor.blocks.status",
    descriptionKey: "editor.blocks.statusDescription",
    keywords: ["status", "badge", "lozenge"],
    run: (editor, range, t) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: "status", attrs: { text: t("editor.status.default"), color: "gray" } })
        .run(),
  },
  {
    id: "date",
    group: "inline",
    icon: Calendar,
    labelKey: "editor.blocks.date",
    descriptionKey: "editor.blocks.dateDescription",
    keywords: ["date", "today", "datum", "heute"],
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: "date", attrs: { date: todayIso() } })
        .run(),
  },
  {
    id: "mention",
    group: "inline",
    icon: AtSign,
    labelKey: "editor.blocks.mention",
    descriptionKey: "editor.blocks.mentionDescription",
    keywords: ["mention", "person", "erwähnen"],
    hint: "@",
    run: (editor, range) => editor.chain().focus().deleteRange(range).insertContent("@").run(),
  },
  {
    id: "pageLink",
    group: "inline",
    icon: FileText,
    labelKey: "editor.blocks.pageLink",
    descriptionKey: "editor.blocks.pageLinkDescription",
    keywords: ["link", "page", "seite", "verknüpfen"],
    hint: "[[",
    run: (editor, range) => editor.chain().focus().deleteRange(range).insertContent("[[").run(),
  },
  {
    id: "file",
    group: "blocks",
    icon: Paperclip,
    labelKey: "editor.blocks.file",
    descriptionKey: "editor.blocks.fileDescription",
    keywords: ["file", "image", "upload", "attachment", "datei", "bild", "anhang", "hochladen"],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).run();
      editorActions(editor)?.pickFiles?.();
    },
  },
  {
    id: "emoji",
    group: "inline",
    icon: Smile,
    labelKey: "editor.blocks.emoji",
    descriptionKey: "editor.blocks.emojiDescription",
    keywords: ["emoji", "smiley", "icon"],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).run();
      editorActions(editor)?.openEmojiPicker();
    },
  },
];

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function filterSlashCommands(
  commands: readonly SlashCommandDefinition[],
  query: string,
  t: TFunction,
): SlashCommandDefinition[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...commands];
  const scored = commands
    .map((command) => {
      const label = normalize(translateKey(t, command.labelKey));
      const haystack = [
        label,
        normalize(translateKey(t, command.descriptionKey)),
        ...command.keywords.map(normalize),
      ].join(" ");
      if (!words.every((word) => haystack.includes(word))) return null;
      const score = label.startsWith(words[0] ?? "") ? 0 : label.includes(words[0] ?? "") ? 1 : 2;
      return { command, score };
    })
    .filter((entry): entry is { command: SlashCommandDefinition; score: number } => entry !== null);
  const groupOrder: SlashGroup[] = ["text", "lists", "blocks", "inline"];
  return scored
    .sort(
      (left, right) =>
        groupOrder.indexOf(left.command.group) - groupOrder.indexOf(right.command.group) ||
        left.score - right.score,
    )
    .map((entry) => entry.command);
}

export function slashSuggestionItems(query: string, t: TFunction): SuggestionItem[] {
  return filterSlashCommands(slashCommands, query, t).map((command) => ({
    id: command.id,
    label: translateKey(t, command.labelKey),
    description: translateKey(t, command.descriptionKey),
    group: translateKey(t, `editor.slashGroups.${command.group}`),
    icon: command.icon,
    ...(command.hint ? { hint: command.hint } : {}),
    run: (editor, range) => command.run(editor, range, t),
  }));
}
