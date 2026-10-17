import { z } from "zod";
import { type AttachmentAttributes, copyAttachmentAttributes } from "../copying.js";
import {
  type FileReference,
  type ImportedFile,
  type MacroConverter,
  type MacroImportContext,
  macroText,
  plainBody,
  type SourceElement,
} from "../importing.js";
import type { NodeJson, ValidNode } from "../json.js";
import {
  attrOf,
  defineModule,
  type HtmlRenderer,
  type MarkdownRenderer,
  type NodeDefinition,
  optional,
  type ReferencedDiagram,
  required,
  type WordRenderer,
} from "../module.js";
import { element, escapeHtml, fenceFor, htmlAttributes, markdownUrl } from "../text.js";
import { uuidValue } from "../values.js";
import { type WordContent, wordText } from "../word.js";
import { MAX_DRAWING_TEXT } from "./drawings.js";

export const MAX_DIAGRAM_SOURCE = 50_000;
export const textDiagramTypes = ["mermaid", "plantuml"] as const;
export type TextDiagramType = (typeof textDiagramTypes)[number];
export const diagramTypes = ["drawio", ...textDiagramTypes] as const;
export type DiagramType = (typeof diagramTypes)[number];
export const drawioSourceFormats = ["drawio", "gliffy"] as const;

const version = z.number().int().min(1).max(1_000_000).nullable();
const MERMAID_MACROS = ["mermaid", "mermaid-macro", "mermaid-diagram", "mermaid-cloud"];

function pair(node: ValidNode, id: string, number: string): string | null {
  return (attrOf<string | null>(node, id) === null) !== (attrOf<number | null>(node, number) === null)
    ? `${id} and ${number} are set together`
    : null;
}

function previewHref(node: ValidNode, renderer: HtmlRenderer | MarkdownRenderer | WordRenderer) {
  const preview = attrOf<string | null>(node, "previewId");
  if (!preview) return null;
  const resolved =
    renderer.context.attachment?.(preview, attrOf<number>(node, "previewVersion") ?? undefined) ?? null;
  return resolved ? renderer.safeHref(resolved.href) : null;
}

function sourceOf(node: ValidNode): string {
  return typeof node.attrs.source === "string" ? node.attrs.source : "";
}

function diagramHtml(type: DiagramType, node: ValidNode, renderer: HtmlRenderer, screen: boolean): string {
  const href = previewHref(node, renderer);
  const label = renderer.label(type);
  const source = sourceOf(node);
  const code = (text: string) =>
    element("pre", { class: "ph-code-block" }, element("code", { class: "hljs" }, escapeHtml(text)));
  let content: string;
  if (href) {
    content = `<img${htmlAttributes({ src: href, alt: label, loading: screen ? "lazy" : null })}>`;
    if (screen && source.length > 0) {
      content += element(
        "details",
        { class: "ph-diagram-source" },
        element("summary", {}, renderer.escape(renderer.label("diagramSource"))) + code(source),
      );
    }
  } else if (type !== "drawio" && source.length > 0) {
    content =
      element(
        "p",
        { class: "ph-diagram-hint" },
        renderer.escape(renderer.label("diagramNotRendered", { name: label })),
      ) + code(source);
  } else {
    content = element("span", { class: "ph-diagram-empty" }, renderer.escape(label));
  }
  return element(
    "figure",
    { class: "ph-diagram", "data-diagram": type, "data-diagram-id": attrOf<string>(node, "id") },
    content,
  );
}

function diagramWord(type: DiagramType, node: ValidNode, renderer: WordRenderer): WordContent[] {
  const preview = attrOf<string | null>(node, "previewId");
  const label = renderer.label(type);
  if (preview) {
    return [
      {
        type: "image",
        attachmentId: preview,
        href: previewHref(node, renderer),
        alt: label,
        width: null,
        align: "center",
      },
    ];
  }
  const source = sourceOf(node);
  if (type === "drawio" || source.length === 0) {
    return [{ type: "paragraph", content: [wordText(label, { muted: true, italic: true })] }];
  }
  return [
    {
      type: "paragraph",
      content: [
        wordText(renderer.label("diagramNotRendered", { name: label }), { muted: true, italic: true }),
      ],
    },
    { type: "code", text: source, language: null },
  ];
}

