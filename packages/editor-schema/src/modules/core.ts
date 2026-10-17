import { z } from "zod";
import { attrOf, defineModule, optional } from "../module.js";
import { element, escapeLineStart, headingNumberHtml, prefixLines } from "../text.js";
import { alignmentValue, indentValue, type TextAlignment } from "../values.js";
import { wordText } from "../word.js";

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
      word: (node, renderer) => renderer.blocks(node),
      markdown: (node, renderer) => renderer.blocks(node),
    },
    {
      name: "paragraph",
      spec: { content: "inline*", group: "block" },
      attrs: blockFormatting,
      html: (node, renderer) => element("p", formattingAttributes(node), renderer.children(node)),
      word: (node, renderer) => [
        {
          type: "paragraph",
          content: renderer.inline(node),
          align: attrOf<TextAlignment>(node, "textAlign"),
          indent: attrOf<number>(node, "indent"),
        },
      ],
      markdown: (node, renderer) => markdownBlockLine(renderer.inline(node)),
    },
    {
      name: "text",
      spec: { group: "inline" },
      html: (node, renderer) => renderer.escape(node.text ?? ""),
      word: (node) => [wordText(node.text ?? "")],
      markdown: (node, renderer) => renderer.escape(node.text ?? ""),
      text: (node) => node.text ?? "",
    },
    {
      name: "hardBreak",
      spec: { inline: true, group: "inline", selectable: false },
      html: () => "<br>",
      word: () => [{ type: "break" }],
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
      html: (node, renderer) => {
        const id = renderer.nextHeadingId();
        return element(
          `h${attrOf<number>(node, "level")}`,
          { id, ...formattingAttributes(node) },
          `${headingNumberHtml(renderer.headingNumber())}${renderer.children(node)}`,
        );
      },
      word: (node, renderer) => {
        const anchor = renderer.nextHeadingId();
        const number = renderer.headingNumber();
        return [
          {
            type: "heading",
            level: attrOf<number>(node, "level"),
            anchor,
            content: [...(number ? [wordText(`${number} `)] : []), ...renderer.inline(node)],
          },
        ];
      },
      markdown: (node, renderer) => {
        renderer.nextHeadingId();
        const number = renderer.headingNumber();
        const content = renderer.inline(node).replace(/\n/g, " ");
        return `${"#".repeat(attrOf<number>(node, "level"))} ${number ? `${number} ` : ""}${content}`.trimEnd();
      },
      heading: (node, text) => ({ level: attrOf<number>(node, "level"), text }),
    },
    {
      name: "blockquote",
      spec: { content: "block+", group: "block", defining: true },
      html: (node, renderer) => element("blockquote", {}, renderer.children(node)),
      word: (node, renderer) => [{ type: "quote", content: renderer.blocks(node) }],
      markdown: (node, renderer) => prefixLines(renderer.blocks(node), "> ", "> "),
    },
    {
      name: "horizontalRule",
      spec: { group: "block" },
      html: () => "<hr>",
      word: () => [{ type: "rule" }],
      markdown: () => "---",
    },
  ],
});
