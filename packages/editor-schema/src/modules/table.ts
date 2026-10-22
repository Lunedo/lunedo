import { z } from "zod";
import type { ValidNode } from "../json.js";
import {
  attrOf,
  defineModule,
  type MarkdownRenderer,
  type NodeDefinition,
  optional,
  type WordRenderer,
} from "../module.js";
import { element } from "../text.js";
import { type ContentColor, colorValue } from "../values.js";
import type { WordTableRow } from "../word.js";

const cellAttributes = {
  colspan: optional(z.number().int().min(1).max(1000), 1),
  rowspan: optional(z.number().int().min(1).max(1000), 1),
  colwidth: optional(z.array(z.number().int().min(1).max(100_000)).max(1000).nullable(), null),
  background: optional(colorValue.nullable(), null),
};

function validateCell(node: ValidNode): string | null {
  const widths = attrOf<number[] | null>(node, "colwidth");
  if (widths !== null && widths.length !== attrOf<number>(node, "colspan")) {
    return "A cell needs one column width per spanned column";
  }
  return null;
}

function cell(name: "tableCell" | "tableHeader", tag: "td" | "th"): NodeDefinition {
  return {
    name,
    spec: {
      content: "block+",
      tableRole: name === "tableCell" ? "cell" : "header_cell",
      isolating: true,
    },
    attrs: cellAttributes,
    validate: validateCell,
    html: (node, renderer) => {
      const colspan = attrOf<number>(node, "colspan");
      const rowspan = attrOf<number>(node, "rowspan");
      const widths = attrOf<number[] | null>(node, "colwidth");
      return element(
        tag,
        {
          colspan: colspan === 1 ? null : colspan,
          rowspan: rowspan === 1 ? null : rowspan,
          "data-colwidth": widths ? widths.join(",") : null,
          "data-background": attrOf<string | null>(node, "background"),
        },
        renderer.children(node),
      );
    },
    word: (node, renderer) => renderer.blocks(node),
    markdown: (node, renderer) => renderer.blocks(node),
  };
}

function tableRows(rows: readonly ValidNode[], renderer: WordRenderer): WordTableRow[] {
  return rows.map((row) => ({
    cells: row.content.map((cell) => {
      const widths = attrOf<number[] | null>(cell, "colwidth");
      return {
        header: cell.type === "tableHeader",
        colspan: attrOf<number>(cell, "colspan"),
        rowspan: attrOf<number>(cell, "rowspan"),
        width: widths ? widths.reduce((sum, width) => sum + width, 0) : null,
        background: attrOf<ContentColor | null>(cell, "background"),
        content: renderer.blocks(cell),
      };
    }),
  }));
}

function isSimpleCell(node: ValidNode): boolean {
  return (
    attrOf<number>(node, "colspan") === 1 &&
    attrOf<number>(node, "rowspan") === 1 &&
    node.content.length === 1 &&
    node.content[0]?.type === "paragraph"
  );
}

function pipeTable(node: ValidNode, renderer: MarkdownRenderer): string | null {
  const rows = node.content;
  const [header, ...body] = rows;
  if (!header || header.content.length === 0) return null;
  if (!header.content.every((cell) => cell.type === "tableHeader")) return null;
  const width = header.content.length;
  for (const row of rows) {
    if (row.content.length !== width || !row.content.every(isSimpleCell)) return null;
  }
  const line = (row: ValidNode) =>
    `| ${row.content.map((cell) => renderer.blocks(cell).replace(/\n/g, " ")).join(" | ")} |`;
  return [line(header), `|${" --- |".repeat(width)}`, ...body.map(line)].join("\n");
}

export const tableModule = defineModule({
  name: "table",
  nodes: [
    {
      name: "table",
      spec: { content: "tableRow+", tableRole: "table", isolating: true, group: "block" },
      html: (node, renderer) =>
        element(
          "div",
          { class: "ld-table" },
          element("table", {}, element("tbody", {}, renderer.children(node))),
        ),
      word: (node, renderer) => [
        { type: "table", rows: tableRows(node.content, renderer), borderless: false },
      ],
      markdown: (node, renderer) => pipeTable(node, renderer) ?? renderer.html(node),
    },
    {
      name: "tableRow",
      spec: { content: "(tableCell | tableHeader)*", tableRole: "row" },
      html: (node, renderer) => element("tr", {}, renderer.children(node)),
      word: (node, renderer) => [{ type: "table", rows: tableRows([node], renderer), borderless: false }],
      markdown: (node, renderer) => renderer.html(node),
    },
    cell("tableCell", "td"),
    cell("tableHeader", "th"),
  ],
});
