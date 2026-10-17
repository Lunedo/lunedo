import { z } from "zod";
import type { ResolvedEmbed } from "../embeds.js";
import {
  type FileReference,
  type ImportedFile,
  type MacroConverter,
  type MacroImportContext,
  macroParameter,
  macroText,
  type SourceElement,
  singleLine,
  sourceElements,
} from "../importing.js";
import type { NodeJson, ValidNode } from "../json.js";
import {
  attrOf,
  defineModule,
  type HtmlRenderer,
  type MarkdownRenderer,
  optional,
  required,
  type WordRenderer,
} from "../module.js";
import { element, htmlAttributes, markdownUrl } from "../text.js";
import { hrefValue, isAllowedHref, uuidValue } from "../values.js";
import { type WordContent, wordText } from "../word.js";

export const MAX_EMBED_TITLE = 255;
export const MIN_EMBED_HEIGHT = 100;
export const MAX_EMBED_HEIGHT = 2000;

export const EMBED_SANDBOX =
  "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation";
export const EMBED_ALLOW = "fullscreen; picture-in-picture; encrypted-media";

type AnyRenderer = HtmlRenderer | MarkdownRenderer | WordRenderer;

export function isEmbeddableUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function titleOf(node: ValidNode): string {
  return attrOf<string>(node, "title") || hostOf(attrOf<string>(node, "url"));
}

function resolvedEmbed(node: ValidNode, renderer: AnyRenderer): ResolvedEmbed | null | undefined {
  const resolve = renderer.context.embed;
  if (!resolve) return undefined;
  return resolve(attrOf<string>(node, "url"));
}

function thumbnail(node: ValidNode, renderer: AnyRenderer): string | null {
  const id = attrOf<string | null>(node, "thumbnailId");
  const resolved = id ? (renderer.context.attachment?.(id) ?? null) : null;
  return resolved ? renderer.safeHref(resolved.href) : null;
}

function linkHtml(node: ValidNode, renderer: HtmlRenderer, text: string): string {
  const href = renderer.safeHref(attrOf<string>(node, "url"));
  return href
    ? element("a", { href, rel: "noopener noreferrer", target: "_blank" }, renderer.escape(text))
    : renderer.escape(text);
}

function embedHtml(node: ValidNode, renderer: HtmlRenderer): string {
  const url = attrOf<string>(node, "url");
  const resolved = resolvedEmbed(node, renderer);
  const title = titleOf(node);
  if (resolved === null) {
    return element(
      "div",
      { class: "ph-embed ph-embed-blocked", "data-url": url },
      `${element("p", { class: "ph-embed-link" }, linkHtml(node, renderer, url))}${element("p", { class: "ph-embed-hint" }, renderer.escape(renderer.label("embedNotAllowed")))}`,
    );
  }
  const caption = element(
    "figcaption",
    {},
    `${linkHtml(node, renderer, title)}${
      resolved
        ? element(
            "span",
            { class: "ph-embed-service" },
            renderer.escape(renderer.label("embedFrom", { service: resolved.service.name })),
          )
        : ""
    }`,
  );
  const frame = resolved
    ? element("div", {
        class: "ph-embed-frame",
        "data-src": resolved.src,
        "data-referrer-policy": resolved.referrerPolicy,
        "data-title": title,
        "data-height": attrOf<number | null>(node, "height"),
      })
    : "";
  return element(
    "figure",
    { class: "ph-embed", "data-url": url, "data-service": resolved?.service.id ?? null },
    `${frame}${caption}`,
  );
}

function embedPrint(node: ValidNode, renderer: HtmlRenderer): string {
  const title = titleOf(node);
  const image = thumbnail(node, renderer);
  const url = attrOf<string>(node, "url");
  return element(
    "figure",
    { class: "ph-embed ph-embed-print" },
    `${image ? `<img${htmlAttributes({ src: image, alt: title })}>` : ""}${element(
      "figcaption",
      {},
      `${element("strong", {}, renderer.escape(title))} ${linkHtml(node, renderer, url)}`,
    )}`,
  );
}

