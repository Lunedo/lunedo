import { z } from "zod";
import type { ValidNode } from "../json.js";
import { attrOf, defineModule, type MarkdownRenderer, optional } from "../module.js";
import { element, prefixLines } from "../text.js";
import { isoDateValue, uuidValue } from "../values.js";

const LIST_TYPES = new Set(["bulletList", "orderedList", "taskList"]);

function itemMarkdown(item: ValidNode, renderer: MarkdownRenderer, marker: string): string {
  const parts: string[] = [];
  item.content.forEach((child, index) => {
    const rendered = renderer.render(child);
    if (index === 0) {
      parts.push(rendered);
      return;
    }
    const separator = LIST_TYPES.has(child.type) ? "\n" : "\n\n";
    parts.push(separator, rendered);
  });
  return prefixLines(parts.join(""), marker);
}

function listMarkdown(node: ValidNode, renderer: MarkdownRenderer, marker: (index: number) => string) {
  return node.content.map((item, index) => itemMarkdown(item, renderer, marker(index))).join("\n");
}

export const listsModule = defineModule({
  name: "lists",
  nodes: [
    {
      name: "bulletList",
      spec: { content: "listItem+", group: "block" },
      html: (node, renderer) => element("ul", {}, renderer.children(node)),
      markdown: (node, renderer) => listMarkdown(node, renderer, () => "- "),
    },
    {
      name: "orderedList",
      spec: { content: "listItem+", group: "block" },
      attrs: { start: optional(z.number().int().min(1).max(1_000_000_000), 1) },
      html: (node, renderer) => {
        const start = attrOf<number>(node, "start");
        return element("ol", { start: start === 1 ? null : start }, renderer.children(node));
      },
      markdown: (node, renderer) => {
        const start = attrOf<number>(node, "start");
        return listMarkdown(node, renderer, (index) => `${start + index}. `);
      },
    },
    {
      name: "listItem",
      spec: { content: "paragraph block*", defining: true },
      html: (node, renderer) => element("li", {}, renderer.children(node)),
      markdown: (node, renderer) => itemMarkdown(node, renderer, "- "),
    },
  ],
});

export const tasksModule = defineModule({
  name: "tasks",
  nodes: [
    {
      name: "taskList",
      spec: { content: "taskItem+", group: "block" },
      html: (node, renderer) => element("ul", { class: "ph-task-list" }, renderer.children(node)),
      markdown: (node, renderer) =>
        node.content
          .map((item) => itemMarkdown(item, renderer, attrOf<boolean>(item, "checked") ? "- [x] " : "- [ ] "))
          .join("\n"),
    },
    {
      name: "taskItem",
      spec: { content: "paragraph block*", defining: true },
      attrs: {
        checked: optional(z.boolean(), false),
        assignee: optional(uuidValue.nullable(), null),
        dueDate: optional(isoDateValue.nullable(), null),
      },
      html: (node, renderer) => {
        const checked = attrOf<boolean>(node, "checked");
        return element(
          "li",
          {
            class: "ph-task-item",
            "data-checked": checked ? "true" : "false",
            "data-assignee": attrOf<string | null>(node, "assignee"),
            "data-due-date": attrOf<string | null>(node, "dueDate"),
          },
          `<input type="checkbox" disabled aria-label="${renderer.escape(renderer.label(checked ? "taskDone" : "taskOpen"))}"${checked ? " checked" : ""}>${element("div", {}, renderer.children(node))}`,
        );
      },
      markdown: (node, renderer) =>
        itemMarkdown(node, renderer, attrOf<boolean>(node, "checked") ? "- [x] " : "- [ ] "),
    },
  ],
});
