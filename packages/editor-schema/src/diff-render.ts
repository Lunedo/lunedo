import { type BlockDiff, type DocumentDiff, diffKit, type InlineSegment, type LineChange } from "./diff.js";
import type { NodeJson, ValidMark, ValidNode } from "./json.js";
import { type AttributeSpec, attrOf, hasDefault, type ModuleRegistry, type RenderContext } from "./module.js";
import { createRenderState, HtmlRendererImpl, type RenderState } from "./render.js";
import { element, escapeHtml } from "./text.js";
import { InvalidDocumentError, MAX_DEPTH, type ValidationCode } from "./validate.js";

export type DiffView = "inline" | "before" | "after";

export interface DiffLabels {
  moved: string;
  attributes: string;
}

export interface DiffRenderOptions {
  labels?: Partial<DiffLabels>;
}

export const defaultDiffLabels: DiffLabels = {
  moved: "Moved",
  attributes: "Changed: {names}",
};

const MARKED_IN_PLACE = new Set(["listItem", "taskItem", "tableRow", "tableCell", "tableHeader", "column"]);
const WITHOUT_NOTES = new Set(["tableRow"]);
const BLOCK_CHANGES = new Set(["added", "removed", "changed", "moved"]);
const LINE_TAGS: Record<string, string> = { added: "ins", removed: "del" };
const LINE_CLASSES: Record<string, string> = { added: "ph-diff-added", removed: "ph-diff-removed" };
const SEGMENT_WRAPPERS: Record<string, { tag: string; className: string }> = {
  added: { tag: "ins", className: "ph-diff-added" },
  removed: { tag: "del", className: "ph-diff-removed" },
  formatted: { tag: "span", className: "ph-diff-formatted" },
};

function invalid(code: ValidationCode, message: string): InvalidDocumentError {
  return new InvalidDocumentError([{ path: "", code, message }]);
}

function checkedAttributes(
  owner: string,
  raw: Record<string, unknown> | undefined,
  specs: Record<string, AttributeSpec> | undefined,
): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(specs ?? {})) {
    const value = raw?.[name];
    if (value === undefined) {
      if (!hasDefault(spec)) throw invalid("missingAttribute", `${owner} needs the attribute ${name}`);
      attrs[name] = structuredClone(spec.default);
      continue;
    }
    const parsed = spec.schema.safeParse(value);
    if (!parsed.success) throw invalid("invalidAttribute", `${owner}.${name} has an invalid value`);
    attrs[name] = parsed.data;
  }
  return attrs;
}

function checkedNode(registry: ModuleRegistry, node: NodeJson, depth: number): ValidNode {
  if (depth > MAX_DEPTH) throw invalid("tooDeep", `Content is nested deeper than ${MAX_DEPTH} levels`);
  const definition = registry.node(node.type);
  if (!definition) throw invalid("unknownNode", `Unknown node ${String(node.type)}`);
  const marks: ValidMark[] = (node.marks ?? []).map((mark) => {
    const markDefinition = registry.mark(mark.type);
    if (!markDefinition) throw invalid("unknownMark", `Unknown mark ${String(mark.type)}`);
    return { type: mark.type, attrs: checkedAttributes(mark.type, mark.attrs, markDefinition.attrs) };
  });
  const valid: ValidNode = {
    type: node.type,
    attrs: checkedAttributes(node.type, node.attrs, definition.attrs),
    content: (node.content ?? []).map((child) => checkedNode(registry, child, depth + 1)),
    marks,
  };
  if (node.type === "text") {
    if (typeof node.text !== "string") throw invalid("invalidText", "A text node needs a text");
    valid.text = node.text;
  }
  return valid;
}

function sideOf(diff: BlockDiff, view: DiffView): NodeJson | null {
  if (view === "before") return diff.change === "added" ? null : diff.before;
  if (view === "after") return diff.change === "removed" ? null : diff.after;
  return diff.after ?? diff.before;
}

function representative(diff: BlockDiff, view: DiffView): NodeJson | null {
  const node = sideOf(diff, view);
  if (!node || diff.change !== "changed" || !diff.children) return node;
  return {
    ...node,
    content: diff.children
      .map((child) => representative(child, view))
      .filter((child): child is NodeJson => child !== null),
  };
}

function checkedChange(change: string): string {
  if (!BLOCK_CHANGES.has(change)) throw invalid("invalidNode", `Unknown change ${change}`);
  return change;
}

class DiffHtmlRenderer extends HtmlRendererImpl {
  readonly #diffs = new WeakMap<ValidNode, BlockDiff>();
  readonly #notes = new WeakMap<ValidNode, string>();