function diagramMarkdown(type: DiagramType, node: ValidNode, renderer: MarkdownRenderer): string {
  const href = previewHref(node, renderer);
  const label = renderer.escape(renderer.label(type));
  const source = sourceOf(node);
  const fence = fenceFor(source);
  const code = `${fence}${type}\n${source}\n${fence}`;
  if (href) {
    const image = `![${label}](${markdownUrl(href)})`;
    if (source.length === 0) return image;
    const summary = escapeHtml(renderer.label("diagramSource"));
    return `${image}\n\n<details>\n<summary>${summary}</summary>\n\n${code}\n\n</details>`;
  }
  if (type === "drawio" || source.length === 0) return `*${label}*`;
  return `*${renderer.escape(renderer.label("diagramNotRendered", { name: renderer.label(type) }))}*\n\n${code}`;
}

function diagramNode(
  type: DiagramType,
  attrs: NodeDefinition["attrs"],
  validate: (node: ValidNode) => string | null,
  attachments: AttachmentAttributes = [],
): NodeDefinition {
  return {
    name: type,
    spec: { group: "block", atom: true, draggable: true },
    attrs: {
      id: required(uuidValue),
      ...attrs,
      previewId: optional(uuidValue.nullable(), null),
      previewVersion: optional(version, null),
      text: optional(z.string().max(MAX_DRAWING_TEXT), ""),
    },
    copy: copyAttachmentAttributes([...attachments, ["previewId", "previewVersion"]]),
    validate: (node) => pair(node, "previewId", "previewVersion") ?? validate(node),
    html: (node, renderer) => diagramHtml(type, node, renderer, true),
    print: (node, renderer) => diagramHtml(type, node, renderer, false),
    word: (node, renderer) => diagramWord(type, node, renderer),
    markdown: (node, renderer) => diagramMarkdown(type, node, renderer),
    text: (node) => {
      const text = node.attrs.text;
      return typeof text === "string" && text.length > 0 ? text : sourceOf(node);
    },
  };
}

function textDiagram(type: TextDiagramType): NodeDefinition {
  return diagramNode(type, { source: optional(z.string().max(MAX_DIAGRAM_SOURCE), "") }, () => null);
}

function unique(names: readonly string[]): string[] {
  return [...new Set(names.filter((name) => name.length > 0))];
}

function candidates(name: string, extension: string): { sources: string[]; previews: string[] } {
  const base = name.toLowerCase().endsWith(extension) ? name.slice(0, -extension.length) : name;
  return {
    sources: unique([name, `${base}${extension}`]),
    previews: unique([`${name}.png`, `${base}.png`, `${base}${extension}.png`]),
  };
}

function firstFile(context: MacroImportContext, names: readonly string[]): ImportedFile | null {
  for (const fileName of names) {
    const found = context.file({ fileName });
    if (found) return found;
  }
  return null;
}

interface DiagramMacro {
  name: string;
  extension: string;
  pageSourceId: string | null;
}

function fileReferences(macro: DiagramMacro | null): FileReference[] {
  if (!macro) return [];
  const { sources, previews } = candidates(macro.name, macro.extension);
  return [...sources, ...previews].map((fileName) => ({ fileName }));
}

function drawioMacro(macro: SourceElement): DiagramMacro | null {
  const name = macroText(macro, "diagramName") ?? "";
  if (name.length === 0 || name.length > 255) return null;
  const page = macroText(macro, "pageId");
  const pageSourceId =
    macro.attributes["ac:name"] === "inc-drawio" && page && /^\d{1,19}$/.test(page) ? page : null;
  return { name, extension: ".drawio", pageSourceId };
}

function gliffyMacro(macro: SourceElement): DiagramMacro | null {
  const name = macroText(macro, "name") ?? "";
  return name.length === 0 || name.length > 255 ? null : { name, extension: ".gliffy", pageSourceId: null };
}

function convertDiagram(
  macro: DiagramMacro | null,
  macroName: string,
  format: (typeof drawioSourceFormats)[number],
  context: MacroImportContext,
): NodeJson[] | null {
  if (!macro) return null;
  const { sources, previews } = candidates(macro.name, macro.extension);
  const source = firstFile(context, sources);
  const preview = firstFile(context, previews);
  if (!source) context.note({ code: "diagramFileMissing", macro: macroName, name: macro.name.slice(0, 255) });
  else if (format === "gliffy") context.note({ code: "gliffyDiagram", name: macro.name.slice(0, 255) });
  return [
    {
      type: "drawio",
      attrs: {
        id: context.diagramId(macro.name, null),
        sourceFormat: source ? format : "drawio",
        sourceId: source?.attachmentId ?? null,
        sourceVersion: source?.version ?? null,
        previewId: preview?.attachmentId ?? null,
        previewVersion: preview?.version ?? null,
        text: "",
      },
    },
  ];
}

