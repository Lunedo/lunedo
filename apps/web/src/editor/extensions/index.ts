import type { HocuspocusProvider } from "@hocuspocus/provider";
import { type AnyExtension, Extension, nodeInputRule } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { Dropcursor, Gapcursor, Placeholder, TrailingNode, UndoRedo } from "@tiptap/extensions";
import { type ReactNodeViewProps, ReactNodeViewRenderer } from "@tiptap/react";
import type { SuggestionOptions } from "@tiptap/suggestion";
import type { TFunction } from "i18next";
import { User } from "lucide-react";
import type { ComponentType } from "react";
import type * as Y from "yjs";
import { translateKey } from "../../i18n/translate.js";
import { ExcerptView, IncludeView } from "../includes.js";
import { ContentByLabelView, RelatedLabelsView } from "../label-blocks.js";
import { AttachmentListView, ChildPagesView } from "../listings.js";
import {
  AttachmentView,
  CalloutView,
  CodeBlockView,
  ColumnsView,
  ColumnView,
  ExpandView,
  SectionView,
  TableOfContentsView,
  UnsupportedMacroView,
} from "../nodes/block-views.js";
import { DrawioReferenceView, DrawioView, TextDiagramView } from "../nodes/diagram-views.js";
import { DrawingView } from "../nodes/drawing-view.js";
import {
  DateView,
  EmojiView,
  MentionView,
  PageLinkView,
  PlaceholderView,
  StatusView,
  TemplateFieldView,
} from "../nodes/inline-views.js";
import { MathView } from "../nodes/math-view.js";
import { DecisionView, TopicUpdateView } from "../nodes/meeting-views.js";
import { TaskItemView } from "../nodes/task-item-view.js";
import { TaskReportView } from "../nodes/task-report-view.js";
import { hiddenCaret, type PresenceUser, selectionAttributes } from "../presence.js";
import { PagePropertiesView, PagePropertyView, PropertiesReportView } from "../properties.js";
import { searchPeople } from "../references.js";
import { DecisionReportView, PageReportView } from "../reports.js";
import { RoadmapView } from "../roadmap-view.js";
import { schemaExtensions } from "../schema/extensions.js";
import { slashSuggestionItems } from "../slash-items.js";
import { TemplateButtonView } from "../template-button.js";
import { BlockFormatting } from "./block-formatting.js";
import { DocumentEdges } from "./document-edges.js";
import { FileDrop } from "./file-drop.js";
import { FindReplace } from "./find-replace.js";
import { SchemaGuard } from "./guard.js";
import { PageScope } from "./page-scope.js";
import { CleanPaste } from "./paste.js";
import { TemplatePlaceholders } from "./placeholders.js";
import { PropertyNavigation } from "./property-navigation.js";
import { PageLinkSuggestion, SlashCommand, type SuggestionItem, suggestionRender } from "./suggestions.js";
import { TaskIds } from "./task-ids.js";

const INLINE_VIEWS: Record<string, ComponentType<ReactNodeViewProps>> = {
  mention: MentionView,
  pageLink: PageLinkView,
  status: StatusView,
  date: DateView,
  emoji: EmojiView,
  inlineMath: MathView,
  placeholder: PlaceholderView,
  templateField: TemplateFieldView,
};

const BLOCK_VIEWS: Record<string, ComponentType<ReactNodeViewProps>> = {
  blockMath: MathView,
  tableOfContents: TableOfContentsView,
  callout: CalloutView,
  expand: ExpandView,
  columns: ColumnsView,
  column: ColumnView,
  codeBlock: CodeBlockView,
  section: SectionView,
  unsupportedMacro: UnsupportedMacroView,
  image: AttachmentView,
  file: AttachmentView,
  drawing: DrawingView,
  drawio: DrawioView,
  drawioReference: DrawioReferenceView,
  mermaid: TextDiagramView,
  plantuml: TextDiagramView,
  taskReport: TaskReportView,
  childPages: ChildPagesView,
  attachmentList: AttachmentListView,
  pageReport: PageReportView,
  decisionReport: DecisionReportView,
  propertiesReport: PropertiesReportView,
  contentByLabel: ContentByLabelView,
  relatedLabels: RelatedLabelsView,
  includeExcerpt: IncludeView,
  includePage: IncludeView,
  roadmap: RoadmapView,
  pageProperties: PagePropertiesView,
  pageProperty: PagePropertyView,
  excerpt: ExcerptView,
  templateButton: TemplateButtonView,
  topicUpdate: TopicUpdateView,
  decision: DecisionView,
};

export interface EditorExtensionOptions {
  t: TFunction;
  spaceId: string | null;
  collaboration?: { doc: Y.Doc; provider: HocuspocusProvider; user: PresenceUser } | null;
  onOpenFind?: () => void;
  onFocusToolbar?: () => void;
  onOpenLinkDialog?: () => void;
  onMention?: (person: { id: string; name: string }) => void;
  onFiles?: (files: File[], position: number | null) => void;
}

