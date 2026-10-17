import { z } from "zod";
import {
  bodyBlocks,
  isTrue,
  type MacroConverter,
  type MacroImportContext,
  macroParameter,
  macroReference,
  macroText,
  type SourceElement,
  singleLine,
  sourceElements,
  sourceText,
} from "../importing.js";
import type { DocumentJson, NodeJson, ValidNode } from "../json.js";
import {
  attrOf,
  defineModule,
  type HtmlRenderer,
  type IncludedContent,
  type IncludeRequest,
  type MarkdownRenderer,
  optional,
  type WordRenderer,
} from "../module.js";
import { element, markdownUrl } from "../text.js";
import { uuidValue } from "../values.js";
import { type WordContent, wordText } from "../word.js";
import { onlyKnownParameters } from "./reports.js";

export const MAX_INCLUDE_DEPTH = 3;
export const MAX_EXCERPT_NAME_LENGTH = 100;
const MAX_SOURCE_TITLE = 255;
const MAX_SOURCE_SPACE = 255;

const excerptNameValue = z
  .string()
  .min(1)
  .max(MAX_EXCERPT_NAME_LENGTH)
  .refine((value) => value.trim() === value, "Expected a name without leading or trailing spaces");

const sourceAttrs = {
  pageId: optional(uuidValue.nullable(), null),
  sourceSpace: optional(z.string().min(1).max(MAX_SOURCE_SPACE).nullable(), null),
  sourceTitle: optional(z.string().min(1).max(MAX_SOURCE_TITLE).nullable(), null),
};

function sourceProblem(node: ValidNode): string | null {
  const pageId = attrOf<string | null>(node, "pageId");
  const title = attrOf<string | null>(node, "sourceTitle");
  const space = attrOf<string | null>(node, "sourceSpace");
  if (pageId !== null && (title !== null || space !== null)) {
    return "An include names either a page or the imported title of a page, not both";
  }
  if (space !== null && title === null) return "An imported space key needs an imported title";
  return null;
}

export function includeRequest(node: { type: string; attrs: Record<string, unknown> }): IncludeRequest {
  const excerpt = node.type === "includeExcerpt";
  return {
    pageId: attrOf<string | null>(node, "pageId"),
    sourceSpace: attrOf<string | null>(node, "sourceSpace"),
    sourceTitle: attrOf<string | null>(node, "sourceTitle"),
    excerpt,
    name: excerpt ? attrOf<string | null>(node, "name") : null,
  };
}

