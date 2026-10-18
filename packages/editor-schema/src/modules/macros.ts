import katex from "katex";
import { z } from "zod";
import {
  bodyBlocks,
  boundedInteger,
  type MacroConverter,
  macroParameterNames,
  macroText,
  richBody,
  type SourceElement,
  singleLine,
  titleParagraph,
} from "../importing.js";
import type { NodeJson, ValidNode } from "../json.js";
import type { Heading, HtmlRenderer } from "../module.js";
import { attrOf, defineModule, optional, required } from "../module.js";
import { removedNode } from "../portable.js";
import { element, escapeHtml, fenceFor, inlineCode, markdownUrl, prefixLines } from "../text.js";
import { type CalloutVariant, type ContentColor, calloutVariants, colorValue } from "../values.js";
import { wordText } from "../word.js";

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

const CALLOUT_ICON =
  '<svg class="ph-callout-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>';

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

const CONFLUENCE_PANELS: Readonly<Record<string, string>> = {
  info: "info",
  tip: "tip",
  note: "warning",
  warning: "error",
};

const CONFLUENCE_STATUS_COLORS: Readonly<Record<string, string>> = {
  grey: "gray",
  gray: "gray",
  red: "red",
  yellow: "yellow",
  green: "green",
  blue: "blue",
  purple: "purple",
};

const CONFLUENCE_DEFAULT_MAX_LEVEL = 6;

const calloutImporter: MacroConverter = {
  source: "confluence",
  macros: Object.keys(CONFLUENCE_PANELS),
  convert: (macro, context) => [
    {
      type: "callout",
      attrs: { variant: CONFLUENCE_PANELS[macro.attributes["ac:name"] ?? ""] ?? "info" },
      content: [...titleParagraph(macroText(macro, "title")), ...bodyBlocks(macro, context)],
    },
  ],
};

const panelImporter: MacroConverter = {
  source: "confluence",
  macros: ["panel"],
  convert: (macro, context) => {
    for (const option of macroParameterNames(macro).sort()) {
      if (option === "title" || (macroText(macro, option) ?? "").trim().length === 0) continue;
      context.note({ code: "macroOptionDropped", macro: "panel", option });
    }
    return [
      {
        type: "callout",
        attrs: { variant: "info" },
        content: [...titleParagraph(macroText(macro, "title")), ...bodyBlocks(macro, context)],
      },
    ];
  },
};

const expandImporter: MacroConverter = {
  source: "confluence",
  macros: ["expand"],
  convert: (macro, context) => [
    {
      type: "expand",
      attrs: { title: singleLine(macroText(macro, "title")).slice(0, 500) },
      content: bodyBlocks(macro, context),
    },
  ],
};

const statusImporter: MacroConverter = {
  source: "confluence",
  macros: ["status"],
  inline: true,
  convert: (macro) => [
    {
      type: "status",
      attrs: {
        text: singleLine(macroText(macro, "title")),
        color: CONFLUENCE_STATUS_COLORS[(macroText(macro, "colour") ?? "").toLowerCase()] ?? "gray",
      },
    },
  ],
};

function levelOf(macro: SourceElement, name: string, fallback: number): number | null {
  const value = macroText(macro, name);
  if (value === null || value.length === 0) return fallback;
  const level = boundedInteger(value, 1, 7);
  return level === null ? null : Math.min(level, 6);
}

function tableOfContentsFrom(macro: SourceElement): NodeJson | null {
  if ((macroText(macro, "include") ?? "").length > 0 || (macroText(macro, "exclude") ?? "").length > 0) {
    return null;
  }
  const minLevel = levelOf(macro, "minLevel", 1);
  const maxLevel = levelOf(macro, "maxLevel", CONFLUENCE_DEFAULT_MAX_LEVEL);
  if (minLevel === null || maxLevel === null || minLevel > maxLevel) return null;
  return { type: "tableOfContents", attrs: { minLevel, maxLevel } };
}