  constructor(
    registry: ModuleRegistry,
    context: RenderContext,
    state: RenderState,
    private readonly view: DiffView,
    private readonly diffLabels: DiffLabels,
  ) {
    super(registry, context, state);
  }

  block(diff: BlockDiff): string {
    const node = sideOf(diff, this.view);
    if (!node) return "";
    const valid = checkedNode(this.registry, node, 1);
    if (diff.change === "unchanged") return this.render(valid);
    const change = checkedChange(diff.change);
    const note = this.note(diff);
    const html = change === "changed" ? this.changed(diff, valid) : this.render(valid);
    if (MARKED_IN_PLACE.has(valid.type)) {
      const marked = html.replace(
        /^<([a-z][a-z0-9]*)/,
        (_match, tag: string) => `<${tag} data-change="${change}"`,
      );
      return note && !WITHOUT_NOTES.has(valid.type) && change !== "changed"
        ? marked.replace(/^<[^>]*>/, (tag) => `${tag}${note}`)
        : marked;
    }
    return element("div", { class: "ph-diff-block", "data-change": change }, `${note}${html}`);
  }

  override children(node: ValidNode): string {
    const note = this.#notes.get(node) ?? "";
    const diff = this.#diffs.get(node);
    if (diff?.inline) return `${note}${this.segments(diff.inline)}`;
    if (diff?.children) return `${note}${diff.children.map((child) => this.block(child)).join("")}`;
    return `${note}${super.children(node)}`;
  }

  private note(diff: BlockDiff): string {
    const texts: string[] = [];
    if (diff.change === "moved") texts.push(this.diffLabels.moved);
    if (diff.change === "changed" && diff.attributes.length > 0) {
      const names = diff.attributes.map((attribute) => attribute.name).join(", ");
      texts.push(this.diffLabels.attributes.replace(/\{names\}/g, names));
    }
    return texts.map((text) => element("span", { class: "ph-diff-note" }, escapeHtml(text))).join("");
  }

  private changed(diff: BlockDiff, valid: ValidNode): string {
    const note = this.note(diff);
    if (note && MARKED_IN_PLACE.has(valid.type) && !WITHOUT_NOTES.has(valid.type))
      this.#notes.set(valid, note);
    if (diff.lines) return this.codeLines(diff.lines, valid);
    this.#diffs.set(valid, diff);
    return this.render(valid);
  }

  private codeLines(lines: readonly LineChange[], valid: ValidNode): string {
    const language = attrOf<string | null>(valid, "language");
    const content = lines
      .filter((line) => !(this.view === "before" && line.change === "added"))
      .filter((line) => !(this.view === "after" && line.change === "removed"))
      .map((line) => {
        const text = escapeHtml(line.text);
        const tag = LINE_TAGS[line.change];
        return tag ? element(tag, { class: LINE_CLASSES[line.change] }, text) : text;
      })
      .join("\n");
    const code = element("code", { class: language ? `hljs language-${language}` : "hljs" }, content);
    return element("pre", { class: "ph-code-block", "data-language": language }, code);
  }

  private segments(segments: readonly InlineSegment[]): string {
    return segments
      .map((segment) => {
        const nodes = this.segmentNodes(segment);
        if (!nodes) return "";
        const html = this.inlineHtml(nodes.map((node) => checkedNode(this.registry, node, 1)));
        if (segment.change === "unchanged") return html;
        const wrapper = SEGMENT_WRAPPERS[segment.change];
        if (!wrapper) throw invalid("invalidNode", `Unknown change ${segment.change}`);
        return element(wrapper.tag, { class: wrapper.className }, html);
      })
      .join("");
  }

  private segmentNodes(segment: InlineSegment): NodeJson[] | null {
    if (this.view === "before") {
      if (segment.change === "added") return null;
      return segment.change === "formatted" ? (segment.before ?? segment.nodes) : segment.nodes;
    }
    if (this.view === "after" && segment.change === "removed") return null;
    return segment.nodes;
  }

  private inlineHtml(nodes: ValidNode[]): string {
    return this.inlineRun(
      nodes,
      new Set(),
      (node) => this.render(node),
      (mark, definition, content) => definition.html(mark, content, this),
    );
  }
}

export function renderDiffHtml(
  diff: DocumentDiff,
  view: DiffView,
  context: RenderContext = {},
  options: DiffRenderOptions = {},
): string {
  const kit = diffKit();
  const content = diff.blocks
    .map((block) => representative(block, view))
    .filter((node): node is NodeJson => node !== null);
  const headings = kit.extractHeadings({ type: "doc", content });
  const renderer = new DiffHtmlRenderer(kit.registry, context, createRenderState(headings), view, {
    ...defaultDiffLabels,
    ...options.labels,
  });
  return diff.blocks.map((block) => renderer.block(block)).join("");
}
