import type { CalloutVariant, ContentColor, DocumentJson, NodeJson } from "@pagehall/editor-schema";

export type Inline = string | NodeJson;
export type Cell = Inline | Inline[];

function inlineContent(parts: readonly Inline[]): NodeJson[] {
  return parts
    .filter((part) => part !== "")
    .map((part) => (typeof part === "string" ? { type: "text", text: part } : part));
}

function cellParts(cell: Cell): Inline[] {
  return Array.isArray(cell) ? cell : [cell];
}

export function doc(...content: NodeJson[]): DocumentJson {
  return { type: "doc", content };
}

export function heading(level: 2 | 3, text: string): NodeJson {
  return { type: "heading", attrs: { level }, content: inlineContent([text]) };
}

export function paragraph(...parts: Inline[]): NodeJson {
  const content = inlineContent(parts);
  return content.length === 0 ? { type: "paragraph" } : { type: "paragraph", content };
}

export function placeholder(text: string): NodeJson {
  return { type: "placeholder", attrs: { text } };
}

export function hint(text: string): NodeJson {
  return paragraph(placeholder(text));
}

export function field(key: string): NodeJson {
  return { type: "templateField", attrs: { field: key } };
}

export function bold(text: string): NodeJson {
  return { type: "text", text, marks: [{ type: "bold" }] };
}

export function status(text: string, color: ContentColor): NodeJson {
  return { type: "status", attrs: { text, color } };
}

function listItems(type: "listItem" | "taskItem", items: readonly Cell[]): NodeJson[] {
  return items.map((item) => ({ type, content: [paragraph(...cellParts(item))] }));
}

export function bulletList(...items: Cell[]): NodeJson {
  return { type: "bulletList", content: listItems("listItem", items) };
}

export function orderedList(...items: Cell[]): NodeJson {
  return { type: "orderedList", content: listItems("listItem", items) };
}

export function taskList(...items: Cell[]): NodeJson {
  return { type: "taskList", content: listItems("taskItem", items) };
}

function tableCell(type: "tableHeader" | "tableCell", cell: Cell): NodeJson {
  return { type, content: [paragraph(...cellParts(cell))] };
}

export function table(headers: readonly string[], ...rows: Cell[][]): NodeJson {
  return {
    type: "table",
    content: [
      { type: "tableRow", content: headers.map((header) => tableCell("tableHeader", header)) },
      ...rows.map((row) => ({ type: "tableRow", content: row.map((cell) => tableCell("tableCell", cell)) })),
    ],
  };
}

export function propertyTable(...rows: [string, Cell][]): NodeJson {
  return {
    type: "table",
    content: rows.map(([label, value]) => ({
      type: "tableRow",
      content: [tableCell("tableHeader", label), tableCell("tableCell", value)],
    })),
  };
}

export function callout(variant: CalloutVariant, ...content: NodeJson[]): NodeJson {
  return { type: "callout", attrs: { variant }, content };
}
