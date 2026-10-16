import { z } from "zod";
import { type MacroConverter, macroReference } from "../importing.js";
import type { ValidNode } from "../json.js";
import { attrOf, defineModule, type HtmlRenderer, optional, required } from "../module.js";
import { element, htmlAttributes, markdownUrl } from "../text.js";
import { imageAlignments, uuidValue } from "../values.js";
import { wordText } from "../word.js";

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
      html: (node, renderer) =>
        element(
          "section",
          { class: "ph-section", "data-section": attrOf<string>(node, "key") },
          `${element("h2", { id: renderer.nextHeadingId() }, renderer.escape(attrOf<string>(node, "title")))}${renderer.children(node)}`,
        ),
      word: (node, renderer) => [
        {
          type: "heading",
          level: 2,
          anchor: renderer.nextHeadingId(),
          content: [wordText(attrOf<string>(node, "title"))],
        },
        ...renderer.blocks(node),
      ],
      markdown: (node, renderer) => {
        renderer.nextHeadingId();
        return `## ${renderer.escape(attrOf<string>(node, "title"))}\n\n${renderer.blocks(node)}`;
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

const fileImporter: MacroConverter = {
  source: "confluence",
  macros: ["view-file", "viewpdf", "viewxls"],
  convert: (macro, context) => {
    const reference = macroReference(macro, "name", "ri:attachment");
    if (!reference) return null;
    const found = context.attachment(reference, macroReference(macro, "page", "ri:page"));
    if (!found) return null;
    return [{ type: "file", attrs: { attachmentId: found.attachmentId, name: found.name.slice(0, 255) } }];
  },
};

export const fileModule = defineModule({
  name: "file",
  nodes: [
    {
      name: "file",
      spec: { group: "block", atom: true, draggable: true },
      attrs: {
        attachmentId: required(uuidValue),
        name: optional(z.string().max(255), ""),
      },
      html: (node, renderer) => {
        const id = attrOf<string>(node, "attachmentId");
        const name = attrOf<string>(node, "name") || renderer.label("file");
        const resolved = renderer.context.attachment?.(id) ?? null;
        const href = resolved ? renderer.safeHref(resolved.href) : null;
        const content = href
          ? element("a", { href, rel: "noopener noreferrer" }, renderer.escape(name))
          : renderer.escape(name);
        return element("div", { class: "ph-file", "data-attachment-id": id }, content);
      },
      word: (node, renderer) => {
        const name = attrOf<string>(node, "name") || renderer.label("file");
        const resolved = renderer.context.attachment?.(attrOf<string>(node, "attachmentId")) ?? null;
        const href = resolved ? renderer.safeHref(resolved.href) : null;
        return [{ type: "paragraph", content: [wordText(name, href ? { link: href } : {})] }];
      },
      markdown: (node, renderer) => {
        const name = renderer.escape(attrOf<string>(node, "name") || renderer.label("file"));
        const resolved = renderer.context.attachment?.(attrOf<string>(node, "attachmentId")) ?? null;
        const href = resolved ? renderer.safeHref(resolved.href) : null;
        return href ? `[${name}](${markdownUrl(href)})` : name;
      },
      text: (node) => attrOf<string>(node, "name"),
    },
  ],
  importers: [fileImporter],
});
