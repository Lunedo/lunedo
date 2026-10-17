import {
  type MarkSpec,
  type NodeSpec,
  type AttributeSpec as ProseMirrorAttributeSpec,
  Schema,
} from "prosemirror-model";
import { type DocumentJson, type NodeJson, toValidNode, type ValidNode } from "./json.js";
import {
  type AttributeSpec,
  type Heading,
  hasDefault,
  type ModuleRegistry,
  type RenderContext,
} from "./module.js";
import {
  createRenderState,
  HtmlRendererImpl,
  MarkdownRendererImpl,
  type Prepare,
  WordRendererImpl,
} from "./render.js";
import { slugify } from "./text.js";
import { createValidator, InvalidDocumentError, type ValidationResult } from "./validate.js";
import type { WordBlock } from "./word.js";

export interface EditorKit {
  registry: ModuleRegistry;
  schema: Schema;
  validate(json: unknown): ValidationResult;
  isValid(json: unknown): boolean;
  renderHtml(doc: unknown, context?: RenderContext): string;
  renderMarkdown(doc: unknown, context?: RenderContext): string;
  renderWord(doc: unknown, context?: RenderContext): WordBlock[];
  extractHeadings(doc: DocumentJson): Heading[];
  plainText(doc: DocumentJson): string;
  extractSections(doc: DocumentJson): Section[];
  prepare: Prepare;
}

export interface Section {
  heading: Heading | null;
  text: string;
}

function proseMirrorAttributes(
  attrs: Record<string, AttributeSpec> | undefined,
): Record<string, ProseMirrorAttributeSpec> | undefined {
  if (!attrs) return undefined;
  return Object.fromEntries(
    Object.entries(attrs).map(([name, spec]) => [name, hasDefault(spec) ? { default: spec.default } : {}]),
  );
}

export function buildSchema(registry: ModuleRegistry): Schema {
  const nodes: Record<string, NodeSpec> = {};
  for (const definition of registry.nodes()) {
    const attrs = proseMirrorAttributes(definition.attrs);
    nodes[definition.name] = { ...definition.spec, ...(attrs ? { attrs } : {}) };
  }
  const marks: Record<string, MarkSpec> = {};
  for (const definition of registry.marks()) {
    const attrs = proseMirrorAttributes(definition.attrs);
    marks[definition.name] = { ...definition.spec, ...(attrs ? { attrs } : {}) };
  }
  return new Schema({ nodes, marks, topNode: "doc" });
}

export function createEditorKit(registry: ModuleRegistry): EditorKit {
  const schema = buildSchema(registry);
  const validate = createValidator(registry, schema);

  const isInline = (node: ValidNode) =>
    node.type === "text" || registry.node(node.type)?.spec.inline === true;

  const textOf = (node: ValidNode): string => {
    const definition = registry.node(node.type);
    if (definition?.text) return definition.text(node);
    const separator = node.content.some(isInline) ? "" : "\n";
    return node.content.map(textOf).join(separator);
  };

  const headingNamer = () => {
    const used = new Map<string, number>();
    return (node: ValidNode): Heading | null => {
      const heading = registry.node(node.type)?.heading?.(node, node.content.map(textOf).join("").trim());
      if (!heading) return null;
      const base = slugify(heading.text);
      const count = used.get(base) ?? 0;
      used.set(base, count + 1);
      return { level: heading.level, text: heading.text, id: count === 0 ? base : `${base}-${count + 1}` };
    };
  };

  const extractHeadings = (doc: DocumentJson): Heading[] => {
    const headings: Heading[] = [];
    const name = headingNamer();
    const visit = (node: ValidNode) => {
      const heading = name(node);
      if (heading) headings.push(heading);
      for (const child of node.content) visit(child);
    };
    visit(toValidNode(doc));
    return headings;
  };

  const extractSections = (doc: DocumentJson): Section[] => {
    const sections: { heading: Heading | null; lines: string[] }[] = [{ heading: null, lines: [] }];
    const name = headingNamer();
    const add = (text: string) => {
      const line = text.trim();
      if (line.length > 0) sections[sections.length - 1]?.lines.push(line);
    };
    const visit = (node: ValidNode) => {
      const heading = name(node);
      const inline = node.content.some(isInline);
      if (heading) {
        sections.push({ heading, lines: [] });
        if (!inline) for (const child of node.content) visit(child);
        return;
      }
      if (inline || node.content.length === 0) {
        add(textOf(node));
        return;
      }
      if (registry.node(node.type)?.text) add(textOf(node));
      for (const child of node.content) visit(child);
    };
    for (const child of toValidNode(doc).content) visit(child);
    return sections
      .filter((section) => section.heading !== null || section.lines.length > 0)
      .map((section) => ({ heading: section.heading, text: section.lines.join("\n") }));
  };

  const validated = (doc: unknown): ValidNode => {
    const result = validate(doc);
    if (!result.ok) throw new InvalidDocumentError(result.problems);
    return toValidNode(result.document);
  };

  const prepare = (doc: DocumentJson) => {
    const node = validated(doc);
    return { node, headings: extractHeadings(node as DocumentJson) };
  };

  return {
    registry,
    schema,
    validate,
    isValid: (json) => validate(json).ok,
    renderHtml(doc, context = {}) {
      const node = validated(doc);
      const state = createRenderState(extractHeadings(node as DocumentJson));
      return new HtmlRendererImpl(registry, context, state, prepare).render(node);
    },
    renderMarkdown(doc, context = {}) {
      const node = validated(doc);
      const state = createRenderState(extractHeadings(node as DocumentJson));
      const markdown = new MarkdownRendererImpl(registry, context, state, prepare).render(node);
      return markdown.length > 0 ? `${markdown}\n` : "";
    },
    renderWord(doc, context = {}) {
      const node = validated(doc);
      const state = createRenderState(extractHeadings(node as DocumentJson));
      return new WordRendererImpl(registry, context, state, prepare).blocks(node);
    },
    extractHeadings,
    extractSections,
    prepare,
    plainText: (doc) => textOf(toValidNode(doc as NodeJson)).trim(),
  };
}
