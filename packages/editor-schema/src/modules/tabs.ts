import { z } from "zod";
import {
  bodyBlocks,
  type MacroConverter,
  type MacroImportContext,
  macroText,
  richBody,
  type SourceContent,
  type SourceElement,
  singleLine,
  titleParagraph,
} from "../importing.js";
import type { NodeJson, ValidNode } from "../json.js";
import { attrOf, defineModule, type HtmlRenderer, optional } from "../module.js";
import { element } from "../text.js";
import { wordText } from "../word.js";

export const MAX_TABS = 20;
export const MAX_TAB_TITLE = 100;

const tabTitleValue = z
  .string()
  .min(1)
  .max(MAX_TAB_TITLE)
  .refine(
    (value) => value.trim() === value && value.length > 0,
    "Expected a name without leading or trailing spaces",
  );

export function cleanTabTitle(value: string, fallback: string): string {
  const title = value.replace(/\s+/g, " ").trim().slice(0, MAX_TAB_TITLE).trim();
  return title.length > 0 ? title : fallback;
}

function containsTabs(nodes: readonly { type: string; content?: readonly unknown[] }[]): boolean {
  return nodes.some(
    (child) => child.type === "tabs" || containsTabs((child.content ?? []) as readonly NodeJson[]),
  );
}

function tabsHtml(node: ValidNode, renderer: HtmlRenderer): string {
  const tabs = node.content;
  const list = element(
    "div",
    { class: "ld-tabs-list", role: "tablist" },
    tabs
      .map((tab, index) =>
        element(
          "button",
          {
            type: "button",
            role: "tab",
            class: "ld-tab-button",
            "data-index": index,
            "aria-selected": index === 0 ? "true" : "false",
            tabindex: index === 0 ? "0" : "-1",
          },
          renderer.escape(attrOf<string>(tab, "title")),
        ),
      )
      .join(""),
  );
  const panels = tabs
    .map((tab, index) =>
      element(
        "section",
        { class: "ld-tab", "data-index": index },
        `${element(
          "button",
          {
            type: "button",
            class: "ld-tab-toggle",
            "data-index": index,
            "aria-expanded": index === 0 ? "true" : "false",
          },
          renderer.escape(attrOf<string>(tab, "title")),
        )}${element(
          "div",
          {
            class: "ld-tab-panel",
            role: "tabpanel",
            tabindex: "0",
            "data-index": index,
            hidden: index !== 0,
          },
          renderer.children(tab),
        )}`,
      ),
    )
    .join("");
  return element("div", { class: "ld-tabs" }, `${list}${panels}`);
}

function tabsPrint(node: ValidNode, renderer: HtmlRenderer): string {
  return element(
    "div",
    { class: "ld-tabs ld-tabs-print" },
    node.content
      .map((tab) =>
        element(
          "section",
          { class: "ld-tab" },
          `${element("h4", { class: "ld-tab-title" }, renderer.escape(attrOf<string>(tab, "title")))}${renderer.children(tab)}`,
        ),
      )
      .join(""),
  );
}

const MACRO_ELEMENTS = new Set(["ac:structured-macro", "ac:macro"]);

function isMacro(content: SourceContent, names: ReadonlySet<string>): content is SourceElement {
  return (
    typeof content !== "string" &&
    MACRO_ELEMENTS.has(content.name) &&
    names.has(content.attributes["ac:name"] ?? "")
  );
}

function blank(content: SourceContent): boolean {
  if (typeof content === "string") return content.trim().length === 0;
  return content.name === "p" && content.children.every(blank);
}

