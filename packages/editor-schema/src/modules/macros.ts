import katex from "katex";
import { z } from "zod";
import type { Heading, HtmlRenderer } from "../module.js";
import { attrOf, defineModule, optional, required } from "../module.js";
import { element, escapeHtml, fenceFor, inlineCode, markdownUrl, prefixLines } from "../text.js";
import { calloutVariants, colorValue } from "../values.js";

const ALERTS: Record<string, string> = {
  info: "NOTE",
  tip: "TIP",
  note: "IMPORTANT",
  warning: "WARNING",
  error: "CAUTION",
};

export const MAX_MACRO_DATA_BYTES = 256 * 1024;
export const MAX_LATEX_LENGTH = 10_000;

const encoder = new TextEncoder();

function renderMath(latex: string, displayMode: boolean, renderer: HtmlRenderer): string {
  const rendered = renderer.spendRenderBudget(latex.length)
    ? katex.renderToString(latex, {
        throwOnError: false,
        output: "htmlAndMathml",
        displayMode,
        trust: false,
        strict: "ignore",
        maxExpand: 1000,
        maxSize: 20,
      })
    : element("code", {}, escapeHtml(latex));
  return element(
    displayMode ? "div" : "span",
    { class: displayMode ? "ph-math ph-math-block" : "ph-math", "data-latex": latex },
    rendered,
  );
}

export const calloutModule = defineModule({
  name: "callout",
  nodes: [
    {
      name: "callout",
      spec: { content: "block+", group: "block", defining: true },
      attrs: { variant: optional(z.enum(calloutVariants), "info") },
      html: (node, renderer) => {
        const variant = attrOf<string>(node, "variant");
        return element(
          "aside",
          {
            class: "ph-callout",
            "data-variant": variant,
            role: "note",
            "aria-label": renderer.calloutLabel(variant),
          },
          renderer.children(node),
        );
      },
      markdown: (node, renderer) => {
        const alert = ALERTS[attrOf<string>(node, "variant")] ?? "NOTE";
        return prefixLines(`[!${alert}]\n${renderer.blocks(node)}`, "> ", "> ");
      },
    },
  ],
});

export const expandModule = defineModule({
  name: "expand",
  nodes: [
    {
      name: "expand",
      spec: { content: "block+", group: "block", defining: true },
      attrs: { title: optional(z.string().max(500), "") },
      html: (node, renderer) =>
        element(
          "details",
          { class: "ph-expand" },
          `${element("summary", {}, renderer.escape(attrOf<string>(node, "title")))}${element("div", {}, renderer.children(node))}`,
        ),
      markdown: (node, renderer) =>
        `<details>\n<summary>${escapeHtml(attrOf<string>(node, "title"))}</summary>\n\n${renderer.blocks(node)}\n\n</details>`,
      text: (node) => attrOf<string>(node, "title"),
    },
  ],
});

export const statusModule = defineModule({
  name: "status",
  nodes: [
    {
      name: "status",
      spec: { inline: true, group: "inline", atom: true },
      attrs: {
        text: required(
          z
            .string()
            .max(40)
            .refine((value) => value.trim().length > 0, "A status needs a text"),
        ),
        color: optional(colorValue, "gray"),
      },
      html: (node, renderer) =>
        element(
          "span",
          { class: "ph-status", "data-color": attrOf<string>(node, "color") },
          renderer.escape(attrOf<string>(node, "text")),
        ),
      markdown: (node, renderer) => `**${renderer.escape(attrOf<string>(node, "text"))}**`,
      text: (node) => attrOf<string>(node, "text"),
    },
  ],
});

function tocTree(headings: readonly Heading[], maxLevel: number): Heading[] {
  return headings.filter((heading) => heading.level <= maxLevel);
}

function tocHtml(headings: Heading[], escapeText: (text: string) => string): string {
  if (headings.length === 0) return "";
  const minimum = Math.min(...headings.map((heading) => heading.level));
  let html = "<ul>";
  let depth = minimum;
  let open = false;
  for (const heading of headings) {
    const level = Math.max(heading.level, minimum);
    if (level > depth) {
      html += "<ul>".repeat(level - depth);
      depth = level;
    } else {
      if (open) html += "</li>";
      while (level < depth) {
        html += "</ul></li>";
        depth -= 1;
      }
    }
    html += `<li><a href="#${escapeText(heading.id)}">${escapeText(heading.text)}</a>`;
    open = true;
  }
  if (open) html += "</li>";
  while (depth > minimum) {
    html += "</ul></li>";
    depth -= 1;
  }
  return `${html}</ul>`;
}

