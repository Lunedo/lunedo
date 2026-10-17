import { addInlineCommentMark, hasAnchor, type TextAnchor } from "./anchors.js";
import type { DocumentJson } from "./json.js";
import { createEditorKit, type Section } from "./kit.js";
import type { Heading, RenderContext } from "./module.js";
import { createDefaultRegistry } from "./modules/index.js";
import type { ValidationResult } from "./validate.js";
import type { WordBlock } from "./word.js";

export {
  ANCHOR_CONTEXT_LENGTH,
  anchorAt,
  isValidAnchor,
  locateAnchor,
  MAX_QUOTE_LENGTH,
  type TextAnchor,
} from "./anchors.js";
export {
  commentKit,
  commentModules,
  commentText,
  MAX_COMMENT_BYTES,
  validateComment,
} from "./comments.js";
export {
  documentSize,
  type ExtractedDecision,
  type ExtractedTask,
  type ExtractedTopicUpdate,
  emptyDocument,
  extractDecisions,
  extractInlineCommentThreads,
  extractMentions,
  extractPageLinks,
  extractTasks,
  extractTopicUpdates,
  normalizeDecisionIds,
  normalizeTaskIds,
} from "./extract.js";
export type {
  ImportedAttachment,
  ImportSource,
  MacroConverter,
  MacroImportContext,
  MacroNote,
  MacroReferences,
  SourceContent,
  SourceElement,
} from "./importing.js";
export type { DocumentJson, MarkJson, NodeJson, ValidMark, ValidNode } from "./json.js";
export { buildSchema, createEditorKit, type EditorKit, type Section } from "./kit.js";
export {
  editorSchemaVersion,
  type Migration,
  MigrationError,
  migrateDocument,
  migrations,
} from "./migrations.js";
export {
  type AttributeSpec,
  attrOf,
  type ChildPageSort,
  type ChildPagesRequest,
  type ContentByLabelRequest,
  type ContentLabelSort,
  childPageSorts,
  contentLabelSorts,
  type DecisionReportOrder,
  type DecisionReportRequest,
  decisionReportOrders,
  defineModule,
  type EditorModule,
  type Heading,
  type HtmlRenderer,
  type IncludedContent,
  type IncludeRequest,
  type LabeledContent,
  type LabeledContentKind,
  type ListedAttachment,
  type ListedPage,
  labeledContentKinds,
  type MarkDefinition,
  type MarkdownRenderer,
  ModuleRegistry,
  type NodeDefinition,
  optional,
  type PageLinkTarget,
  type PageReportRequest,
  type PageReportSort,
  type PropertiesReport,
  type PropertiesReportRequest,
  pageReportSorts,
  type RelatedLabel,
  type RelatedLabelsRequest,
  type RenderContext,
  type RenderLabels,
  type RenderTarget,
  type ReportedDecision,
  type ReportedPage,
  type ReportedProperties,
  type ReportedTask,
  type ResolvedPageLink,
  required,
  type TaskReportRequest,
  type Unsupported,
  type WordRenderer,
} from "./module.js";
export { MAX_DRAWING_TEXT } from "./modules/drawings.js";
export {
  excerptContent,
  includeRequest,
  MAX_EXCERPT_NAME_LENGTH,
  MAX_INCLUDE_DEPTH,
} from "./modules/includes.js";
export { createDefaultRegistry, defaultModules } from "./modules/index.js";
export {
  contentByLabelRequest,
  DEFAULT_CONTENT_BY_LABEL_LIMIT,
  MAX_CONTENT_BY_LABEL_LIMIT,
  MAX_LABEL_BLOCK_TITLE,
} from "./modules/labels.js";
export {
  childPagesRequest,
  fileExtension,
  MAX_CHILD_PAGE_DEPTH,
  MAX_FILE_TYPES,
  matchesFileTypes,
} from "./modules/listings.js";
export { MAX_LATEX_LENGTH, MAX_MACRO_DATA_BYTES } from "./modules/macros.js";
export {
  DEFAULT_PROPERTIES_REPORT_PAGE_SIZE,
  type ExtractedProperty,
  extractPageProperties,
  MAX_IMPORTED_QUERY_LENGTH,
  MAX_PROPERTIES_REPORT_COLUMNS,
  MAX_PROPERTIES_REPORT_PAGE_SIZE,
  propertiesReportRequest,
  propertySortKey,
} from "./modules/properties.js";
export {
  DEFAULT_PAGE_REPORT_LIMIT,
  decisionReportRequest,
  MAX_PAGE_REPORT_LIMIT,
  pageReportRequest,
  simpleCql,
  type TaskReportDue,
  type TaskReportStatus,
  taskReportDueWindows,
  taskReportRequest,
  taskReportStatuses,
} from "./modules/reports.js";
export type { Roadmap } from "./modules/roadmap.js";
export {
  MAX_PLACEHOLDER_LENGTH,
  MAX_TEMPLATE_BUTTON_LABEL,
  MAX_TEMPLATE_TITLE_PATTERN,
  TEMPLATE_FIELD_KEY,
  templateFieldKey,
  templateTitlePattern,
  titlePatternFields,
} from "./modules/templates.js";
export { defaultLabels, formatBytes, MAX_EXPENSIVE_RENDER_COST } from "./render.js";
export { escapeHtml, markdownUrl, slugify } from "./text.js";
export {
  InvalidDocumentError,
  limits,
  MAX_DEPTH,
  MAX_DOCUMENT_BYTES,
  MAX_NODES,
  type ValidationCode,
  type ValidationProblem,
  type ValidationResult,
} from "./validate.js";
export {
  type CalloutVariant,
  type ContentColor,
  calloutVariants,
  cleanLabel,
  codeLanguages,
  contentColors,
  isAllowedHref,
  isIsoDate,
  isTemplateId,
  MAX_FILTER_LABELS,
  MAX_FILTER_PAGES,
  MAX_FILTER_SPACES,
  MAX_HREF_LENGTH,
  MAX_LABEL_LENGTH,
  MAX_PROPERTY_KEY_LENGTH,
  MAX_PROPERTY_SET_ID_LENGTH,
  propertyKeyOf,
  type TextAlignment,
  textAlignments,
} from "./values.js";
export {
  isWordInline,
  type WordBlock,
  type WordBoxVariant,
  type WordContent,
  type WordInline,
  type WordListItem,
  type WordTableCell,
  type WordTableRow,
  type WordTextStyle,
  wordBlocks,
  wordInlines,
  wordParagraph,
  wordText,
} from "./word.js";

