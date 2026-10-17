import { z } from "zod";
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
    { class: "ph-tabs-list", role: "tablist" },
    tabs
      .map((tab, index) =>
        element(
          "button",
          {
            type: "button",
            role: "tab",
            class: "ph-tab-button",
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
        { class: "ph-tab", "data-index": index },
        `${element(
          "button",
          {
            type: "button",
            class: "ph-tab-toggle",
            "data-index": index,
            "aria-expanded": index === 0 ? "true" : "false",
          },
          renderer.escape(attrOf<string>(tab, "title")),
        )}${element(
          "div",
          {
            class: "ph-tab-panel",
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
  return element("div", { class: "ph-tabs" }, `${list}${panels}`);
}

function tabsPrint(node: ValidNode, renderer: HtmlRenderer): string {
  return element(
    "div",
    { class: "ph-tabs ph-tabs-print" },
    node.content
      .map((tab) =>
        element(
          "section",
          { class: "ph-tab" },
          `${element("h4", { class: "ph-tab-title" }, renderer.escape(attrOf<string>(tab, "title")))}${renderer.children(tab)}`,
        ),
      )
      .join(""),
  );
}

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
});