function convertReference(macro: DiagramMacro & { pageSourceId: string }, context: MacroImportContext) {
  const pageId = context.pageById(macro.pageSourceId);
  if (!pageId) context.note({ code: "diagramPageMissing", name: macro.name });
  return [
    {
      type: "drawioReference",
      attrs: {
        id: context.newId(),
        pageId,
        diagramId: pageId ? context.diagramId(macro.name, macro.pageSourceId) : null,
        name: macro.name,
      },
    },
  ];
}

function isReference(macro: DiagramMacro | null): macro is DiagramMacro & { pageSourceId: string } {
  return macro?.pageSourceId != null;
}

const drawioImporter: MacroConverter = {
  source: "confluence",
  macros: ["drawio", "inc-drawio"],
  references: (macro) => {
    const diagram = drawioMacro(macro);
    return isReference(diagram) ? { pageIds: [diagram.pageSourceId] } : { files: fileReferences(diagram) };
  },
  convert: (macro, context) => {
    const diagram = drawioMacro(macro);
    return isReference(diagram)
      ? convertReference(diagram, context)
      : convertDiagram(diagram, macro.attributes["ac:name"] ?? "drawio", "drawio", context);
  },
};

const gliffyImporter: MacroConverter = {
  source: "confluence",
  macros: ["gliffy"],
  references: (macro) => ({ files: fileReferences(gliffyMacro(macro)) }),
  convert: (macro, context) => convertDiagram(gliffyMacro(macro), "gliffy", "gliffy", context),
};

function textDiagramImporter(type: TextDiagramType, macros: readonly string[]): MacroConverter {
  return {
    source: "confluence",
    macros,
    convert: (macro, context) => {
      const source = (plainBody(macro) ?? "").replace(/\r\n?/g, "\n").trim();
      if (source.length === 0 || source.length > MAX_DIAGRAM_SOURCE) return null;
      return [{ type, attrs: { id: context.newId(), source } }];
    },
  };
}

type AnyRenderer = HtmlRenderer | MarkdownRenderer | WordRenderer;

function referenced(node: ValidNode, renderer: AnyRenderer): ReferencedDiagram | null | undefined {
  const resolve = renderer.context.diagramReference;
  if (!resolve) return undefined;
  const pageId = attrOf<string | null>(node, "pageId");
  const diagramId = attrOf<string | null>(node, "diagramId");
  return pageId && diagramId ? resolve(pageId, diagramId) : null;
}

function hiddenNote(node: ValidNode, renderer: AnyRenderer): string | null {
  if (!renderer.context.showPlaceholders) return null;
  return attrOf<string | null>(node, "pageId") === null
    ? renderer.label("diagramNotImported", { name: attrOf<string>(node, "name") })
    : renderer.label("restrictedContent");
}

function referencedPreview(diagram: ReferencedDiagram, renderer: AnyRenderer): string | null {
  if (!diagram.previewId) return null;
  const resolved =
    renderer.context.attachment?.(diagram.previewId, diagram.previewVersion ?? undefined) ?? null;
  return resolved ? renderer.safeHref(resolved.href) : null;
}

function sourceTitle(diagram: ReferencedDiagram, renderer: AnyRenderer): string {
  return diagram.title.trim() || renderer.label("untitledPage");
}

