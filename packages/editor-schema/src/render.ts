import type { DocumentJson, NodeJson, ValidMark, ValidNode } from "./json.js";
import type {
  Heading,
  HtmlRenderer,
  MarkDefinition,
  MarkdownRenderer,
  ModuleRegistry,
  PageLinkTarget,
  RenderContext,
  RenderLabels,
  ResolvedPageLink,
  WordRenderer,
} from "./module.js";
import { escapeHtml, escapeMarkdown } from "./text.js";
import { isAllowedHref } from "./values.js";
import {
  type WordBlock,
  type WordContent,
  type WordInline,
  type WordTextStyle,
  wordBlocks,
  wordInlines,
  wordText,
} from "./word.js";

export const defaultLabels: RenderLabels = {
  noAccess: "No access",
  inTrash: "In trash",
  taskDone: "Done",
  taskOpen: "Open",
  untitledPage: "Untitled page",
  unknownPerson: "Unknown person",
  unsupportedMacro: "Unsupported macro: {name}",
  taskReport: "Task report",
  decision: "Decision",
  unknownTopic: "Topic",
  tableOfContents: "Table of contents",
  file: "File",
  image: "Image",
  openFullSize: "Open full size",
  imageTooLarge: "This image is too large to show here.",
  drawing: "Drawing",
  drawio: "draw.io diagram",
  mermaid: "Mermaid diagram",
  plantuml: "PlantUML diagram",
  diagramSource: "Source",
  diagramNotRendered: "{name} has no image yet. Its source is shown instead.",
  drawioReference: "draw.io diagram from another page",
  diagramFrom: "From {title}",
  diagramRemoved: "The draw.io diagram was removed from its page.",
  diagramNotImported: "The draw.io diagram {name} is on a page that was not imported.",
  restrictedContent: "Restricted content",
  childPages: "Child pages",
  noChildPages: "No child pages",
  attachmentList: "Attachments",
  noAttachments: "No attachments",
  pageReport: "Page report",
  noReportedPages: "No pages match the filters",
  decisionReport: "Decision report",
  noReportedDecisions: "No decisions match the filters",
  reportTitle: "Title",
  reportAuthor: "Author",
  reportUpdated: "Last changed",
  noReportedTasks: "No tasks match the filters",
  reportTask: "Task",
  reportAssignee: "Assigned to",
  reportDue: "Due",
  reportPage: "Page",
  templateButton: "Create from template",
  unavailableHere: "{name} cannot be shown in this format. Open the page in Pagehall to see it.",
  pageProperties: "Page properties",
  propertiesReport: "Page properties report",
  noReportedProperties: "No pages with page properties match the filters",
  propertiesReportCreator: "Creator",
  propertiesReportLabels: "Labels",
  propertiesReportMore: "{shown} of {total} pages. Open the page in Pagehall to see all.",
  importedQuery:
    "Imported with a query that could not be converted: {query}. Check the labels and spaces of this block.",
  contentByLabel: "Content by label",
  noLabeledContent: "No pages match the labels",
  relatedLabels: "Related labels",
  noRelatedLabels: "No related labels",
  excerpt: "Excerpt",
  hiddenExcerpt: "Hidden excerpt",
  includedPage: "Included page",
  includedExcerpt: "Included excerpt",
  notImportedYet:
    "The included page {title} was not part of the import. It appears here once it is imported.",
  includeLoop: "This content is not shown because it would include itself.",
  includeTooDeep: "This content is not shown because included pages are nested too deeply.",
  noExcerpt: "The included page has no excerpt.",
  roadmap: "Roadmap",
  roadmapReadOnly: "Imported roadmap. Roadmaps can be edited once planning is available.",
  roadmapAsList: "Show as list",
  embed: "External embed",
  embedNotAllowed:
    "Not on the embed allowlist, shown as a link. Organization administrators manage the list.",
  embedFrom: "Embedded from {service}",
  whiteboard: "Whiteboard",
  chooseWhiteboard: "Choose a whiteboard for this block.",
  filePreview: "File preview",
  callout: { info: "Info", tip: "Tip", note: "Note", warning: "Warning", error: "Error" },
};

function markKey(mark: ValidMark): string {
  return `${mark.type}:${JSON.stringify(mark.attrs)}`;
}

const SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 || value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${SIZE_UNITS[unit]}`;
}

export const MAX_EXPENSIVE_RENDER_COST = 20_000;

export function headingNumbers(headings: readonly Heading[]): string[] {
  const open: { level: number; count: number }[] = [];
  const numbers: string[] = [];
  let top = 0;
  for (const heading of headings) {
    while (open.length > 0 && (open.at(-1) as { level: number }).level > heading.level) open.pop();
    const current = open.at(-1);
    if (current && current.level === heading.level) {
      current.count += 1;
      if (open.length === 1) top = current.count;
    } else if (open.length === 0) {
      top += 1;
      open.push({ level: heading.level, count: top });
    } else {
      open.push({ level: heading.level, count: 1 });
    }
    numbers.push(open.map((entry) => entry.count).join("."));
  }
  return numbers;
}

class RenderState {
  index = 0;
  spent = 0;
  included = 0;
  #numbers: string[] | null = null;

  constructor(
    readonly headings: readonly Heading[],
    readonly prefix = "",
  ) {}

  next(): string {
    const heading = this.headings[this.index];
    this.index += 1;
    return `${this.prefix}${heading?.id ?? `section-${this.index}`}`;
  }

  currentNumber(): string | null {
    this.#numbers ??= headingNumbers(this.headings);
    return this.#numbers[this.index - 1] ?? null;
  }
}

export interface PreparedContent {
  node: ValidNode;
  headings: readonly Heading[];
}

export type Prepare = (doc: DocumentJson) => PreparedContent;

abstract class Renderer {
  readonly labels: RenderLabels;

  constructor(
    protected readonly registry: ModuleRegistry,
    readonly context: RenderContext,
    protected readonly state: RenderState,
    protected readonly prepare: Prepare,
  ) {
    this.labels = {
      ...defaultLabels,
      ...context.labels,
      callout: { ...defaultLabels.callout, ...context.labels?.callout },
    };
  }

  get headings(): readonly Heading[] {
    return this.state.headings;
  }

  label(key: Exclude<keyof RenderLabels, "callout">, values: Record<string, string> = {}): string {
    return this.labels[key].replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
  }

  calloutLabel(variant: string): string {
    return this.labels.callout[variant as keyof RenderLabels["callout"]] ?? variant;
  }

  nextHeadingId(): string {
    return this.state.next();
  }

  headingNumber(): string | null {
    return this.context.numberHeadings ? this.state.currentNumber() : null;
  }

  spendRenderBudget(cost: number): boolean {
    if (this.state.spent + cost > MAX_EXPENSIVE_RENDER_COST) return false;
    this.state.spent += cost;
    return true;
  }

  formatDate(iso: string): string {
    return this.context.formatDate?.(iso) ?? iso;
  }

  formatSize(bytes: number): string {
    return this.context.formatSize?.(bytes) ?? formatBytes(bytes);
  }

  mentionName(id: string): string {
    return this.context.mention?.(id)?.name ?? this.label("unknownPerson");
  }

  topicTitle(id: string): string {
    return this.context.topic?.(id)?.title ?? this.label("unknownTopic");
  }

  pageLink(link: PageLinkTarget): ResolvedPageLink | null {
    return this.context.pageLink?.(link) ?? null;
  }

  unavailableHere(type: string): string {
    return this.label("unavailableHere", { name: this.context.nodeTitle?.(type) ?? type });
  }

  safeHref(href: string): string | null {
    if (!isAllowedHref(href)) return null;
    return this.context.href ? this.context.href(href) : href;
  }

  protected orderedMarks(marks: ValidMark[]): { mark: ValidMark; definition: MarkDefinition }[] {
    const order = this.registry.marks();
    return marks
      .map((mark) => ({ mark, definition: this.registry.mark(mark.type) }))
      .filter(
        (entry): entry is { mark: ValidMark; definition: MarkDefinition } => entry.definition !== undefined,
      )
      .sort((left, right) => {
        const leftCode = left.definition.spec.code ? 1 : 0;
        const rightCode = right.definition.spec.code ? 1 : 0;
        if (leftCode !== rightCode) return leftCode - rightCode;
        return order.indexOf(left.definition) - order.indexOf(right.definition);
      });
  }

  protected inlineRun(
    nodes: ValidNode[],
    applied: Set<string>,
    leaf: (node: ValidNode) => string,
    wrap: (mark: ValidMark, definition: MarkDefinition, content: string) => string,
  ): string {
    let output = "";
    let index = 0;
    while (index < nodes.length) {
      const first = nodes[index] as ValidNode;
      const next = this.orderedMarks(first.marks).find((entry) => !applied.has(markKey(entry.mark)));
      if (!next) {
        output += leaf(first);
        index += 1;
        continue;
      }
      const key = markKey(next.mark);
      let end = index + 1;
      while (end < nodes.length && (nodes[end] as ValidNode).marks.some((mark) => markKey(mark) === key))
        end += 1;
      const inner = this.inlineRun(nodes.slice(index, end), new Set([...applied, key]), leaf, wrap);
      output += wrap(next.mark, next.definition, inner);
      index = end;
    }
    return output;
  }

  protected nestedContent(content: readonly NodeJson[]): { node: ValidNode; state: RenderState } {
    const prepared = this.prepare({ type: "doc", content: [...content] });
    this.state.included += 1;
    const prefix = `${this.state.prefix}included-${this.state.included}-`;
    const state = new RenderState(prepared.headings, prefix);
    state.spent = this.state.spent;
    return { node: prepared.node, state };
  }

  protected isInline(node: ValidNode): boolean {
    const definition = this.registry.node(node.type);
    return node.type === "text" || definition?.spec.inline === true;
  }
}

export class HtmlRendererImpl extends Renderer implements HtmlRenderer {
  escape = escapeHtml;

  render(node: ValidNode): string {
    const definition = this.registry.node(node.type);
    if (!definition) return "";
    if (this.context.target === "print" && definition.print) {
      if (definition.print !== "unsupported") return definition.print(node, this);
      const text = escapeHtml(this.unavailableHere(node.type));
      return definition.spec.inline
        ? `<span class="ph-unavailable" data-node="${escapeHtml(node.type)}">${text}</span>`
        : `<div class="ph-unavailable" data-node="${escapeHtml(node.type)}"><p>${text}</p></div>`;
    }
    return definition.html(node, this);
  }

  children(node: ValidNode): string {
    if (node.content.some((child) => this.isInline(child))) {
      return this.inlineRun(
        node.content,
        new Set(),
        (child) => this.render(child),
        (mark, definition, content) => definition.html(mark, content, this),
      );
    }
    return node.content.map((child) => this.render(child)).join("");
  }

  nested(content: readonly NodeJson[], context: RenderContext): string {
    const { node, state } = this.nestedContent(content);
    const html = new HtmlRendererImpl(this.registry, context, state, this.prepare).children(node);
    this.state.spent = state.spent;
    return html;
  }
}

export class MarkdownRendererImpl extends Renderer implements MarkdownRenderer {
  escape = escapeMarkdown;

  render(node: ValidNode): string {
    const definition = this.registry.node(node.type);
    return definition ? definition.markdown(node, this) : "";
  }

  blocks(node: ValidNode): string {
    return node.content
      .map((child) => this.render(child))
      .filter((rendered) => rendered.length > 0)
      .join("\n\n");
  }

  inline(node: ValidNode): string {
    return this.inlineRun(
      node.content,
      new Set(),
      (child) => {
        if (child.type === "text" && child.marks.some((mark) => this.registry.mark(mark.type)?.spec.code)) {
          return child.text ?? "";
        }
        return this.render(child);
      },
      (mark, definition, content) => definition.markdown(mark, content, this),
    );
  }

  html(node: ValidNode): string {
    return new HtmlRendererImpl(this.registry, this.context, this.state, this.prepare).render(node);
  }

  nested(content: readonly NodeJson[], context: RenderContext): string {
    const { node, state } = this.nestedContent(content);
    const markdown = new MarkdownRendererImpl(this.registry, context, state, this.prepare).blocks(node);
    this.state.spent = state.spent;
    return markdown;
  }
}

export class WordRendererImpl extends Renderer implements WordRenderer {
  render(node: ValidNode): WordContent[] {
    const definition = this.registry.node(node.type);
    if (!definition) return [];
    if (definition.word) return definition.word(node, this);
    const text = this.unavailableHere(node.type);
    return definition.spec.inline
      ? [wordText(text, { muted: true, italic: true })]
      : [{ type: "placeholder", text }];
  }

  blocks(node: ValidNode): WordBlock[] {
    if (node.content.some((child) => this.isInline(child))) {
      return wordBlocks(this.inline(node));
    }
    return wordBlocks(node.content.flatMap((child) => this.render(child)));
  }

  nested(content: readonly NodeJson[], context: RenderContext): WordBlock[] {
    const { node, state } = this.nestedContent(content);
    const blocks = new WordRendererImpl(this.registry, context, state, this.prepare).blocks(node);
    this.state.spent = state.spent;
    return blocks;
  }

  inline(node: ValidNode): WordInline[] {
    return node.content.flatMap((child) => {
      const style = this.orderedMarks(child.marks).reduce<WordTextStyle>(
        (current, { mark, definition }) => definition.word?.(mark, current, this) ?? current,
        {},
      );
      const items =
        child.type === "text" ? [wordText(child.text ?? "", {})] : wordInlines(this.render(child));
      return items.map((item) =>
        item.type === "text" ? { ...item, style: { ...style, ...item.style } } : item,
      );
    });
  }
}

export function createRenderState(headings: readonly Heading[]): RenderState {
  return new RenderState(headings);
}

export type { RenderState };