export function excerptContent(doc: DocumentJson, name: string | null): NodeJson[] | null {
  let found: NodeJson[] | null = null;
  const visit = (node: NodeJson) => {
    if (found) return;
    if (node.type === "excerpt") {
      const own = typeof node.attrs?.name === "string" ? node.attrs.name : null;
      if (name === null || own === name) found = node.content ?? [];
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(doc);
  return found;
}

function containsExcerpt(nodes: readonly NodeJson[]): boolean {
  return nodes.some((child) => child.type === "excerpt" || containsExcerpt(child.content ?? []));
}

type AnyRenderer = HtmlRenderer | MarkdownRenderer | WordRenderer;

function resolved(node: ValidNode, renderer: AnyRenderer): IncludedContent | null | undefined {
  if (!renderer.context.include) return undefined;
  return renderer.context.include(includeRequest(node));
}

function noteFor(node: ValidNode, result: IncludedContent | null, renderer: AnyRenderer): string | null {
  if (result === null)
    return renderer.label(node.type === "includeExcerpt" ? "includedExcerpt" : "includedPage");
  switch (result.state) {
    case "loop":
      return renderer.label("includeLoop");
    case "depth":
      return renderer.label("includeTooDeep");
    case "noExcerpt":
      return renderer.label("noExcerpt");
    case "hidden": {
      if (!renderer.context.showPlaceholders) return null;
      const title = attrOf<string | null>(node, "sourceTitle");
      return attrOf<string | null>(node, "pageId") === null && title !== null
        ? renderer.label("notImportedYet", { title })
        : renderer.label("restrictedContent");
    }
    case "visible":
      return null;
  }
}

function includeAttributes(node: ValidNode): Record<string, string | null> {
  return {
    "data-page-id": attrOf<string | null>(node, "pageId"),
    "data-source-space": attrOf<string | null>(node, "sourceSpace"),
    "data-source-title": attrOf<string | null>(node, "sourceTitle"),
    ...(node.type === "includeExcerpt"
      ? {
          "data-name": attrOf<string | null>(node, "name"),
          "data-panel": attrOf<boolean>(node, "panel") ? "true" : "false",
        }
      : {}),
  };
}

function panelled(node: ValidNode): boolean {
  return node.type === "includeExcerpt" && attrOf<boolean>(node, "panel");
}

function includeHtml(node: ValidNode, renderer: HtmlRenderer): string {
  const className = node.type === "includeExcerpt" ? "ph-include ph-include-excerpt" : "ph-include";
  const result = resolved(node, renderer);
  if (result === undefined) {
    const label = renderer.label(node.type === "includeExcerpt" ? "includedExcerpt" : "includedPage");
    return element(
      "div",
      { class: className, ...includeAttributes(node) },
      element("p", {}, renderer.escape(label)),
    );
  }
  if (result?.state === "visible") {
    const content = renderer.nested(result.document.content ?? [], result.context);
    if (!panelled(node)) {
      return element(
        "div",
        { class: className, "data-page-id": attrOf<string | null>(node, "pageId") },
        content,
      );
    }
    const href = renderer.safeHref(result.href);
    const title = renderer.escape(result.title || renderer.label("untitledPage"));
    return element(
      "section",
      { class: className, "aria-label": result.title || renderer.label("untitledPage") },
      `${element("p", { class: "ph-include-title" }, href ? element("a", { href }, title) : title)}${content}`,
    );
  }
  const note = noteFor(node, result, renderer);
  return note
    ? element("div", { class: `${className} ph-include-note` }, element("p", {}, renderer.escape(note)))
    : "";
}

function includeWord(node: ValidNode, renderer: WordRenderer): WordContent[] {
  const result = resolved(node, renderer) ?? null;
  if (result?.state === "visible") {
    const content = renderer.nested(result.document.content ?? [], result.context);
    if (!panelled(node)) return content;
    const href = renderer.safeHref(result.href);
    return [
      {
        type: "box",
        variant: "neutral",
        title: [
          wordText(
            result.title || renderer.label("untitledPage"),
            href ? { link: href, bold: true } : { bold: true },
          ),
        ],
        content,
      },
    ];
  }
  const note = noteFor(node, result, renderer);
  return note ? [{ type: "paragraph", content: [wordText(note, { muted: true, italic: true })] }] : [];
}

function includeMarkdown(node: ValidNode, renderer: MarkdownRenderer): string {
  const result = resolved(node, renderer) ?? null;
  if (result?.state === "visible") {
    const content = renderer.nested(result.document.content ?? [], result.context);
    if (!panelled(node)) return content;
    const href = renderer.safeHref(result.href);
    const title = renderer.escape(result.title || renderer.label("untitledPage"));
    return `**${href ? `[${title}](${markdownUrl(href)})` : title}**\n\n${content}`;
  }
  const note = noteFor(node, result, renderer);
  return note ? `*${renderer.escape(note)}*` : "";
}

const IMPORT_SPACE_KEY = /^[A-Za-z0-9~_-]{1,255}$/;

interface IncludeTarget {
  title: string;
  spaceKey: string | null;
  reference: SourceElement;
}

function targetOf(macro: SourceElement): IncludeTarget | null {
  const reference = macroReference(macro, "", "ri:page") ?? macroReference(macro, "page", "ri:page");
  if (reference) {
    const title = singleLine(reference.attributes["ri:content-title"] ?? "");
    if (title.length === 0) return null;
    return { title, spaceKey: reference.attributes["ri:space-key"] ?? null, reference };
  }
  const parameter = macroParameter(macro, "") ?? macroParameter(macro, "page");
  if (!parameter || sourceElements(parameter).length > 0) return null;
  const text = singleLine(sourceText(parameter)).replace(/^\[(.*)\]$/, "$1");
  const colon = text.indexOf(":");
  const spaceKey = colon > 0 && IMPORT_SPACE_KEY.test(text.slice(0, colon)) ? text.slice(0, colon) : null;
  const title = spaceKey ? text.slice(colon + 1).trim() : text;
  if (title.length === 0) return null;
  const attributes: Record<string, string> = { "ri:content-title": title };
  if (spaceKey) attributes["ri:space-key"] = spaceKey;
  return { title, spaceKey, reference: { name: "ri:page", attributes, children: [] } };
}

function includeSource(
  macro: SourceElement,
  context: MacroImportContext,
): Record<string, string | null> | null {
  const target = targetOf(macro);
  if (!target || target.title.length > MAX_SOURCE_TITLE) return null;
  const pageId = context.page(target.reference);
  if (pageId) return { pageId, sourceSpace: null, sourceTitle: null };
  const spaceKey = target.spaceKey ?? context.spaceKey;
  context.note({
    code: "unresolvedInclude",
    macro: macro.attributes["ac:name"] ?? "",
    title: target.title,
    spaceKey,
  });
  return { pageId: null, sourceSpace: spaceKey, sourceTitle: target.title };
}

function sameSpaceTitle(macro: SourceElement): string[] {
  const target = targetOf(macro);
  return target && target.spaceKey === null ? [target.title] : [];
}

const excerptImporter: MacroConverter = {
  source: "confluence",
  macros: ["excerpt"],
  convert: (macro, context) => {
    if (!onlyKnownParameters(macro, new Set(["hidden", "name", "atlassian-macro-output-type"]))) return null;
    const name = singleLine(macroText(macro, "name"));
    if (name.length > MAX_EXCERPT_NAME_LENGTH) return null;
    const content = bodyBlocks(macro, context);
    if (containsExcerpt(content)) return null;
    return [
      {
        type: "excerpt",
        attrs: { name: name.length > 0 ? name : null, hidden: isTrue(macroText(macro, "hidden")) },
        content,
      },
    ];
  },
};

const excerptIncludeImporter: MacroConverter = {
  source: "confluence",
  macros: ["excerpt-include"],
  references: (macro) => ({ pageTitles: sameSpaceTitle(macro) }),
  convert: (macro, context) => {
    if (!onlyKnownParameters(macro, new Set(["", "page", "nopanel", "name"]))) return null;
    const name = singleLine(macroText(macro, "name"));
    if (name.length > MAX_EXCERPT_NAME_LENGTH) return null;
    const source = includeSource(macro, context);
    if (!source) return null;
    return [
      {
        type: "includeExcerpt",
        attrs: {
          ...source,
          name: name.length > 0 ? name : null,
          panel: !isTrue(macroText(macro, "nopanel")),
        },
      },
    ];
  },
};

const includeImporter: MacroConverter = {
  source: "confluence",
  macros: ["include"],
  references: (macro) => ({ pageTitles: sameSpaceTitle(macro) }),
  convert: (macro, context) => {
    if (!onlyKnownParameters(macro, new Set(["", "page"]))) return null;
    const source = includeSource(macro, context);
    return source ? [{ type: "includePage", attrs: source }] : null;
  },
};

export const excerptModule = defineModule({
  name: "excerpt",
  nodes: [
    {
      name: "excerpt",
      spec: { content: "block+", group: "block", defining: true },
      attrs: {
        name: optional(excerptNameValue.nullable(), null),
        hidden: optional(z.boolean(), false),
      },
      validate: (node) =>
        containsExcerpt(node.content) ? "An excerpt cannot contain another excerpt" : null,
      html: (node, renderer) => {
        const hidden = attrOf<boolean>(node, "hidden");
        if (hidden && !renderer.context.showPlaceholders) return "";
        return element(
          "div",
          {
            class: "ph-excerpt",
            "data-name": attrOf<string | null>(node, "name"),
            "data-hidden": hidden ? "true" : null,
          },
          renderer.children(node),
        );
      },
      word: (node, renderer) =>
        attrOf<boolean>(node, "hidden") && !renderer.context.showPlaceholders ? [] : renderer.blocks(node),
      markdown: (node, renderer) =>
        attrOf<boolean>(node, "hidden") && !renderer.context.showPlaceholders ? "" : renderer.blocks(node),
    },
  ],
  importers: [excerptImporter],
});

export const includeModule = defineModule({
  name: "include",
  nodes: [
    {
      name: "includeExcerpt",
      spec: { group: "block", atom: true, selectable: true, draggable: true },
      attrs: {
        ...sourceAttrs,
        name: optional(excerptNameValue.nullable(), null),
        panel: optional(z.boolean(), true),
      },
      validate: sourceProblem,
      html: includeHtml,
      word: includeWord,
      markdown: includeMarkdown,
      text: () => "",
    },
    {
      name: "includePage",
      spec: { group: "block", atom: true, selectable: true, draggable: true },
      attrs: sourceAttrs,
      validate: sourceProblem,
      html: includeHtml,
      word: includeWord,
      markdown: includeMarkdown,
      text: () => "",
    },
  ],
  importers: [excerptIncludeImporter, includeImporter],
});