function referenceHtml(node: ValidNode, renderer: HtmlRenderer): string {
  const diagram = referenced(node, renderer);
  const attributes = {
    class: "ph-diagram ph-diagram-reference",
    "data-diagram": "drawioReference",
    "data-page-id": attrOf<string | null>(node, "pageId"),
    "data-diagram-ref": attrOf<string | null>(node, "diagramId"),
  };
  const hint = (text: string) => element("p", { class: "ph-diagram-hint" }, renderer.escape(text));
  if (diagram === undefined) {
    return element(
      "figure",
      { ...attributes, "data-name": attrOf<string>(node, "name") },
      element("span", { class: "ph-diagram-empty" }, renderer.escape(renderer.label("drawioReference"))),
    );
  }
  if (diagram === null) {
    const note = hiddenNote(node, renderer);
    return note ? element("figure", { class: "ph-diagram ph-diagram-reference" }, hint(note)) : "";
  }
  const label = renderer.label("drawio");
  const preview = referencedPreview(diagram, renderer);
  const content = !diagram.found
    ? hint(renderer.label("diagramRemoved"))
    : preview
      ? `<img${htmlAttributes({ src: preview, alt: label })}>`
      : element("span", { class: "ph-diagram-empty" }, renderer.escape(label));
  const href = renderer.safeHref(diagram.href);
  const title = renderer.escape(sourceTitle(diagram, renderer));
  const caption = renderer
    .escape(renderer.label("diagramFrom"))
    .replace("{title}", href ? element("a", { href }, title) : title);
  return element("figure", attributes, content + element("figcaption", {}, caption));
}

function referenceWord(node: ValidNode, renderer: WordRenderer): WordContent[] {
  const diagram = referenced(node, renderer);
  const note = (text: string): WordContent => ({
    type: "paragraph",
    content: [wordText(text, { muted: true, italic: true })],
  });
  if (diagram === undefined) return [note(renderer.label("drawioReference"))];
  if (diagram === null) {
    const hidden = hiddenNote(node, renderer);
    return hidden ? [note(hidden)] : [];
  }
  const label = renderer.label("drawio");
  const href = renderer.safeHref(diagram.href);
  const caption: WordContent = {
    type: "paragraph",
    content: [
      wordText(
        renderer.label("diagramFrom", { title: sourceTitle(diagram, renderer) }),
        href ? { muted: true, link: href } : { muted: true },
      ),
    ],
  };
  if (!diagram.found) return [note(renderer.label("diagramRemoved")), caption];
  if (!diagram.previewId) return [note(label), caption];
  return [
    {
      type: "image",
      attachmentId: diagram.previewId,
      href: referencedPreview(diagram, renderer),
      alt: label,
      width: null,
      align: "center",
    },
    caption,
  ];
}

function referenceMarkdown(node: ValidNode, renderer: MarkdownRenderer): string {
  const diagram = referenced(node, renderer);
  if (diagram === undefined) return `*${renderer.escape(renderer.label("drawioReference"))}*`;
  if (diagram === null) {
    const hidden = hiddenNote(node, renderer);
    return hidden ? `*${renderer.escape(hidden)}*` : "";
  }
  const href = renderer.safeHref(diagram.href);
  const title = renderer.escape(sourceTitle(diagram, renderer));
  const caption = `*${renderer
    .escape(renderer.label("diagramFrom"))
    .replace("{title}", href ? `[${title}](${markdownUrl(href)})` : title)}*`;
  if (!diagram.found) return `*${renderer.escape(renderer.label("diagramRemoved"))}*\n\n${caption}`;
  const preview = referencedPreview(diagram, renderer);
  const label = renderer.escape(renderer.label("drawio"));
  return `${preview ? `![${label}](${markdownUrl(preview)})` : `*${label}*`}\n\n${caption}`;
}

const drawioReference: NodeDefinition = {
  name: "drawioReference",
  spec: { group: "block", atom: true, draggable: true },
  attrs: {
    id: required(uuidValue),
    pageId: optional(uuidValue.nullable(), null),
    diagramId: optional(uuidValue.nullable(), null),
    name: optional(z.string().max(255), ""),
  },
  validate: (node) => pair(node, "pageId", "diagramId"),
  html: referenceHtml,
  word: referenceWord,
  markdown: referenceMarkdown,
  text: () => "",
};

export const diagramsModule = defineModule({
  name: "diagrams",
  nodes: [
    diagramNode(
      "drawio",
      {
        sourceFormat: optional(z.enum(drawioSourceFormats), "drawio"),
        sourceId: optional(uuidValue.nullable(), null),
        sourceVersion: optional(version, null),
      },
      (node) => pair(node, "sourceId", "sourceVersion"),
      [["sourceId", "sourceVersion"]],
    ),
    drawioReference,
    textDiagram("mermaid"),
    textDiagram("plantuml"),
  ],
  importers: [
    drawioImporter,
    gliffyImporter,
    textDiagramImporter("mermaid", MERMAID_MACROS),
    textDiagramImporter("plantuml", ["plantuml"]),
  ],
});
