import type { MarkSpec, NodeSpec } from "prosemirror-model";
import type { z } from "zod";
import type { ImportSource, MacroConverter } from "./importing.js";
import type { DocumentJson, NodeJson, ValidMark, ValidNode } from "./json.js";
import type { ContentColor } from "./values.js";
import type { WordBlock, WordContent, WordInline, WordTextStyle } from "./word.js";

export interface AttributeSpec {
  schema: z.ZodType;
  default?: unknown;
}

export function required(schema: z.ZodType): AttributeSpec {
  return { schema };
}

export function optional(schema: z.ZodType, value: unknown): AttributeSpec {
  return { schema, default: value };
}

export function hasDefault(spec: AttributeSpec): boolean {
  return Object.hasOwn(spec, "default");
}

export interface Heading {
  level: number;
  text: string;
  id: string;
}

export interface PageLinkTarget {
  pageId: string | null;
  spaceId: string | null;
  title: string | null;
}

export interface ResolvedPageLink {
  href: string;
  title: string;
  accessible: boolean;
  inTrash?: boolean;
}

export const childPageSorts = ["tree", "title", "created", "modified"] as const;
export type ChildPageSort = (typeof childPageSorts)[number];

export interface ChildPagesRequest {
  pageId: string | null;
  depth: number | null;
  sort: ChildPageSort;
  reverse: boolean;
}

export interface ListedPage {
  title: string;
  href: string;
  children: readonly ListedPage[];
}

export interface ListedAttachment {
  id: string;
  name: string;
  size: number;
}

export const pageReportSorts = ["modified", "created", "title"] as const;
export type PageReportSort = (typeof pageReportSorts)[number];

export interface PageReportRequest {
  spaceId: string | null;
  labels: readonly string[];
  sort: PageReportSort;
  reverse: boolean;
  limit: number;
}

export interface ReportedPage {
  title: string;
  href: string;
  author: string | null;
  updatedAt: string;
}

export const decisionReportOrders = ["newest", "oldest"] as const;
export type DecisionReportOrder = (typeof decisionReportOrders)[number];

export interface DecisionReportRequest {
  spaceId: string | null;
  labels: readonly string[];
  parentId: string | null;
  order: DecisionReportOrder;
}

export interface ReportedDecision {
  text: string;
  page: { title: string; href: string };
  date: string;
}

export const taskReportDueWindows = ["any", "overdue", "next7Days", "next30Days", "none"] as const;
export type TaskReportDue = (typeof taskReportDueWindows)[number];

export const taskReportStatuses = ["open", "done", "all"] as const;
export type TaskReportStatus = (typeof taskReportStatuses)[number];

export interface TaskReportRequest {
  spaceId: string | null;
  seriesId: string | null;
  pageIds: readonly string[];
  labels: readonly string[];
  assignee: string | null;
  assignedToViewer: boolean;
  due: TaskReportDue;
  status: TaskReportStatus;
}

export interface ReportedTask {
  text: string;
  done: boolean;
  assignee: string | null;
  dueDate: string | null;
  page: { title: string; href: string };
}

export const contentLabelSorts = ["modified", "created", "title"] as const;
export type ContentLabelSort = (typeof contentLabelSorts)[number];

export const labeledContentKinds = ["page", "blogPost"] as const;
export type LabeledContentKind = (typeof labeledContentKinds)[number];

export interface PropertiesReportRequest {
  spaceIds: readonly string[];
  labels: readonly string[];
  setId: string | null;
  columns: readonly string[];
  sortBy: string | null;
  reverse: boolean;
  pageSize: number;
}

export interface ReportedProperties {
  title: string;
  href: string;
  creator: string | null;
  labels: readonly string[];
  cells: readonly (readonly NodeJson[] | null)[];
}

export interface PropertiesReport {
  columns: readonly string[];
  rows: readonly ReportedProperties[];
  total: number;
}

export interface ContentByLabelRequest {
  labels: readonly string[];
  matchAll: boolean;
  spaceIds: readonly string[];
  kinds: readonly LabeledContentKind[];
  sort: ContentLabelSort;
  reverse: boolean;
  limit: number;
  excerpts: boolean;
}

export interface LabeledContent {
  title: string;
  href: string;
  kind: LabeledContentKind;
  space: string | null;
  labels: readonly string[];
  excerpt: string | null;
}

export interface RelatedLabelsRequest {
  labels: readonly string[];
}

export interface RelatedLabel {
  label: string;
  href: string;
}

export interface IncludeRequest {
  pageId: string | null;
  sourceSpace: string | null;
  sourceTitle: string | null;
  excerpt: boolean;
  name: string | null;
}

