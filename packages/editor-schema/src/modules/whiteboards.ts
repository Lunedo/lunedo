import type { ValidNode } from "../json.js";
import {
  attrOf,
  defineModule,
  type HtmlRenderer,
  type MarkdownRenderer,
  optional,
  type ReferencedWhiteboard,
  type WordRenderer,
} from "../module.js";
import { clearedAttributes } from "../portable.js";
import { element, htmlAttributes, markdownUrl } from "../text.js";
import { uuidValue } from "../values.js";
import { type WordContent, wordText } from "../word.js";

type AnyRenderer = HtmlRenderer | MarkdownRenderer | WordRenderer;

function referenced(node: ValidNode, renderer: AnyRenderer): ReferencedWhiteboard | null | undefined {
  const resolve = renderer.context.whiteboard;
  if (!resolve) return undefined;
  const id = attrOf<string | null>(node, "whiteboardId");
  return id ? resolve(id) : null;
}

function missingNote(node: ValidNode, renderer: AnyRenderer): string | null {
  if (!renderer.context.showPlaceholders) return null;
  return attrOf<string | null>(node, "whiteboardId") === null
    ? renderer.label("chooseWhiteboard")
    : renderer.label("restrictedContent");
}

function whiteboardHtml(node: ValidNode, renderer: HtmlRenderer): string {
  const id = attrOf<string | null>(node, "whiteboardId");
  const board = referenced(node, renderer);
  if (board === undefined) {
    return element(
      "figure",
      { class: "ld-whiteboard", "data-whiteboard-id": id },
      element("span", { class: "ld-whiteboard-empty" }, renderer.escape(renderer.label("whiteboard"))),
    );
  }
  if (board === null) {
    const note = missingNote(node, renderer);
    return note
      ? element(
          "figure",
          { class: "ld-whiteboard ld-whiteboard-note" },
          element("p", {}, renderer.escape(note)),
        )
      : "";
  }
  const href = renderer.safeHref(board.href);
  const preview = board.previewHref ? renderer.safeHref(board.previewHref) : null;
  const title = board.title || renderer.label("whiteboard");
  const image = preview
    ? `<img${htmlAttributes({ src: preview, alt: "", loading: renderer.context.target === "print" ? null : "lazy" })}>`
    : element("span", { class: "ld-whiteboard-empty" }, renderer.escape(renderer.label("whiteboard")));
  const caption = element("figcaption", {}, renderer.escape(title));
  const content = href
    ? element("a", { href, class: "ld-whiteboard-link" }, `${image}${caption}`)
    : `${image}${caption}`;
  return element("figure", { class: "ld-whiteboard", "data-whiteboard-id": id }, content);
}

function whiteboardWord(node: ValidNode, renderer: WordRenderer): WordContent[] {
  const board = referenced(node, renderer);
  const note = (text: string): WordContent => ({
    type: "paragraph",
    content: [wordText(text, { muted: true, italic: true })],
  });
  if (board === undefined) return [note(renderer.label("whiteboard"))];
  if (board === null) {
    const hidden = missingNote(node, renderer);
    return hidden ? [note(hidden)] : [];
  }
  const href = renderer.safeHref(board.href);
  const title = board.title || renderer.label("whiteboard");
  const caption: WordContent = {
    type: "paragraph",
    content: [wordText(title, href ? { link: href, bold: true } : { bold: true })],
  };
  const preview = board.previewHref ? renderer.safeHref(board.previewHref) : null;
  const id = attrOf<string>(node, "whiteboardId");
  return preview
    ? [{ type: "image", attachmentId: id, href: preview, alt: title, width: null, align: "center" }, caption]
    : [caption];
}

function whiteboardMarkdown(node: ValidNode, renderer: MarkdownRenderer): string {
  const board = referenced(node, renderer);
  if (board === undefined) return `*${renderer.escape(renderer.label("whiteboard"))}*`;
  if (board === null) {
    const hidden = missingNote(node, renderer);
    return hidden ? `*${renderer.escape(hidden)}*` : "";
  }
  const href = renderer.safeHref(board.href);
  const title = renderer.escape(board.title || renderer.label("whiteboard"));
  return href ? `[${title}](${markdownUrl(href)})` : title;
}

export const whiteboardModule = defineModule({
  name: "whiteboard",
  nodes: [
    {
      name: "whiteboard",
      spec: { group: "block", atom: true, selectable: true, draggable: true },
      attrs: { whiteboardId: optional(uuidValue.nullable(), null) },
      portable: clearedAttributes("whiteboard", { whiteboardId: null }),
      html: whiteboardHtml,
      word: whiteboardWord,
      markdown: whiteboardMarkdown,
      text: () => "",
    },
  ],
});