function embedWord(node: ValidNode, renderer: WordRenderer): WordContent[] {
  const title = titleOf(node);
  const url = attrOf<string>(node, "url");
  const href = renderer.safeHref(url);
  const id = attrOf<string | null>(node, "thumbnailId");
  const caption: WordContent = {
    type: "paragraph",
    content: [wordText(title, { bold: true }), wordText(" "), wordText(url, href ? { link: href } : {})],
  };
  if (!id) return [caption];
  return [
    {
      type: "image",
      attachmentId: id,
      href: thumbnail(node, renderer),
      alt: title,
      width: null,
      align: "center",
    },
    caption,
  ];
}

export function macroUrl(macro: SourceElement, names: readonly string[]): string | null {
  for (const name of names) {
    const parameter = macroParameter(macro, name);
    if (!parameter) continue;
    const reference = sourceElements(parameter, "ri:url")[0];
    const value = singleLine(reference ? (reference.attributes["ri:value"] ?? "") : macroText(macro, name));
    if (value.length > 0) return value;
  }
  return null;
}

function httpsVariant(url: string): string {
  return url.replace(/^http:\/\//i, "https://");
}

export function embeddableUrl(url: string, context: MacroImportContext): string | null {
  for (const candidate of [url, httpsVariant(url)]) {
    if (isAllowedHref(candidate) && isEmbeddableUrl(candidate) && context.embeddable(candidate))
      return candidate;
  }
  return null;
}

export function linkParagraph(url: string, text = url): NodeJson {
  return {
    type: "paragraph",
    content: [{ type: "text", text: text.slice(0, 2000), marks: [{ type: "link", attrs: { href: url } }] }],
  };
}

function pixels(value: string | null): number | null {
  const match = /^(\d{2,4})(px)?$/i.exec((value ?? "").trim());
  if (!match) return null;
  const height = Number(match[1]);
  return height >= MIN_EMBED_HEIGHT && height <= MAX_EMBED_HEIGHT ? height : null;
}

interface ExternalContent {
  readonly macro: string;
  readonly name: string;
  readonly url: string | null;
  readonly title: string;
  readonly height: number | null;
  readonly preview: ImportedFile | null;
  readonly source: ImportedFile | null;
}

function externalContent(content: ExternalContent, context: MacroImportContext): NodeJson[] | null {
  const { macro, name, url, title, height, preview, source } = content;
  const href = url && isAllowedHref(url) && isEmbeddableUrl(url) ? url : null;
  const embedUrl = href ? embeddableUrl(href, context) : null;
  if (embedUrl) {
    return [
      {
        type: "embed",
        attrs: {
          url: embedUrl,
          title: title.slice(0, MAX_EMBED_TITLE),
          height,
          thumbnailId: preview?.attachmentId ?? null,
        },
      },
    ];
  }
  const blocks: NodeJson[] = [];
  if (preview) {
    blocks.push({ type: "image", attrs: { attachmentId: preview.attachmentId, alt: title.slice(0, 1000) } });
  }
  if (href) blocks.push(linkParagraph(href, title || href));
  if (source) {
    blocks.push({
      type: "file",
      attrs: { attachmentId: source.attachmentId, name: source.name.slice(0, 255) },
    });
  }
  if (blocks.length === 0) return null;
  if (href) context.note({ code: "embedNotAllowed", macro, url: href.slice(0, 255) });
  context.note(
    preview
      ? { code: "previewOnly", macro, name: name.slice(0, 255) }
      : { code: "previewMissing", macro, name: name.slice(0, 255) },
  );
  return blocks;
}

const widgetImporter: MacroConverter = {
  source: "confluence",
  macros: ["widget"],
  convert: (macro, context) => {
    const url = macroUrl(macro, ["url"]);
    if (!url || !isAllowedHref(url) || !isEmbeddableUrl(url)) return null;
    const embedUrl = embeddableUrl(url, context);
    if (embedUrl) {
      return [
        { type: "embed", attrs: { url: embedUrl, title: "", height: pixels(macroText(macro, "height")) } },
      ];
    }
    context.note({ code: "embedNotAllowed", macro: "widget", url: url.slice(0, 255) });
    return [linkParagraph(url)];
  },
};

function firstFile(context: MacroImportContext, names: readonly string[]): ImportedFile | null {
  for (const fileName of names) {
    const found = context.file({ fileName });
    if (found) return found;
  }
  return null;
}

const LUCID_DOCUMENT = /^[A-Za-z0-9-]{1,100}$/;
const SAFE_NAME = /^[^/\\]{1,200}$/;

function lucidNames(macro: SourceElement): string[] {
  const name = singleLine(macroText(macro, "documentName"));
  return SAFE_NAME.test(name) ? [`${name}.png`] : [];
}

const lucidchartImporter: MacroConverter = {
  source: "confluence",
  macros: ["lucidchart"],
  references: (macro) => ({ files: lucidNames(macro).map((fileName) => ({ fileName })) }),
  convert: (macro, context) => {
    const documentId = singleLine(macroText(macro, "documentId"));
    if (!LUCID_DOCUMENT.test(documentId)) return null;
    const name = singleLine(macroText(macro, "documentName")) || documentId;
    return externalContent(
      {
        macro: "lucidchart",
        name,
        url: `https://lucid.app/lucidchart/${documentId}/view`,
        title: name,
        height: pixels(macroText(macro, "height")),
        preview: firstFile(context, lucidNames(macro)),
        source: null,
      },
      context,
    );
  },
};

function balsamiqFiles(macro: SourceElement): { name: string; previews: string[]; sources: string[] } | null {
  if (macro.attributes["ac:name"] === "mockup") {
    const name = singleLine(macroText(macro, "Name"));
    if (!SAFE_NAME.test(name)) return null;
    return { name, previews: [`mockup_${name}.png`], sources: [`mockup_${name}.bmml`] };
  }
  const resource = singleLine(macroText(macro, "initialResourceID"));
  const branch = singleLine(macroText(macro, "initialBranchID")) || "Master";
  const archive = singleLine(macroText(macro, "platformArchiveName"));
  if (!SAFE_NAME.test(resource) || !SAFE_NAME.test(branch)) return null;
  return {
    name: archive || resource,
    previews: [`balsamiq_wireframe_${resource}_${branch}.png`],
    sources: SAFE_NAME.test(archive) ? [`${archive}.bmpr`] : [],
  };
}

const balsamiqImporter: MacroConverter = {
  source: "confluence",
  macros: ["mockup", "wireframe"],
  references: (macro) => {
    const files = balsamiqFiles(macro);
    return {
      files: files
        ? [...files.previews, ...files.sources].map((fileName): FileReference => ({ fileName }))
        : [],
    };
  },
  convert: (macro, context) => {
    const files = balsamiqFiles(macro);
    if (!files) return null;
    return externalContent(
      {
        macro: macro.attributes["ac:name"] ?? "mockup",
        name: files.name,
        url: null,
        title: files.name,
        height: null,
        preview: firstFile(context, files.previews),
        source: firstFile(context, files.sources),
      },
      context,
    );
  },
};

const miroImporter: MacroConverter = {
  source: "confluence",
  macros: ["miro", "miro-board", "miro-embed", "realtimeboard"],
  convert: (macro, context) => {
    const url = macroUrl(macro, ["url", "boardUrl", "link", "board"]);
    if (!url) return null;
    return externalContent(
      {
        macro: macro.attributes["ac:name"] ?? "miro",
        name: url,
        url,
        title: singleLine(macroText(macro, "title")) || url,
        height: pixels(macroText(macro, "height")),
        preview: null,
        source: null,
      },
      context,
    );
  },
};

export const embedModule = defineModule({
  name: "embed",
  nodes: [
    {
      name: "embed",
      spec: { group: "block", atom: true, draggable: true },
      attrs: {
        url: required(hrefValue),
        title: optional(z.string().max(MAX_EMBED_TITLE), ""),
        height: optional(z.number().int().min(MIN_EMBED_HEIGHT).max(MAX_EMBED_HEIGHT).nullable(), null),
        thumbnailId: optional(uuidValue.nullable(), null),
      },
      validate: (node) =>
        isEmbeddableUrl(attrOf<string>(node, "url")) ? null : "An embed needs an http or https address",
      html: embedHtml,
      print: embedPrint,
      word: embedWord,
      markdown: (node, renderer) => {
        const href = renderer.safeHref(attrOf<string>(node, "url"));
        const title = renderer.escape(titleOf(node));
        return href ? `[${title}](${markdownUrl(href)})` : title;
      },
      text: (node) => attrOf<string>(node, "title"),
    },
  ],
  importers: [widgetImporter, lucidchartImporter, balsamiqImporter, miroImporter],
});
