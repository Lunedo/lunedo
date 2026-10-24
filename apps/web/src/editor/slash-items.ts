import { uuidv7 } from "@lunedo/shared";
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
  FileInput,
  FilePlus,
  FileStack,
  Files,
  FileText,
  Film,
  Flag,
  FlagTriangleRight,
  FolderTree,
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
  Network,
  Paperclip,
  PenLine,
  Pilcrow,
  Presentation,
  Quote,
  Sigma,
  Smile,
  SquareFunction,
  SquareStack,
  Table,
  Table2,
  TableProperties,
  Tag,
  Tags,
  TextQuote,
  Workflow,
} from "lucide-react";
import { translateKey } from "../i18n/translate.js";
import { editorActions } from "./actions.js";
import { pageScopeOf } from "./extensions/page-scope.js";
import type { SuggestionItem } from "./extensions/suggestions.js";
import { insertAndFocus } from "./focus-inserted.js";
import { COLUMN_LAYOUTS } from "./nodes/block-views.js";
import { DIAGRAM_STARTERS, openDiagramWhenInserted } from "./nodes/diagram-views.js";
import { openDrawingWhenInserted } from "./nodes/drawing-view.js";
import { emptyProperty } from "./properties.js";

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
    run: (editor, range) => {
      const picker = editorActions(editor)?.openTableSize;
      if (picker) {
        editor.chain().focus().deleteRange(range).run();
        picker();
        return;
      }
      editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    },
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
    id: "pageReport",
    group: "blocks",
    icon: FileStack,
    labelKey: "editor.blocks.pageReport",
    descriptionKey: "editor.blocks.pageReportDescription",
    keywords: [
      "pages",
      "report",
      "recently updated",
      "content report",
      "seiten",
      "bericht",
      "zuletzt geändert",
    ],
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: "pageReport", attrs: { spaceId: pageScopeOf(editor) } })
        .run(),
  },
  {
    id: "decisionReport",
    group: "blocks",
    icon: FlagTriangleRight,
    labelKey: "editor.blocks.decisionReport",
    descriptionKey: "editor.blocks.decisionReportDescription",
    keywords: ["decisions", "report", "entscheidungen", "bericht"],
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: "decisionReport", attrs: { spaceId: pageScopeOf(editor) } })
        .run(),
  },
  {
    id: "pageProperties",
    group: "blocks",
    icon: TableProperties,
    labelKey: "editor.blocks.pageProperties",
    descriptionKey: "editor.blocks.pagePropertiesDescription",
    keywords: [
      "page properties",
      "properties",
      "details",
      "key value",
      "seiteneigenschaften",
      "eigenschaften",
    ],
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "pageProperties",
          content: [emptyProperty(), emptyProperty()],
        })
        .run(),
  },
  {
    id: "propertiesReport",
    group: "blocks",
    icon: Table2,
    labelKey: "editor.blocks.propertiesReport",
    descriptionKey: "editor.blocks.propertiesReportDescription",
    keywords: ["page properties report", "details summary", "report", "eigenschaften", "bericht"],
    run: (editor, range) => {
      const spaceId = pageScopeOf(editor);
      insertAndFocus(editor, range, {
        type: "propertiesReport",
        attrs: { spaceIds: spaceId ? [spaceId] : [] },
      });
    },
  },
  {
    id: "contentByLabel",
    group: "blocks",
    icon: Tags,
    labelKey: "editor.blocks.contentByLabel",
    descriptionKey: "editor.blocks.contentByLabelDescription",
    keywords: ["content by label", "labels", "tagged pages", "inhalte nach label", "labels"],
    run: (editor, range) => {
      const spaceId = pageScopeOf(editor);
      insertAndFocus(editor, range, {
        type: "contentByLabel",
        attrs: { spaceIds: spaceId ? [spaceId] : [] },
      });
    },
  },
  {
    id: "relatedLabels",
    group: "blocks",
    icon: Tag,
    labelKey: "editor.blocks.relatedLabels",
    descriptionKey: "editor.blocks.relatedLabelsDescription",
    keywords: ["related labels", "labels", "verwandte labels"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).insertContent({ type: "relatedLabels" }).run(),
  },
  {
    id: "excerpt",
    group: "blocks",
    icon: Quote,
    labelKey: "editor.blocks.excerpt",
    descriptionKey: "editor.blocks.excerptDescription",
    keywords: ["excerpt", "summary", "reuse", "auszug", "zusammenfassung"],
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: "excerpt", content: [{ type: "paragraph" }] })
        .run(),
  },
  {
    id: "includeExcerpt",
    group: "blocks",
    icon: TextQuote,
    labelKey: "editor.blocks.includeExcerpt",
    descriptionKey: "editor.blocks.includeExcerptDescription",
    keywords: ["excerpt include", "include", "reuse", "auszug einbinden", "einbinden"],
    run: (editor, range) => insertAndFocus(editor, range, { type: "includeExcerpt" }),
  },
  {
    id: "includePage",
    group: "blocks",
    icon: FileInput,
    labelKey: "editor.blocks.includePage",
    descriptionKey: "editor.blocks.includePageDescription",
    keywords: ["include page", "include", "reuse", "seite einbinden", "einbinden"],
    run: (editor, range) => insertAndFocus(editor, range, { type: "includePage" }),
  },
  {
    id: "templateButton",
    group: "blocks",
    icon: FilePlus,
    labelKey: "editor.blocks.templateButton",
    descriptionKey: "editor.blocks.templateButtonDescription",
    keywords: ["template", "button", "create", "vorlage", "knopf", "schaltfläche"],
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: "templateButton", attrs: { templateId: "builtin:meeting-notes" } })
        .run(),
  },
  {
    id: "childPages",
    group: "blocks",
    icon: FolderTree,
    labelKey: "editor.blocks.childPages",
    descriptionKey: "editor.blocks.childPagesDescription",
    keywords: ["children", "child pages", "subpages", "unterseiten"],
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: "childPages", attrs: { depth: 1 } })
        .run(),
  },
  {
    id: "attachmentList",
    group: "blocks",
    icon: Files,
    labelKey: "editor.blocks.attachmentList",
    descriptionKey: "editor.blocks.attachmentListDescription",
    keywords: ["attachments", "files", "anhänge", "dateien"],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).insertContent({ type: "attachmentList" }).run(),
  },
  {
    id: "decision",
    group: "blocks",
    icon: Flag,
    labelKey: "editor.blocks.decision",
    descriptionKey: "editor.blocks.decisionDescription",
    keywords: ["decision", "decided", "entscheidung", "beschluss"],
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "decision",
          attrs: { id: uuidv7(), topicId: null },
          content: [{ type: "paragraph" }],
        })
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
    id: "embed",
    group: "blocks",
    icon: Film,
    labelKey: "editor.blocks.embed",
    descriptionKey: "editor.blocks.embedDescription",
    keywords: [
      "embed",
      "video",
      "youtube",
      "vimeo",
      "loom",
      "figma",
      "miro",
      "google",
      "sharepoint",
      "stream",
      "einbetten",
      "einbettung",
    ],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).run();
      editorActions(editor)?.openEmbedDialog?.();
    },
  },
  {
    id: "whiteboard",
    group: "blocks",
    icon: Presentation,
    labelKey: "editor.blocks.whiteboard",
    descriptionKey: "editor.blocks.whiteboardDescription",
    keywords: ["whiteboard", "board", "link", "verknüpfen", "tafel"],
    run: (editor, range) => insertAndFocus(editor, range, { type: "whiteboard" }),
  },
  {
    id: "tabs",
    group: "blocks",
    icon: SquareStack,
    labelKey: "editor.blocks.tabs",
    descriptionKey: "editor.blocks.tabsDescription",
    keywords: ["tabs", "tab", "panel", "reiter", "registerkarten"],
    run: (editor, range, t) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "tabs",
          content: [1, 2].map((number) => ({
            type: "tab",
            attrs: { title: t("editor.tabs.newTab", { number }) },
            content: [{ type: "paragraph" }],
          })),
        })
        .run(),
  },
  {
    id: "drawing",
    group: "blocks",
    icon: PenLine,
    labelKey: "editor.blocks.drawing",
    descriptionKey: "editor.blocks.drawingDescription",
    keywords: ["drawing", "sketch", "excalidraw", "whiteboard", "zeichnung", "skizze", "zeichnen"],
    run: (editor, range) => {
      const id = crypto.randomUUID();
      openDrawingWhenInserted(id);
      editor.chain().focus().deleteRange(range).insertContent({ type: "drawing", attrs: { id } }).run();
    },
  },
  {
    id: "drawio",
    group: "blocks",
    icon: Network,
    labelKey: "editor.blocks.drawio",
    descriptionKey: "editor.blocks.drawioDescription",
    keywords: [
      "drawio",
      "draw.io",
      "diagram",
      "diagrams.net",
      "network",
      "flowchart",
      "uml",
      "diagramm",
      "netzwerk",
    ],
    run: (editor, range) => {
      const id = crypto.randomUUID();
      openDiagramWhenInserted(id);
      editor.chain().focus().deleteRange(range).insertContent({ type: "drawio", attrs: { id } }).run();
    },
  },
  ...(["mermaid", "plantuml"] as const).map(
    (type): SlashCommandDefinition => ({
      id: type,
      group: "blocks",
      icon: Workflow,
      labelKey: `editor.blocks.${type}`,
      descriptionKey: `editor.blocks.${type}Description`,
      keywords: [type, "diagram", "text", "uml", "sequence", "diagramm", "sequenz"],
      run: (editor, range) => {
        const id = crypto.randomUUID();
        openDiagramWhenInserted(id);
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent({ type, attrs: { id, source: DIAGRAM_STARTERS[type] } })
          .run();
      },
    }),
  ),
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
      const phrase = words.join(" ");
      const first = words[0] ?? "";
      const score = label.startsWith(phrase)
        ? 0
        : label.includes(phrase)
          ? 1
          : label.startsWith(first)
            ? 2
            : label.includes(first)
              ? 3
              : 4;
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

