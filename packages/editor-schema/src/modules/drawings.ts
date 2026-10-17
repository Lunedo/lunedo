import { z } from "zod";
import { copyAttachmentAttributes } from "../copying.js";
import type { ValidNode } from "../json.js";
import { attrOf, defineModule, type HtmlRenderer, optional, required } from "../module.js";
import { element, htmlAttributes, markdownUrl } from "../text.js";
import { uuidValue } from "../values.js";
import { wordText } from "../word.js";

export const MAX_DRAWING_TEXT = 20_000;

const version = z.number().int().min(1).max(1_000_000).nullable();

function drawingHtml(node: ValidNode, renderer: HtmlRenderer, lazy: boolean): string {
  const preview = attrOf<string | null>(node, "previewId");
  const resolved = preview
    ? (renderer.context.attachment?.(preview, attrOf<number>(node, "previewVersion") ?? undefined) ?? null)
    : null;
  const href = resolved ? renderer.safeHref(resolved.href) : null;
  const label = renderer.label("drawing");
  const content = href
    ? `<img${htmlAttributes({ src: href, alt: label, loading: lazy ? "lazy" : null })}>`
    : element("span", { class: "ph-drawing-empty" }, renderer.escape(label));
  return element("figure", { class: "ph-drawing", "data-drawing-id": attrOf<string>(node, "id") }, content);
}

export const drawingModule = defineModule({
  name: "drawing",
  nodes: [
    {
      name: "drawing",
      spec: { group: "block", atom: true, draggable: true },
      attrs: {
        id: required(uuidValue),
        sceneId: optional(uuidValue.nullable(), null),
        sceneVersion: optional(version, null),
        previewId: optional(uuidValue.nullable(), null),
        previewVersion: optional(version, null),
        text: optional(z.string().max(MAX_DRAWING_TEXT), ""),
      },
      copy: copyAttachmentAttributes([
        ["sceneId", "sceneVersion"],
        ["previewId", "previewVersion"],
      ]),
      validate: (node) => {
        const scene = attrOf<string | null>(node, "sceneId");
        const preview = attrOf<string | null>(node, "previewId");
        if ((scene === null) !== (attrOf<number | null>(node, "sceneVersion") === null)) {
          return "sceneId and sceneVersion are set together";
        }
        if ((preview === null) !== (attrOf<number | null>(node, "previewVersion") === null)) {
          return "previewId and previewVersion are set together";
        }
        if (preview !== null && scene === null) return "A preview needs a scene";
        return null;
      },
      html: (node, renderer) => drawingHtml(node, renderer, true),
      print: (node, renderer) => drawingHtml(node, renderer, false),
      word: (node, renderer) => {
        const preview = attrOf<string | null>(node, "previewId");
        const label = renderer.label("drawing");
        if (!preview)
          return [{ type: "paragraph", content: [wordText(label, { muted: true, italic: true })] }];
        const resolved =
          renderer.context.attachment?.(preview, attrOf<number>(node, "previewVersion") ?? undefined) ?? null;
        return [
          {
            type: "image",
            attachmentId: preview,
            href: resolved ? renderer.safeHref(resolved.href) : null,
            alt: label,
            width: null,
            align: "center",
          },
        ];
      },
      markdown: (node, renderer) => {
        const preview = attrOf<string | null>(node, "previewId");
        const resolved = preview
          ? (renderer.context.attachment?.(preview, attrOf<number>(node, "previewVersion") ?? undefined) ??
            null)
          : null;
        const href = resolved ? renderer.safeHref(resolved.href) : null;
        const label = renderer.escape(renderer.label("drawing"));
        return href ? `![${label}](${markdownUrl(href)})` : `*${label}*`;
      },
      text: (node) => attrOf<string>(node, "text"),
    },
  ],
});