export type IncludedContent =
  | { state: "visible"; title: string; href: string; document: DocumentJson; context: RenderContext }
  | { state: "hidden" | "loop" | "depth" | "noExcerpt" };

export interface RenderLabels {
  noAccess: string;
  inTrash: string;
  taskDone: string;
  taskOpen: string;
  untitledPage: string;
  unknownPerson: string;
  unsupportedMacro: string;
  taskReport: string;
  decision: string;
  unknownTopic: string;
  tableOfContents: string;
  file: string;
  image: string;
  drawing: string;
  drawio: string;
  mermaid: string;
  plantuml: string;
  diagramSource: string;
  diagramNotRendered: string;
  drawioReference: string;
  diagramFrom: string;
  diagramRemoved: string;
  diagramNotImported: string;
  restrictedContent: string;
  childPages: string;
  noChildPages: string;
  attachmentList: string;
  noAttachments: string;
  pageReport: string;
  noReportedPages: string;
  decisionReport: string;
  noReportedDecisions: string;
  reportTitle: string;
  reportAuthor: string;
  reportUpdated: string;
  noReportedTasks: string;
  reportTask: string;
  reportAssignee: string;
  reportDue: string;
  reportPage: string;
  templateButton: string;
  unavailableHere: string;
  pageProperties: string;
  propertiesReport: string;
  noReportedProperties: string;
  propertiesReportCreator: string;
  propertiesReportLabels: string;
  propertiesReportMore: string;
  importedQuery: string;
  contentByLabel: string;
  noLabeledContent: string;
  relatedLabels: string;
  noRelatedLabels: string;
  excerpt: string;
  hiddenExcerpt: string;
  includedPage: string;
  includedExcerpt: string;
  notImportedYet: string;
  includeLoop: string;
  includeTooDeep: string;
  noExcerpt: string;
  roadmap: string;
  roadmapReadOnly: string;
  roadmapAsList: string;
  callout: Record<"info" | "tip" | "note" | "warning" | "error", string>;
}

export type RenderTarget = "screen" | "print";

export interface ReferencedDiagram {
  readonly title: string;
  readonly href: string;
  readonly found: boolean;
  readonly previewId: string | null;
  readonly previewVersion: number | null;
}

export interface RenderContext {
  target?: RenderTarget;
  nodeTitle?: (type: string) => string | null;
  mention?: (id: string) => { name: string } | null;
  pageLink?: (link: PageLinkTarget) => ResolvedPageLink | null;
  attachment?: (id: string, version?: number) => { href: string } | null;
  diagramReference?: (pageId: string, diagramId: string) => ReferencedDiagram | null;
  formatDate?: (iso: string) => string;
  labels?: Partial<RenderLabels>;
  showPlaceholders?: boolean;
  taskStatus?: (id: string) => boolean | null;
  topic?: (id: string) => { title: string } | null;
  childPages?: (request: ChildPagesRequest) => readonly ListedPage[] | null;
  attachmentList?: () => readonly ListedAttachment[] | null;
  formatSize?: (bytes: number) => string;
  pageReport?: (request: PageReportRequest) => readonly ReportedPage[] | null;
  decisionReport?: (request: DecisionReportRequest) => readonly ReportedDecision[] | null;
  taskReport?: (request: TaskReportRequest) => readonly ReportedTask[] | null;
  propertiesReport?: (request: PropertiesReportRequest) => PropertiesReport | null;
  contentByLabel?: (request: ContentByLabelRequest) => readonly LabeledContent[] | null;
  relatedLabels?: (request: RelatedLabelsRequest) => readonly RelatedLabel[] | null;
  include?: (request: IncludeRequest) => IncludedContent | null;
  formatMonth?: (iso: string) => string;
  svgPalette?: (color: ContentColor, role: "background" | "text") => string;
  href?: (href: string) => string;
}

interface BaseRenderer {
  readonly context: RenderContext;
  readonly headings: readonly Heading[];
  label(key: Exclude<keyof RenderLabels, "callout">, values?: Record<string, string>): string;
  calloutLabel(variant: string): string;
  nextHeadingId(): string;
  formatDate(iso: string): string;
  formatSize(bytes: number): string;
  mentionName(id: string): string;
  topicTitle(id: string): string;
  pageLink(link: PageLinkTarget): ResolvedPageLink | null;
  unavailableHere(type: string): string;
}

export interface HtmlRenderer extends BaseRenderer {
  spendRenderBudget(cost: number): boolean;
  nested(content: readonly NodeJson[], context: RenderContext): string;
  children(node: ValidNode): string;
  render(node: ValidNode): string;
  escape(text: string): string;
  safeHref(href: string): string | null;
}