export function auraParams(macro: SourceElement): Record<string, unknown> | null {
  const raw = macroText(macro, "params");
  if (!raw || raw.length > 20_000) return null;
  try {
    const decoded = decodeURIComponent(atob(raw));
    const value = JSON.parse(decoded) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function titleOf(macro: SourceElement, parameters: readonly string[]): string {
  for (const name of parameters) {
    const value = singleLine(macroText(macro, name));
    if (value.length > 0) return value;
  }
  const params = auraParams(macro);
  return typeof params?.title === "string" ? singleLine(params.title) : "";
}

function tab(title: string, index: number, content: NodeJson[]): NodeJson {
  return {
    type: "tab",
    attrs: { title: cleanTabTitle(title, `Tab ${index + 1}`) },
    content: content.length > 0 ? content : [{ type: "paragraph" }],
  };
}

function tabsOf(tabs: NodeJson[]): NodeJson[] | null {
  if (tabs.length === 0 || tabs.length > MAX_TABS) return null;
  return [{ type: "tabs", content: tabs }];
}

interface NestedFamily {
  readonly containers: readonly string[];
  readonly tabs: readonly string[];
  readonly title: readonly string[];
}

const NESTED_FAMILIES: readonly NestedFamily[] = [
  { containers: ["deck"], tabs: ["card"], title: ["label", "title"] },
  { containers: ["localtabgroup"], tabs: ["localtab"], title: ["title"] },
  { containers: ["auitabs"], tabs: ["auitabspage"], title: ["title"] },
  { containers: ["ui-tabs"], tabs: ["ui-tab"], title: ["title"] },
  { containers: ["tabs-group"], tabs: ["tab-pane"], title: ["name", "title"] },
  { containers: ["horizontal-nav-group"], tabs: ["horizontal-nav-item"], title: ["name", "title"] },
  { containers: ["vertical-nav-group"], tabs: ["vertical-nav-item"], title: ["name", "title"] },
];

function nestedImporter(family: NestedFamily): MacroConverter {
  const tabNames = new Set(family.tabs);
  return {
    source: "confluence",
    macros: family.containers,
    convert: (macro, context) => {
      const body = richBody(macro);
      if (!body) return null;
      const tabs: NodeJson[] = [];
      for (const child of body.children) {
        if (blank(child)) continue;
        if (!isMacro(child, tabNames)) return null;
        tabs.push(tab(titleOf(child, family.title), tabs.length, bodyBlocks(child, context)));
      }
      return tabsOf(tabs);
    },
  };
}

interface FlatFamily {
  readonly containers: readonly string[];
  readonly markers: readonly string[];
  readonly title: readonly string[];
}

const FLAT_FAMILIES: readonly FlatFamily[] = [
  { containers: ["aura-tab-collection"], markers: ["aura-tab"], title: ["summary", "title"] },
  { containers: ["rw-ui-tabs-macro"], markers: ["rw-tab"], title: ["title"] },
  { containers: ["refined-tabs"], markers: ["refined-tab"], title: ["title"] },
];

function flatImporter(family: FlatFamily): MacroConverter {
  const markers = new Set(family.markers);
  return {
    source: "confluence",
    macros: family.containers,
    convert: (macro, context) => {
      const body = richBody(macro);
      if (!body) return null;
      const sections: { title: string; content: SourceContent[] }[] = [];
      for (const child of body.children) {
        if (isMacro(child, markers)) {
          sections.push({ title: titleOf(child, family.title), content: [] });
          continue;
        }
        const current = sections.at(-1);
        if (!current) {
          if (blank(child)) continue;
          return null;
        }
        current.content.push(child);
      }
      return tabsOf(
        sections.map((section, index) => tab(section.title, index, context.blocks(section.content))),
      );
    },
  };
}

const deckContainerImporter: MacroConverter = {
  source: "confluence",
  macros: ["deck-container"],
  convert: (macro, context) => bodyBlocks(macro, context),
};

function panelImporter(macros: readonly string[], title: readonly string[]): MacroConverter {
  return {
    source: "confluence",
    macros,
    convert: (macro, context: MacroImportContext) => [
      {
        type: "callout",
        attrs: { variant: "info" },
        content: [...titleParagraph(titleOf(macro, title)), ...bodyBlocks(macro, context)],
      },
    ],
  };
}

const expandImporter: MacroConverter = {
  source: "confluence",
  macros: ["ui-expand"],
  convert: (macro, context) => [
    {
      type: "expand",
      attrs: { title: singleLine(macroText(macro, "title")).slice(0, 500) },
      content: bodyBlocks(macro, context),
    },
  ],
};

function columnWidths(columns: readonly SourceElement[]): number[] {
  const percent = columns.map((column) =>
    /^(\d{1,2})(?:\.\d+)?%$/.exec(singleLine(macroText(column, "width"))),
  );
  if (percent.every((match) => match !== null)) {
    const values = percent.map((match) => Number(match?.[1]));
    const total = values.reduce((sum, value) => sum + value, 0);
    if (total > 0 && values.every((value) => value >= 5)) {
      const scaled = values.map((value) => Math.max(5, Math.min(95, Math.round((value * 100) / total))));
      const drift = 100 - scaled.reduce((sum, value) => sum + value, 0);
      scaled[scaled.length - 1] = (scaled.at(-1) ?? 0) + drift;
      if (scaled.every((value) => value >= 5 && value <= 95)) return scaled;
    }
  }
  const even = Math.floor(100 / columns.length);
  return columns.map((_, index) => (index === columns.length - 1 ? 100 - even * (columns.length - 1) : even));
}

const sectionImporter: MacroConverter = {
  source: "confluence",
  macros: ["section"],
  convert: (macro, context) => {
    const body = richBody(macro);
    if (!body) return null;
    const columns: SourceElement[] = [];
    for (const child of body.children) {
      if (blank(child)) continue;
      if (!isMacro(child, new Set(["column"]))) return null;
      columns.push(child);
    }
    if (columns.length === 1) return bodyBlocks(columns[0] as SourceElement, context);
    if (columns.length < 2 || columns.length > 4) return null;
    const widths = columnWidths(columns);
    return [
      {
        type: "columns",
        content: columns.map((column, index) => ({
          type: "column",
          attrs: { width: widths[index] },
          content: bodyBlocks(column, context),
        })),
      },
    ];
  },
};

export const tabImporters: readonly MacroConverter[] = [
  ...NESTED_FAMILIES.map(nestedImporter),
  ...FLAT_FAMILIES.map(flatImporter),
  deckContainerImporter,
  panelImporter(["aura-panel"], ["summary", "title"]),
  panelImporter(["roundrect"], ["title"]),
  expandImporter,
  sectionImporter,
];

export const tabsModule = defineModule({
  name: "tabs",
  nodes: [
    {
      name: "tabs",
      spec: { content: "tab+", group: "block", isolating: true, defining: true },
      validate: (node) => {
        if (node.content.length > MAX_TABS) return `A tabs block holds at most ${MAX_TABS} tabs`;
        return node.content.some((tab) => containsTabs(tab.content))
          ? "Tabs cannot contain another tabs block"
          : null;
      },
      html: tabsHtml,
      print: tabsPrint,
      word: (node, renderer) =>
        node.content.flatMap((tab) => [
          {
            type: "heading" as const,
            level: 4,
            anchor: "",
            content: [wordText(attrOf<string>(tab, "title"))],
          },
          ...renderer.blocks(tab),
        ]),
      markdown: (node, renderer) =>
        node.content
          .map((tab) => `#### ${renderer.escape(attrOf<string>(tab, "title"))}\n\n${renderer.blocks(tab)}`)
          .join("\n\n"),
    },
    {
      name: "tab",
      spec: { content: "block+", isolating: true, defining: true },
      attrs: { title: optional(tabTitleValue, "Tab") },
      html: (node, renderer) => renderer.children(node),
      word: (node, renderer) => renderer.blocks(node),
      markdown: (node, renderer) => renderer.blocks(node),
      text: (node) => attrOf<string>(node, "title"),
    },
  ],
  importers: tabImporters,
});
