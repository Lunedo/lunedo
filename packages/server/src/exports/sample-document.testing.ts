import type { DocumentJson, NodeJson } from "@pagehall/editor-schema";

export const SAMPLE_PAGE = "01929b1e-0000-7000-8000-000000000a01";
export const SAMPLE_PERSON = "01929b1e-0000-7000-8000-000000000a02";
export const SAMPLE_IMAGE = "01929b1e-0000-7000-8000-000000000a03";
export const SAMPLE_FILE = "01929b1e-0000-7000-8000-000000000a04";
export const SAMPLE_TOPIC = "01929b1e-0000-7000-8000-000000000a05";
export const SAMPLE_TASK = "01929b1e-0000-7000-8000-000000000a06";

function text(value: string, marks: NodeJson["marks"] = []): NodeJson {
  return { type: "text", text: value, ...(marks.length > 0 ? { marks } : {}) };
}

function paragraph(...content: NodeJson[]): NodeJson {
  return { type: "paragraph", content };
}

function cell(
  type: "tableCell" | "tableHeader",
  value: string,
  attrs: Record<string, unknown> = {},
): NodeJson {
  return { type, attrs, content: [paragraph(text(value))] };
}

export function sampleDocument(): DocumentJson {
  return {
    type: "doc",
    content: [
      { type: "tableOfContents", attrs: { minLevel: 1, maxLevel: 3 } },
      { type: "heading", attrs: { level: 1 }, content: [text("Network guide")] },
      paragraph(
        text("Bold", [{ type: "bold" }]),
        text(" italic", [{ type: "italic" }]),
        text(" underline", [{ type: "underline" }]),
        text(" strike", [{ type: "strike" }]),
        text(" sub", [{ type: "subscript" }]),
        text(" sup", [{ type: "superscript" }]),
        text(" code", [{ type: "code" }]),
        text(" red", [{ type: "textColor", attrs: { color: "red" } }]),
        text(" marked", [{ type: "highlight", attrs: { color: "yellow" } }]),
        text(" commented", [{ type: "inlineComment", attrs: { threadId: SAMPLE_TASK } }]),
        text(" WireGuard", [{ type: "link", attrs: { href: "https://www.wireguard.com" } }]),
        { type: "hardBreak" },
        { type: "mention", attrs: { id: SAMPLE_PERSON } },
        text(" "),
        { type: "pageLink", attrs: { pageId: SAMPLE_PAGE } },
        text(" "),
        { type: "emoji", attrs: { emoji: "🚀" } },
        text(" "),
        { type: "date", attrs: { date: "2026-10-16" } },
        text(" "),
        { type: "status", attrs: { text: "Done", color: "green" } },
        text(" "),
        { type: "inlineMath", attrs: { latex: "E=mc^2" } },
        text(" "),
        { type: "templateField", attrs: { field: "site" } },
        { type: "placeholder", attrs: { text: "Describe the site" } },
      ),
      { type: "heading", attrs: { level: 2 }, content: [text("Sites")] },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [cell("tableHeader", "Site", { colspan: 2 }), cell("tableHeader", "Uplink")],
          },
          {
            type: "tableRow",
            content: [
              cell("tableCell", "Graz", { rowspan: 2, background: "blue" }),
              cell("tableCell", "Core"),
              cell("tableCell", "10G"),
            ],
          },
          { type: "tableRow", content: [cell("tableCell", "Access"), cell("tableCell", "1G")] },
        ],
      },
      { type: "codeBlock", attrs: { language: "bash" }, content: [text("wg-quick up wg0\nwg show")] },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              paragraph(text("Switches")),
              {
                type: "orderedList",
                attrs: { start: 3 },
                content: [{ type: "listItem", content: [paragraph(text("Core"))] }],
              },
            ],
          },
        ],
      },
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { id: SAMPLE_TASK, assignee: SAMPLE_PERSON, dueDate: "2026-10-20" },
            content: [paragraph(text("Order cables"))],
          },
        ],
      },
      { type: "blockquote", content: [paragraph(text("Measure twice"))] },
      { type: "horizontalRule" },
      { type: "image", attrs: { attachmentId: SAMPLE_IMAGE, alt: "Rack", width: 120, align: "center" } },
      { type: "file", attrs: { attachmentId: SAMPLE_FILE, name: "plan.pdf" } },
      { type: "attachmentList", attrs: { fileTypes: [] } },
      { type: "childPages", attrs: { pageId: null, depth: 1, sort: "tree", reverse: false } },
      { type: "callout", attrs: { variant: "warning" }, content: [paragraph(text("Mind the gap"))] },
      { type: "expand", attrs: { title: "Details" }, content: [paragraph(text("Inside"))] },
      {
        type: "columns",
        content: [
          { type: "column", attrs: { width: 40 }, content: [paragraph(text("Left"))] },
          { type: "column", attrs: { width: 60 }, content: [paragraph(text("Right"))] },
        ],
      },
      { type: "blockMath", attrs: { latex: "\\sum_{i=1}^n i" } },
      { type: "section", attrs: { key: "steps", title: "Steps" }, content: [paragraph(text("First step"))] },
      { type: "templateButton", attrs: { templateId: "builtin:how-to", label: "New site", title: "" } },
      { type: "topicUpdate", attrs: { topicId: SAMPLE_TOPIC }, content: [paragraph(text("Topic news"))] },
      { type: "decision", attrs: { id: null, topicId: null }, content: [paragraph(text("Use WireGuard"))] },
      { type: "pageReport", attrs: {} },
      { type: "decisionReport", attrs: {} },
      { type: "taskReport", attrs: {} },
      { type: "unsupportedMacro", attrs: { name: "jira" } },
      {
        type: "drawing",
        attrs: {
          id: SAMPLE_TASK,
          sceneId: SAMPLE_FILE,
          sceneVersion: 1,
          previewId: SAMPLE_IMAGE,
          previewVersion: 1,
          text: "Rack sketch",
        },
      },
    ],
  };
}

export function sampleTypes(node: NodeJson, into = new Set<string>()): Set<string> {
  into.add(node.type);
  for (const mark of node.marks ?? []) into.add(mark.type);
  for (const child of node.content ?? []) sampleTypes(child, into);
  return into;
}
