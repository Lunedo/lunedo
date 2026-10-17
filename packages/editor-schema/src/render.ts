import type { ValidMark, ValidNode } from "./json.js";
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
  drawing: "Drawing",
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

class RenderState {
  index = 0;
  spent = 0;

  constructor(readonly headings: readonly Heading[]) {}

  next(): string {
    const heading = this.headings[this.index];
    this.index += 1;
    return heading?.id ?? `section-${this.index}`;
  }
}

abstract class Renderer {
  readonly labels: RenderLabels;

  constructor(
    protected readonly registry: ModuleRegistry,
    readonly context: RenderContext,
    protected readonly state: RenderState,
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
    return new HtmlRendererImpl(this.registry, this.context, this.state).render(node);
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
