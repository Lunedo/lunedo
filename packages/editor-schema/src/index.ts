import type { DocumentJson } from "./json.js";
import { createEditorKit } from "./kit.js";
import type { Heading, RenderContext } from "./module.js";
import { createDefaultRegistry } from "./modules/index.js";
import type { ValidationResult } from "./validate.js";

export { documentSize, emptyDocument, extractMentions, extractPageLinks } from "./extract.js";
export type { DocumentJson, MarkJson, NodeJson, ValidMark, ValidNode } from "./json.js";
export { buildSchema, createEditorKit, type EditorKit } from "./kit.js";
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
  defineModule,
  type EditorModule,
  type Heading,
  type HtmlRenderer,
  type MarkDefinition,
  type MarkdownRenderer,
  ModuleRegistry,
  type NodeDefinition,
  optional,
  type PageLinkTarget,
  type RenderContext,
  type RenderLabels,
  type ResolvedPageLink,
  required,
} from "./module.js";
export { createDefaultRegistry, defaultModules } from "./modules/index.js";
export { MAX_LATEX_LENGTH, MAX_MACRO_DATA_BYTES } from "./modules/macros.js";
export { MAX_PLACEHOLDER_LENGTH, TEMPLATE_FIELD_KEY } from "./modules/templates.js";
export { defaultLabels, MAX_EXPENSIVE_RENDER_COST } from "./render.js";
export { escapeHtml, slugify } from "./text.js";
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
  codeLanguages,
  contentColors,
  isAllowedHref,
  isIsoDate,
  MAX_HREF_LENGTH,
  type TextAlignment,
  textAlignments,
} from "./values.js";

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

export function extractHeadings(doc: DocumentJson): Heading[] {
  return editorKit.extractHeadings(doc);
}

export function plainText(doc: DocumentJson): string {
  return editorKit.plainText(doc);
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