const tableOfContentsImporters: MacroConverter[] = [
  {
    source: "confluence",
    macros: ["toc"],
    convert: (macro) => {
      const toc = tableOfContentsFrom(macro);
      return toc ? [toc] : null;
    },
  },
  {
    source: "confluence",
    macros: ["toc-zone"],
    convert: (macro, context) => {
      const toc = tableOfContentsFrom(macro);
      if (!toc) return null;
      const body = richBody(macro);
      const content = body ? context.blocks(body.children) : [];
      return macroText(macro, "location")?.toLowerCase() === "bottom" ? [...content, toc] : [toc, ...content];
    },
  },
];

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
          `${element("div", { class: "ph-callout-control" }, element("span", { class: "ph-callout-label" }, `${CALLOUT_ICON}${renderer.escape(renderer.calloutLabel(variant))}`))}${element("div", { class: "ph-callout-content" }, renderer.children(node))}`,
        );
      },
      markdown: (node, renderer) => {
        const alert = ALERTS[attrOf<string>(node, "variant")] ?? "NOTE";
        return prefixLines(`[!${alert}]\n${renderer.blocks(node)}`, "> ", "> ");
      },
      word: (node, renderer) => {
        const variant = attrOf<CalloutVariant>(node, "variant");
        return [
          {
            type: "box",
            variant,
            title: [wordText(renderer.calloutLabel(variant), { bold: true })],
            content: renderer.blocks(node),
          },
        ];
      },
    },
  ],
  importers: [calloutImporter, panelImporter],
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
      print: (node, renderer) =>
        element(
          "section",
          { class: "ph-expand" },
          `${element("p", { class: "ph-expand-title" }, renderer.escape(attrOf<string>(node, "title")))}${element("div", {}, renderer.children(node))}`,
        ),
      word: (node, renderer) => {
        const title = attrOf<string>(node, "title");
        return [
          {
            type: "box",
            variant: "neutral",
            title: title ? [wordText(title, { bold: true })] : [],
            content: renderer.blocks(node),
          },
        ];
      },
      markdown: (node, renderer) =>
        `<details>\n<summary>${escapeHtml(attrOf<string>(node, "title"))}</summary>\n\n${renderer.blocks(node)}\n\n</details>`,
      text: (node) => attrOf<string>(node, "title"),
    },
  ],
  importers: [expandImporter],
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
      word: (node) => [
        wordText(attrOf<string>(node, "text").toUpperCase(), {
          bold: true,
          highlight: attrOf<ContentColor>(node, "color"),
        }),
      ],
      markdown: (node, renderer) => `**${renderer.escape(attrOf<string>(node, "text"))}**`,
      text: (node) => attrOf<string>(node, "text"),
    },
  ],
  importers: [statusImporter],
});

function tocTree(headings: readonly Heading[], node: ValidNode): Heading[] {
  const minLevel = attrOf<number>(node, "minLevel");
  const maxLevel = attrOf<number>(node, "maxLevel");
  return headings.filter((heading) => heading.level >= minLevel && heading.level <= maxLevel);
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
      attrs: {
        minLevel: optional(z.number().int().min(1).max(6), 1),
        maxLevel: optional(z.number().int().min(1).max(6), 3),
      },
      validate: (node) =>
        attrOf<number>(node, "minLevel") > attrOf<number>(node, "maxLevel")
          ? "The lowest heading level of a table of contents must not be above its highest"
          : null,
      html: (node, renderer) =>
        element(
          "nav",
          { class: "ph-toc", "aria-label": renderer.label("tableOfContents") },
          tocHtml(tocTree(renderer.headings, node), renderer.escape),
        ),
      word: (node) => [
        {
          type: "contents",
          minLevel: attrOf<number>(node, "minLevel"),
          maxLevel: attrOf<number>(node, "maxLevel"),
        },
      ],
      markdown: (node, renderer) => {
        const headings = tocTree(renderer.headings, node);
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
  importers: tableOfContentsImporters,
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
      word: (node, renderer) => [
        {
          type: "table",
          borderless: true,
          rows: [
            {
              cells: node.content.map((column) => ({
                header: false,
                colspan: 1,
                rowspan: 1,
                width: attrOf<number>(column, "width"),
                background: null,
                content: renderer.blocks(column),
              })),
            },
          ],
        },
      ],
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
      word: (node, renderer) => renderer.blocks(node),
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
      word: (node) => [wordText(attrOf<string>(node, "latex"), { code: true })],
      markdown: (node) => `$${inlineCode(attrOf<string>(node, "latex").replace(/\s*\n\s*/g, " "))}$`,
      text: (node) => attrOf<string>(node, "latex"),
    },
    {
      name: "blockMath",
      spec: { group: "block", atom: true },
      attrs: { latex: required(latexValue) },
      html: (node, renderer) => renderMath(attrOf<string>(node, "latex"), true, renderer),
      word: (node) => [{ type: "code", text: attrOf<string>(node, "latex"), language: "latex" }],
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
      portable: removedNode("unsupportedMacro"),
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
      word: (node, renderer) => [
        {
          type: "placeholder",
          text: renderer.label("unsupportedMacro", { name: attrOf<string>(node, "name") }),
        },
      ],
      markdown: (node, renderer) =>
        `> ${renderer.escape(renderer.label("unsupportedMacro", { name: attrOf<string>(node, "name") }))}`,
    },
  ],
});
