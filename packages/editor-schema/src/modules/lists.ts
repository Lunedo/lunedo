import { z } from "zod";
import type { ValidNode } from "../json.js";
import {
  attrOf,
  defineModule,
  type HtmlRenderer,
  type MarkdownRenderer,
  optional,
  type RenderContext,
} from "../module.js";
import { element, prefixLines } from "../text.js";
import { isoDateValue, uuidValue } from "../values.js";

const LIST_TYPES = new Set(["bulletList", "orderedList", "taskList"]);

function itemMarkdown(item: ValidNode, renderer: MarkdownRenderer, marker: string, suffix = ""): string {
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
  parts.push(suffix);
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

function taskDone(node: ValidNode, renderer: { readonly context: RenderContext }): boolean {
  const id = attrOf<string | null>(node, "id");
  return id === null ? false : (renderer.context.taskStatus?.(id) ?? false);
}

function taskMarkdown(node: ValidNode, renderer: MarkdownRenderer): string {
  const assignee = attrOf<string | null>(node, "assignee");
  const dueDate = attrOf<string | null>(node, "dueDate");
  const meta = [
    ...(assignee ? [renderer.escape(`@${renderer.mentionName(assignee)}`)] : []),
    ...(dueDate ? [renderer.escape(renderer.formatDate(dueDate))] : []),
  ];
  const suffix = meta.length > 0 ? ` ${meta.join(" ")}` : "";
  return itemMarkdown(node, renderer, taskDone(node, renderer) ? "- [x] " : "- [ ] ", suffix);
}

function taskMeta(node: ValidNode, renderer: HtmlRenderer): string {
  const assignee = attrOf<string | null>(node, "assignee");
  const dueDate = attrOf<string | null>(node, "dueDate");
  const parts = [
    assignee
      ? element(
          "span",
          { class: "ph-task-assignee", "data-account-id": assignee },
          renderer.escape(`@${renderer.mentionName(assignee)}`),
        )
      : "",
    dueDate
      ? element(
          "time",
          { class: "ph-task-due", datetime: dueDate },
          renderer.escape(renderer.formatDate(dueDate)),
        )
      : "",
  ].join("");
  return parts ? element("span", { class: "ph-task-meta" }, parts) : "";
}

export const tasksModule = defineModule({
  name: "tasks",
  nodes: [
    {
      name: "taskList",
      spec: { content: "taskItem+", group: "block" },
      html: (node, renderer) => element("ul", { class: "ph-task-list" }, renderer.children(node)),
      markdown: (node, renderer) => node.content.map((item) => taskMarkdown(item, renderer)).join("\n"),
    },
    {
      name: "taskItem",
      spec: { content: "paragraph block*", defining: true },
      attrs: {
        id: optional(uuidValue.nullable(), null),
        assignee: optional(uuidValue.nullable(), null),
        dueDate: optional(isoDateValue.nullable(), null),
      },
      html: (node, renderer) => {
        const done = taskDone(node, renderer);
        return element(
          "li",
          {
            class: "ph-task-item",
            "data-checked": done ? "true" : "false",
            "data-task-id": attrOf<string | null>(node, "id"),
            "data-assignee": attrOf<string | null>(node, "assignee"),
            "data-due-date": attrOf<string | null>(node, "dueDate"),
          },
          `<input type="checkbox" disabled aria-label="${renderer.escape(renderer.label(done ? "taskDone" : "taskOpen"))}"${done ? " checked" : ""}>${element("div", {}, `${renderer.children(node)}${taskMeta(node, renderer)}`)}`,
        );
      },
      markdown: (node, renderer) => taskMarkdown(node, renderer),
    },
  ],
});
