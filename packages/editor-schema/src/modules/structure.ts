import { z } from "zod";
import { boundedInteger, type MacroConverter, macroReference, macroText } from "../importing.js";
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
import { element, headingNumberHtml, htmlAttributes, markdownUrl } from "../text.js";
import { imageAlignments, uuidValue } from "../values.js";
import { type WordContent, wordText } from "../word.js";

export const sectionModule = defineModule({
  name: "section",
  nodes: [
    {
      name: "section",
      spec: { content: "block+", group: "block", defining: true },
      attrs: {
        key: required(z.string().regex(/^[a-z][a-zA-Z0-9]{0,39}$/)),
        title: optional(z.string().max(255), ""),
      },
      html: (node, renderer) => {
        const id = renderer.nextHeadingId();
        const title = `${headingNumberHtml(renderer.headingNumber())}${renderer.escape(attrOf<string>(node, "title"))}`;
        return element(
          "section",
          { class: "ph-section", "data-section": attrOf<string>(node, "key") },
          `${element("h2", { id }, title)}${renderer.children(node)}`,
        );
      },
      word: (node, renderer) => {
        const anchor = renderer.nextHeadingId();
        const number = renderer.headingNumber();
        return [
          {
            type: "heading",
            level: 2,
            anchor,
            content: [wordText(`${number ? `${number} ` : ""}${attrOf<string>(node, "title")}`)],
          },
          ...renderer.blocks(node),
        ];
      },
      markdown: (node, renderer) => {
        renderer.nextHeadingId();
        const number = renderer.headingNumber();
        return `## ${number ? `${number} ` : ""}${renderer.escape(attrOf<string>(node, "title"))}\n\n${renderer.blocks(node)}`;
      },
      text: (node) => attrOf<string>(node, "title"),
      heading: (node) => ({ level: 2, text: attrOf<string>(node, "title") }),
    },
  ],
});

function imageHtml(node: ValidNode, renderer: HtmlRenderer, lazy: boolean): string {
  const id = attrOf<string>(node, "attachmentId");
  const resolved = renderer.context.attachment?.(id) ?? null;
  const href = resolved ? renderer.safeHref(resolved.href) : null;
  const width = attrOf<number | null>(node, "width");
  const image = href
    ? `<img${htmlAttributes({
        src: href,
        alt: attrOf<string>(node, "alt"),
        loading: lazy ? "lazy" : null,
        width: lazy ? null : width,
      })}>`
    : "";
  return element(
    "figure",
    {
      class: "ph-image",
      "data-attachment-id": id,
      "data-align": attrOf<string>(node, "align"),
      "data-width": width,
    },
    image,
  );
}

export const imageModule = defineModule({
  name: "image",
  nodes: [
    {
      name: "image",
      spec: { group: "block", atom: true, draggable: true },
      attrs: {
        attachmentId: required(uuidValue),
        alt: optional(z.string().max(1000), ""),
        width: optional(z.number().int().min(1).max(10_000).nullable(), null),
        align: optional(z.enum(imageAlignments), "center"),
      },
      html: (node, renderer) => imageHtml(node, renderer, true),
      print: (node, renderer) => imageHtml(node, renderer, false),
      word: (node, renderer) => {
        const id = attrOf<string>(node, "attachmentId");
        const resolved = renderer.context.attachment?.(id) ?? null;
        return [
          {
            type: "image",
            attachmentId: id,
            href: resolved ? renderer.safeHref(resolved.href) : null,
            alt: attrOf<string>(node, "alt"),
            width: attrOf<number | null>(node, "width"),
            align: attrOf<string>(node, "align"),
          },
        ];
      },
      markdown: (node, renderer) => {
        const resolved = renderer.context.attachment?.(attrOf<string>(node, "attachmentId")) ?? null;
        const href = resolved ? renderer.safeHref(resolved.href) : null;
        return `![${renderer.escape(attrOf<string>(node, "alt"))}](${href ? markdownUrl(href) : ""})`;
      },
      text: () => "",
    },
  ],
});

export const MIN_PREVIEW_HEIGHT = 150;
export const MAX_PREVIEW_HEIGHT = 2000;
export const MIN_PREVIEW_ZOOM = 25;
export const MAX_PREVIEW_ZOOM = 400;