const UNMATCHED_WORDS_TO_CLOSE = 2;

export function slashMenuOpen(query: string, t: TFunction): boolean {
  if (/^\s/.test(query)) return false;
  if (sizedTable(query)) return true;
  const words = normalize(query).split(/\s+/).filter(Boolean);
  let matched = words.length;
  while (
    matched > 0 &&
    filterSlashCommands(slashCommands, words.slice(0, matched).join(" "), t).length === 0
  ) {
    matched -= 1;
  }
  return words.length - matched < UNMATCHED_WORDS_TO_CLOSE;
}

const RECENT_KEY = "lunedo.recentBlocks";
const RECENT_SHOWN = 3;
const SIZED_TABLE = /^(?:table|tabelle)\s*(\d{1,2})\s*[x×]\s*(\d{1,2})$/;
const MAX_TABLE_SIZE = 20;

export function recentSlashCommands(): string[] {
  try {
    const stored = JSON.parse(globalThis.localStorage?.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function rememberSlashCommand(id: string): void {
  try {
    const next = [id, ...recentSlashCommands().filter((entry) => entry !== id)].slice(0, RECENT_SHOWN);
    globalThis.localStorage?.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {}
}

export function sizedTable(query: string): { columns: number; rows: number } | null {
  const match = SIZED_TABLE.exec(normalize(query).trim());
  if (!match) return null;
  const columns = Number(match[1]);
  const rows = Number(match[2]);
  if (columns < 1 || rows < 1 || columns > MAX_TABLE_SIZE || rows > MAX_TABLE_SIZE) return null;
  return { columns, rows };
}

function suggestionOf(
  command: SlashCommandDefinition,
  t: TFunction,
  group: string,
  id = command.id,
): SuggestionItem {
  return {
    id,
    label: translateKey(t, command.labelKey),
    description: translateKey(t, command.descriptionKey),
    group,
    icon: command.icon,
    ...(command.hint ? { hint: command.hint } : {}),
    run: (editor, range) => {
      rememberSlashCommand(command.id);
      command.run(editor, range, t);
    },
  };
}

export function slashSuggestionItems(query: string, t: TFunction): SuggestionItem[] {
  const size = sizedTable(query);
  if (size) {
    return [
      {
        id: "sizedTable",
        label: t("editor.blocks.tableSized", { columns: size.columns, rows: size.rows }),
        description: translateKey(t, "editor.blocks.tableDescription"),
        group: translateKey(t, "editor.slashGroups.blocks"),
        icon: Table,
        run: (editor, range) => {
          rememberSlashCommand("table");
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertTable({ rows: size.rows, cols: size.columns, withHeaderRow: true })
            .run();
        },
      },
    ];
  }
  const recent =
    query.trim() === ""
      ? recentSlashCommands()
          .map((id) => slashCommands.find((command) => command.id === id))
          .filter((command): command is SlashCommandDefinition => command !== undefined)
          .map((command) => suggestionOf(command, t, t("editor.slashGroups.recent"), `recent:${command.id}`))
      : [];
  return [
    ...recent,
    ...filterSlashCommands(slashCommands, query, t).map((command) =>
      suggestionOf(command, t, translateKey(t, `editor.slashGroups.${command.group}`)),
    ),
  ];
}