export const modules = createDefaultRegistry();

export const editorKit = createEditorKit(modules);

export const schema = editorKit.schema;

export function validateDocument(json: unknown): ValidationResult {
  return editorKit.validate(json);
}

export function isValidDocument(json: unknown): json is DocumentJson {
  return editorKit.isValid(json);
}

export function renderHtml(doc: unknown, context?: RenderContext): string {
  return editorKit.renderHtml(doc, context);
}

export function renderMarkdown(doc: unknown, context?: RenderContext): string {
  return editorKit.renderMarkdown(doc, context);
}

export function renderWord(doc: unknown, context?: RenderContext): WordBlock[] {
  return editorKit.renderWord(doc, context);
}

export function extractHeadings(doc: DocumentJson): Heading[] {
  return editorKit.extractHeadings(doc);
}

export function withInlineComment(
  doc: DocumentJson,
  anchor: TextAnchor,
  threadId: string,
): DocumentJson | null {
  return addInlineCommentMark(schema, doc, anchor, threadId);
}

export function containsAnchor(doc: DocumentJson, anchor: TextAnchor): boolean {
  return hasAnchor(schema, doc, anchor);
}

export function plainText(doc: DocumentJson): string {
  return editorKit.plainText(doc);
}

export function extractSections(doc: DocumentJson): Section[] {
  return editorKit.extractSections(doc);
}

export {
  type AttributeChange,
  type BlockChange,
  type BlockDiff,
  type DiffInput,
  type DocumentDiff,
  diffDocuments,
  type InlineChange,
  type InlineSegment,
  type LineChange,
  type TitleDiff,
} from "./diff.js";
export {
  type DiffLabels,
  type DiffRenderOptions,
  type DiffView,
  defaultDiffLabels,
  renderDiffHtml,
} from "./diff-render.js";