export interface MarkdownRenderer extends BaseRenderer {
  blocks(node: ValidNode): string;
  inline(node: ValidNode): string;
  render(node: ValidNode): string;
  escape(text: string): string;
  html(node: ValidNode): string;
  nested(content: readonly NodeJson[], context: RenderContext): string;
  safeHref(href: string): string | null;
}

export interface WordRenderer extends BaseRenderer {
  render(node: ValidNode): WordContent[];
  blocks(node: ValidNode): WordBlock[];
  inline(node: ValidNode): WordInline[];
  nested(content: readonly NodeJson[], context: RenderContext): WordBlock[];
  safeHref(href: string): string | null;
}

export type Unsupported = "unsupported";

export interface NodeDefinition {
  name: string;
  spec: Omit<NodeSpec, "attrs" | "toDOM" | "parseDOM" | "content" | "marks"> & {
    content?: string;
    marks?: string;
  };
  attrs?: Record<string, AttributeSpec>;
  validate?: (node: ValidNode) => string | null;
  html: (node: ValidNode, renderer: HtmlRenderer) => string;
  print?: ((node: ValidNode, renderer: HtmlRenderer) => string) | Unsupported;
  word?: (node: ValidNode, renderer: WordRenderer) => WordContent[];
  markdown: (node: ValidNode, renderer: MarkdownRenderer) => string;
  text?: (node: ValidNode) => string;
  heading?: (node: ValidNode, text: string) => { level: number; text: string };
}

export interface MarkDefinition {
  name: string;
  spec: Omit<MarkSpec, "attrs" | "toDOM" | "parseDOM">;
  attrs?: Record<string, AttributeSpec>;
  html: (mark: ValidMark, content: string, renderer: HtmlRenderer) => string;
  word?: (mark: ValidMark, style: WordTextStyle, renderer: WordRenderer) => WordTextStyle;
  markdown: (mark: ValidMark, content: string, renderer: MarkdownRenderer) => string;
}

export interface EditorModule {
  name: string;
  nodes: readonly NodeDefinition[];
  marks: readonly MarkDefinition[];
  importers: readonly MacroConverter[];
}

export function defineModule(module: {
  name: string;
  nodes?: readonly NodeDefinition[];
  marks?: readonly MarkDefinition[];
  importers?: readonly MacroConverter[];
}): EditorModule {
  return {
    name: module.name,
    nodes: module.nodes ?? [],
    marks: module.marks ?? [],
    importers: module.importers ?? [],
  };
}

function importerKey(source: ImportSource, macro: string): string {
  return `${source}/${macro}`;
}

export class ModuleRegistry {
  readonly #modules: EditorModule[] = [];
  readonly #nodes = new Map<string, NodeDefinition>();
  readonly #marks = new Map<string, MarkDefinition>();
  readonly #importers = new Map<string, MacroConverter>();

  register(...modules: EditorModule[]): this {
    for (const module of modules) {
      if (this.#modules.some((existing) => existing.name === module.name)) {
        throw new Error(`Module ${module.name} is registered twice`);
      }
      for (const node of module.nodes) {
        if (this.#nodes.has(node.name)) throw new Error(`Node ${node.name} is registered twice`);
      }
      for (const mark of module.marks) {
        if (this.#marks.has(mark.name)) throw new Error(`Mark ${mark.name} is registered twice`);
      }
      const keys = module.importers.flatMap((importer) =>
        importer.macros.map((macro) => importerKey(importer.source, macro)),
      );
      for (const [index, key] of keys.entries()) {
        if (this.#importers.has(key) || keys.indexOf(key) !== index) {
          throw new Error(`Macro ${key.slice(key.indexOf("/") + 1)} has two converters`);
        }
      }
      for (const node of module.nodes) this.#nodes.set(node.name, node);
      for (const mark of module.marks) this.#marks.set(mark.name, mark);
      for (const importer of module.importers) {
        for (const macro of importer.macros)
          this.#importers.set(importerKey(importer.source, macro), importer);
      }
      this.#modules.push(module);
    }
    return this;
  }

  get modules(): readonly EditorModule[] {
    return this.#modules;
  }

  nodes(): NodeDefinition[] {
    return [...this.#nodes.values()];
  }

  marks(): MarkDefinition[] {
    return [...this.#marks.values()];
  }

  node(name: string): NodeDefinition | undefined {
    return this.#nodes.get(name);
  }

  mark(name: string): MarkDefinition | undefined {
    return this.#marks.get(name);
  }

  importer(source: ImportSource, macro: string): MacroConverter | undefined {
    return this.#importers.get(importerKey(source, macro));
  }
}

export function attrOf<T>(node: { attrs: Record<string, unknown> }, name: string): T {
  return node.attrs[name] as T;
}
