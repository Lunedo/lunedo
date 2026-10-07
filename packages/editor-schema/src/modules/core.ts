import { z } from "zod";
import { attrOf, defineModule, optional } from "../module.js";
import { element, escapeLineStart, prefixLines } from "../text.js";
import { alignmentValue, indentValue } from "../values.js";

const blockFormatting = {
  textAlign: optional(alignmentValue, "left"),
  indent: optional(indentValue, 0),
};

function formattingAttributes(node: { attrs: Record<string, unknown> }) {
  const align = attrOf<string>(node, "textAlign");
  const indent = attrOf<number>(node, "indent");
  return {
    "data-align": align === "left" ? null : align,
    "data-indent": indent > 0 ? indent : null,
  };
}

function markdownBlockLine(content: string): string {
  return content
    .split("\n")
    .map((line, index) => (index === 0 ? escapeLineStart(line) : line))
    .join("\n");
}

export const coreModule = defineModule({
  name: "core",
  nodes: [
    {
      name: "doc",
      spec: { content: "block+" },
      html: (node, renderer) => renderer.children(node),
      markdown: (node, renderer) => renderer.blocks(node),
    },
    {
      name: "paragraph",
      spec: { content: "inline*", group: "block" },
      attrs: blockFormatting,
      html: (node, renderer) => element("p", formattingAttributes(node), renderer.children(node)),
      markdown: (node, renderer) => markdownBlockLine(renderer.inline(node)),
    },
    {
      name: "text",
      spec: { group: "inline" },
      html: (node, renderer) => renderer.escape(node.text ?? ""),
      markdown: (node, renderer) => renderer.escape(node.text ?? ""),
      text: (node) => node.text ?? "",
    },
    {
      name: "hardBreak",
      spec: { inline: true, group: "inline", selectable: false },
      html: () => "<br>",
      markdown: () => "\\\n",
      text: () => "\n",
    },
    {
      name: "heading",
      spec: { content: "inline*", group: "block", defining: true },
      attrs: {
        level: optional(z.number().int().min(1).max(6), 1),
        ...blockFormatting,
      },
      html: (node, renderer) =>
        element(
          `h${attrOf<number>(node, "level")}`,
          { id: renderer.nextHeadingId(), ...formattingAttributes(node) },
          renderer.children(node),
        ),
      markdown: (node, renderer) => {
        renderer.nextHeadingId();
        const content = renderer.inline(node).replace(/\n/g, " ");
        return `${"#".repeat(attrOf<number>(node, "level"))} ${content}`.trimEnd();
      },
      heading: (node, text) => ({ level: attrOf<number>(node, "level"), text }),
    },
    {
      name: "blockquote",
      spec: { content: "block+", group: "block", defining: true },
      html: (node, renderer) => element("blockquote", {}, renderer.children(node)),
      markdown: (node, renderer) => prefixLines(renderer.blocks(node), "> ", "> "),
    },
    {
      name: "horizontalRule",
      spec: { group: "block" },
      html: () => "<hr>",
      markdown: () => "---",
    },
  ],
});
