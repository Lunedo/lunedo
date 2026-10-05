import { z } from "zod";
import { attrOf, defineModule, optional, required } from "../module.js";
import { element, htmlAttributes, markdownUrl } from "../text.js";
import { imageAlignments, uuidValue } from "../values.js";

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
      markdown: (node, renderer) => {
        renderer.nextHeadingId();
        return `## ${renderer.escape(attrOf<string>(node, "title"))}\n\n${renderer.blocks(node)}`;
      },
      text: (node) => attrOf<string>(node, "title"),
      heading: (node) => ({ level: 2, text: attrOf<string>(node, "title") }),
    },
  ],
});

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
      html: (node, renderer) => {
        const id = attrOf<string>(node, "attachmentId");
        const resolved = renderer.context.attachment?.(id) ?? null;
        const href = resolved ? renderer.safeHref(resolved.href) : null;
        const image = href
          ? `<img${htmlAttributes({ src: href, alt: attrOf<string>(node, "alt"), loading: "lazy" })}>`
          : "";
        return element(
          "figure",
          {
            class: "ph-image",
            "data-attachment-id": id,
            "data-align": attrOf<string>(node, "align"),
            "data-width": attrOf<number | null>(node, "width"),
          },
          image,
        );
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
      markdown: (node, renderer) => {
        const name = renderer.escape(attrOf<string>(node, "name") || renderer.label("file"));
        const resolved = renderer.context.attachment?.(attrOf<string>(node, "attachmentId")) ?? null;
        const href = resolved ? renderer.safeHref(resolved.href) : null;
        return href ? `[${name}](${markdownUrl(href)})` : name;
      },
      text: (node) => attrOf<string>(node, "name"),
    },
  ],
});
