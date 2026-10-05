import type { MarkSpec, NodeSpec } from "prosemirror-model";
import type { z } from "zod";
import type { ValidMark, ValidNode } from "./json.js";

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
}

export interface RenderLabels {
  noAccess: string;
  untitledPage: string;
  unknownPerson: string;
  unsupportedMacro: string;
  tableOfContents: string;
  file: string;
  image: string;
  callout: Record<"info" | "tip" | "note" | "warning" | "error", string>;
}

export interface RenderContext {
  mention?: (id: string) => { name: string } | null;
  pageLink?: (link: PageLinkTarget) => ResolvedPageLink | null;
  attachment?: (id: string) => { href: string } | null;
  formatDate?: (iso: string) => string;
  labels?: Partial<RenderLabels>;
}

interface BaseRenderer {
  readonly context: RenderContext;
  readonly headings: readonly Heading[];
  label(key: Exclude<keyof RenderLabels, "callout">, values?: Record<string, string>): string;
  calloutLabel(variant: string): string;
  nextHeadingId(): string;
  formatDate(iso: string): string;
  mentionName(id: string): string;
  pageLink(link: PageLinkTarget): ResolvedPageLink | null;
}

export interface HtmlRenderer extends BaseRenderer {
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
  safeHref(href: string): string | null;
}

export interface NodeDefinition {
  name: string;
  spec: Omit<NodeSpec, "attrs" | "toDOM" | "parseDOM" | "content" | "marks"> & {
    content?: string;
    marks?: string;
  };
  attrs?: Record<string, AttributeSpec>;
  validate?: (node: ValidNode) => string | null;
  html: (node: ValidNode, renderer: HtmlRenderer) => string;
  markdown: (node: ValidNode, renderer: MarkdownRenderer) => string;
  text?: (node: ValidNode) => string;
  heading?: (node: ValidNode, text: string) => { level: number; text: string };
}

export interface MarkDefinition {
  name: string;
  spec: Omit<MarkSpec, "attrs" | "toDOM" | "parseDOM">;
  attrs?: Record<string, AttributeSpec>;
  html: (mark: ValidMark, content: string, renderer: HtmlRenderer) => string;
  markdown: (mark: ValidMark, content: string, renderer: MarkdownRenderer) => string;
}

export interface EditorModule {
  name: string;
  nodes: readonly NodeDefinition[];
  marks: readonly MarkDefinition[];
}

export function defineModule(module: {
  name: string;
  nodes?: readonly NodeDefinition[];
  marks?: readonly MarkDefinition[];
}): EditorModule {
  return { name: module.name, nodes: module.nodes ?? [], marks: module.marks ?? [] };
}

export class ModuleRegistry {
  readonly #modules: EditorModule[] = [];
  readonly #nodes = new Map<string, NodeDefinition>();
  readonly #marks = new Map<string, MarkDefinition>();

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
      for (const node of module.nodes) this.#nodes.set(node.name, node);
      for (const mark of module.marks) this.#marks.set(mark.name, mark);
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
}

export function attrOf<T>(node: { attrs: Record<string, unknown> }, name: string): T {
  return node.attrs[name] as T;
}