const MathInputRules = Extension.create({
  name: "mathInputRules",
  addInputRules() {
    const inline = this.editor.schema.nodes.inlineMath;
    const block = this.editor.schema.nodes.blockMath;
    return [
      ...(inline
        ? [
            nodeInputRule({
              find: /(?:^|\s)\$([^$\n]{1,200})\$$/,
              type: inline,
              getAttributes: (match) => ({ latex: match[1] }),
            }),
          ]
        : []),
      ...(block
        ? [nodeInputRule({ find: /^\$\$\s$/, type: block, getAttributes: () => ({ latex: "" }) })]
        : []),
    ];
  },
});

function withViews(extensions: AnyExtension[]): AnyExtension[] {
  return extensions.map((extension) => {
    const inline = INLINE_VIEWS[extension.name];
    if (inline) {
      return extension.extend({ addNodeView: () => ReactNodeViewRenderer(inline, { as: "span" }) });
    }
    if (extension.name === "taskItem") {
      return extension.extend({
        addNodeView: () =>
          ReactNodeViewRenderer(TaskItemView, { as: "li", attrs: { "data-type": "taskItem" } }),
      });
    }
    const block = BLOCK_VIEWS[extension.name];
    if (block) return extension.extend({ addNodeView: () => ReactNodeViewRenderer(block) });
    return extension;
  });
}

export function createMentionSuggestion(
  t: TFunction,
  onMention?: (person: { id: string; name: string }) => void,
): Omit<SuggestionOptions<SuggestionItem, SuggestionItem>, "editor"> {
  return {
    char: "@",
    debounce: 200,
    allow: ({ state }) => !state.selection.$from.parent.type.spec.code,
    items: async ({ query }): Promise<SuggestionItem[]> =>
      (await searchPeople(query).catch(() => [])).map((person) => ({
        id: person.id,
        label: person.name,
        ...(person.email ? { description: person.email } : {}),
        icon: User,
        run: (editor, range) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: "mention", attrs: { id: person.id } },
              { type: "text", text: " " },
            ])
            .run();
          onMention?.({ id: person.id, name: person.name });
        },
      })),
    command: ({ editor, range, props }) => props.run(editor, range),
    render: suggestionRender(() => ({
      label: t("editor.suggestions.people"),
      empty: t("editor.suggestions.empty"),
    })),
  };
}

export function createEditorExtensions(options: EditorExtensionOptions): AnyExtension[] {
  const { t } = options;
  const labels = (label: string) => () => ({
    label: translateKey(t, label),
    empty: t("editor.suggestions.empty"),
  });
  const mentionSuggestion = createMentionSuggestion(t, options.onMention);
  const base = withViews(schemaExtensions()).map((extension) =>
    extension.name === "mention"
      ? extension.configure({
          suggestion: mentionSuggestion,
        })
      : extension,
  );
  const collaboration = options.collaboration;
  return [
    ...base,
    FileDrop.configure({ onFiles: options.onFiles ?? null }),
    CleanPaste,
    TaskIds,
    PropertyNavigation,
    PageScope.configure({ spaceId: options.spaceId }),
    SchemaGuard,
    TemplatePlaceholders,
    BlockFormatting,
    MathInputRules,
    Dropcursor.configure({ color: "var(--ph-color-accent)", width: 2, class: "ph-drop-cursor" }),
    Gapcursor,
    TrailingNode,
    Placeholder.extend({ name: "emptyHint" }).configure({ placeholder: t("editor.placeholder") }),
    SlashCommand.configure({
      items: (query) => slashSuggestionItems(query, t),
      labels: labels("editor.suggestions.blocks"),
    }),
    PageLinkSuggestion.configure({
      spaceId: options.spaceId,
      labels: () => ({
        label: t("editor.suggestions.pages"),
        empty: t("editor.suggestions.empty"),
        newPage: (title) => t("editor.suggestions.newPage", { title }),
        newPageDescription: t("editor.suggestions.newPageDescription"),
      }),
    }),
    FindReplace.configure({ onOpen: options.onOpenFind ?? (() => undefined) }),
    DocumentEdges,
    Extension.create({
      name: "editorShortcuts",
      addKeyboardShortcuts() {
        return {
          "Alt-F10": () => {
            options.onFocusToolbar?.();
            return Boolean(options.onFocusToolbar);
          },
          "Mod-k": () => {
            options.onOpenLinkDialog?.();
            return Boolean(options.onOpenLinkDialog);
          },
        };
      },
    }),
    ...(collaboration
      ? [
          Collaboration.configure({ document: collaboration.doc, field: "default" }),
          CollaborationCaret.configure({
            provider: collaboration.provider,
            user: collaboration.user,
            render: hiddenCaret,
            selectionRender: selectionAttributes,
          }),
        ]
      : [UndoRedo]),
  ];
}
