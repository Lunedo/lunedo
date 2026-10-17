import { z } from "zod";
import type { ResolvedEmbed } from "../embeds.js";
import type { ValidNode } from "../json.js";
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
import { hrefValue, uuidValue } from "../values.js";
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
});