function previewHeight(value: string | null): number | null {
  const height = boundedInteger(
    (value ?? "").trim().replace(/px$/i, ""),
    MIN_PREVIEW_HEIGHT,
    MAX_PREVIEW_HEIGHT,
  );
  return height;
}

const fileImporter: MacroConverter = {
  source: "confluence",
  macros: ["view-file", "viewpdf", "viewxls", "viewdoc", "viewppt"],
  convert: (macro, context) => {
    const reference = macroReference(macro, "name", "ri:attachment");
    if (!reference) return null;
    const found = context.attachment(reference, macroReference(macro, "page", "ri:page"));
    if (!found) return null;
    return [
      {
        type: "file",
        attrs: {
          attachmentId: found.attachmentId,
          name: found.name.slice(0, 255),
          preview: true,
          height: previewHeight(macroText(macro, "height")),
        },
      },
    ];
  },
};

type AnyRenderer = HtmlRenderer | MarkdownRenderer | WordRenderer;

function fileLink(
  node: ValidNode,
  renderer: AnyRenderer,
): { name: string; href: string | null; image: boolean } {
  const name = attrOf<string>(node, "name") || renderer.label("file");
  const resolved = renderer.context.attachment?.(attrOf<string>(node, "attachmentId")) ?? null;
  return {
    name,
    href: resolved ? renderer.safeHref(resolved.href) : null,
    image: resolved?.image === true,
  };
}

function fileHtml(node: ValidNode, renderer: HtmlRenderer): string {
  const id = attrOf<string>(node, "attachmentId");
  const { name, href } = fileLink(node, renderer);
  const content = href
    ? element("a", { href, rel: "noopener noreferrer" }, renderer.escape(name))
    : renderer.escape(name);
  const preview = attrOf<boolean>(node, "preview");
  return element(
    "div",
    {
      class: "ph-file",
      "data-attachment-id": id,
      "data-preview": preview ? "true" : null,
      "data-height": preview ? attrOf<number | null>(node, "height") : null,
      "data-zoom": preview ? attrOf<number | null>(node, "zoom") : null,
    },
    content,
  );
}

function filePrint(node: ValidNode, renderer: HtmlRenderer): string {
  const { name, href, image } = fileLink(node, renderer);
  if (!attrOf<boolean>(node, "preview") || !image || !href) return fileHtml(node, renderer);
  return element(
    "figure",
    { class: "ph-file-preview", "data-attachment-id": attrOf<string>(node, "attachmentId") },
    `<img${htmlAttributes({ src: href, alt: name })}>${element("figcaption", {}, element("a", { href }, renderer.escape(name)))}`,
  );
}

function fileWord(node: ValidNode, renderer: WordRenderer): WordContent[] {
  const { name, href, image } = fileLink(node, renderer);
  const link: WordContent = { type: "paragraph", content: [wordText(name, href ? { link: href } : {})] };
  if (!attrOf<boolean>(node, "preview") || !image) return [link];
  return [
    {
      type: "image",
      attachmentId: attrOf<string>(node, "attachmentId"),
      href,
      alt: name,
      width: null,
      align: "center",
    },
    link,
  ];
}

export const fileModule = defineModule({
  name: "file",
  nodes: [
    {
      name: "file",
      spec: { group: "block", atom: true, draggable: true },
      attrs: {
        attachmentId: required(uuidValue),
        name: optional(z.string().max(255), ""),
        preview: optional(z.boolean(), false),
        height: optional(z.number().int().min(MIN_PREVIEW_HEIGHT).max(MAX_PREVIEW_HEIGHT).nullable(), null),
        zoom: optional(z.number().int().min(MIN_PREVIEW_ZOOM).max(MAX_PREVIEW_ZOOM).nullable(), null),
      },
      html: fileHtml,
      print: filePrint,
      word: fileWord,
      markdown: (node, renderer) => {
        const { name, href } = fileLink(node, renderer);
        const text = renderer.escape(name);
        return href ? `[${text}](${markdownUrl(href)})` : text;
      },
      text: (node) => attrOf<string>(node, "name"),
    },
  ],
  importers: [fileImporter],
});