export const tableOfContentsModule = defineModule({
  name: "tableOfContents",
  nodes: [
    {
      name: "tableOfContents",
      spec: { group: "block", atom: true },
      attrs: { maxLevel: optional(z.number().int().min(1).max(6), 3) },
      html: (node, renderer) =>
        element(
          "nav",
          { class: "ph-toc", "aria-label": renderer.label("tableOfContents") },
          tocHtml(tocTree(renderer.headings, attrOf<number>(node, "maxLevel")), renderer.escape),
        ),
      markdown: (node, renderer) => {
        const headings = tocTree(renderer.headings, attrOf<number>(node, "maxLevel"));
        if (headings.length === 0) return "";
        const minimum = Math.min(...headings.map((heading) => heading.level));
        return headings
          .map(
            (heading) =>
              `${"  ".repeat(heading.level - minimum)}- [${renderer.escape(heading.text)}](${markdownUrl(`#${heading.id}`)})`,
          )
          .join("\n");
      },
    },
  ],
});

export const columnsModule = defineModule({
  name: "columns",
  nodes: [
    {
      name: "columns",
      spec: { content: "column{2,4}", group: "block", isolating: true },
      validate: (node) => {
        const total = node.content.reduce((sum, column) => sum + attrOf<number>(column, "width"), 0);
        return Math.abs(total - 100) <= 1 ? null : "The widths of the columns must add up to 100";
      },
      html: (node, renderer) =>
        element("div", { class: "ph-columns", "data-count": node.content.length }, renderer.children(node)),
      markdown: (node, renderer) => renderer.blocks(node),
    },
    {
      name: "column",
      spec: { content: "block+", isolating: true },
      attrs: { width: optional(z.number().int().min(5).max(95), 50) },
      html: (node, renderer) =>
        element(
          "div",
          { class: "ph-column", "data-width": attrOf<number>(node, "width") },
          renderer.children(node),
        ),
      markdown: (node, renderer) => renderer.blocks(node),
    },
  ],
});

const latexValue = z.string().max(MAX_LATEX_LENGTH);

export const mathModule = defineModule({
  name: "math",
  nodes: [
    {
      name: "inlineMath",
      spec: { inline: true, group: "inline", atom: true },
      attrs: { latex: required(latexValue) },
      html: (node, renderer) => renderMath(attrOf<string>(node, "latex"), false, renderer),
      markdown: (node) => `$${inlineCode(attrOf<string>(node, "latex").replace(/\s*\n\s*/g, " "))}$`,
      text: (node) => attrOf<string>(node, "latex"),
    },
    {
      name: "blockMath",
      spec: { group: "block", atom: true },
      attrs: { latex: required(latexValue) },
      html: (node, renderer) => renderMath(attrOf<string>(node, "latex"), true, renderer),
      markdown: (node) => {
        const latex = attrOf<string>(node, "latex");
        const fence = fenceFor(latex);
        return `${fence}math\n${latex}\n${fence}`;
      },
      text: (node) => attrOf<string>(node, "latex"),
    },
  ],
});

export const unsupportedMacroModule = defineModule({
  name: "unsupportedMacro",
  nodes: [
    {
      name: "unsupportedMacro",
      spec: { group: "block", atom: true },
      attrs: {
        name: required(z.string().min(1).max(200)),
        data: optional(
          z
            .json()
            .refine(
              (value) => encoder.encode(JSON.stringify(value) ?? "").length <= MAX_MACRO_DATA_BYTES,
              "The macro data is too large",
            ),
          null,
        ),
      },
      html: (node, renderer) => {
        const name = attrOf<string>(node, "name");
        return element(
          "div",
          { class: "ph-unsupported-macro", "data-macro": name },
          element("p", {}, renderer.escape(renderer.label("unsupportedMacro", { name }))),
        );
      },
      markdown: (node, renderer) =>
        `> ${renderer.escape(renderer.label("unsupportedMacro", { name: attrOf<string>(node, "name") }))}`,
    },
  ],
});
