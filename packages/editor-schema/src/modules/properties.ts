import { z } from "zod";
import { type CqlCondition, parseCql } from "../cql.js";
import {
  boundedInteger,
  isTrue,
  listValues,
  type MacroConverter,
  type MacroImportContext,
  macroSpaceKeys,
  macroText,
  richBody,
  type SourceContent,
  type SourceElement,
  singleLine,
  sourceElements,
  sourceText,
} from "../importing.js";
import type { DocumentJson, NodeJson, ValidNode } from "../json.js";
import {
  attrOf,
  defineModule,
  type HtmlRenderer,
  type MarkdownRenderer,
  optional,
  type PropertiesReport,
  type PropertiesReportRequest,
  type WordRenderer,
} from "../module.js";
import { clearedAttributes } from "../portable.js";
import { element, markdownUrl } from "../text.js";
import {
  labelsValue,
  MAX_FILTER_SPACES,
  MAX_PROPERTY_KEY_LENGTH,
  MAX_PROPERTY_SET_ID_LENGTH,
  propertyColumnsValue,
  propertyColumnValue,
  propertyKey,
  propertySetIdValue,
  spaceIdsValue,
} from "../values.js";
import { type WordBlock, type WordContent, type WordTableCell, wordText } from "../word.js";
import {
  CURRENT_SPACE_KEYS,
  IGNORED_PAGE_REPORT_PARAMETERS,
  importedLabels,
  markdownCell,
  onlyKnownParameters,
  wordNote,
} from "./reports.js";

export const MAX_PROPERTIES_REPORT_PAGE_SIZE = 100;
export const DEFAULT_PROPERTIES_REPORT_PAGE_SIZE = 30;
export const MAX_PROPERTIES_REPORT_COLUMNS = 30;
export const MAX_IMPORTED_QUERY_LENGTH = 2000;

const VALUE_BLOCKS = new Set(["paragraph", "bulletList", "orderedList", "blockquote", "codeBlock"]);
const LIST_BLOCKS = new Set(["bulletList", "orderedList"]);

export interface ExtractedProperty {
  block: number;
  setId: string | null;
  position: number;
  key: string;
  keyNormalized: string;
  value: NodeJson[];
  text: string;
  sortKey: string;
}

function plain(node: NodeJson): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return " ";
  if (node.type === "date" || node.type === "status") {
    return String(node.attrs?.[node.type === "date" ? "date" : "text"] ?? "");
  }
  if (node.type === "pageLink") return String(node.attrs?.title ?? "");
  return (node.content ?? [])
    .map(plain)
    .join(node.content?.some((child) => child.type === "text") ? "" : " ");
}

export function propertySortKey(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\d+/g, (digits) => digits.replace(/^0+(?=\d)/, "").padStart(20, "0"))
    .slice(0, 400);
}

function keyText(node: NodeJson): string {
  return propertyKey((node.content ?? []).map((child) => child.text ?? "").join(""));
}

export function extractPageProperties(doc: DocumentJson): ExtractedProperty[] {
  const properties: ExtractedProperty[] = [];
  let block = 0;
  const visit = (node: NodeJson) => {
    if (node.type !== "pageProperties") {
      for (const child of node.content ?? []) visit(child);
      return;
    }
    const setId = typeof node.attrs?.setId === "string" ? node.attrs.setId : null;
    const seen = new Set<string>();
    for (const [position, row] of (node.content ?? []).entries()) {
      const [keyNode, valueNode] = row.content ?? [];
      if (!keyNode || !valueNode) continue;
      const key = keyText(keyNode);
      const keyNormalized = key.toLowerCase();
      if (key.length === 0 || seen.has(keyNormalized)) continue;
      seen.add(keyNormalized);
      const value = valueNode.content ?? [];
      const text = value.map(plain).join(" ").replace(/\s+/g, " ").trim().slice(0, 2000);
      properties.push({
        block,
        setId,
        position,
        key,
        keyNormalized,
        value,
        text,
        sortKey: propertySortKey(text),
      });
    }
    block += 1;
  };
  visit(doc);
  return properties;
}

export function propertiesReportRequest(node: { attrs: Record<string, unknown> }): PropertiesReportRequest {
  return {
    spaceIds: attrOf<string[]>(node, "spaceIds"),
    labels: attrOf<string[]>(node, "labels"),
    setId: attrOf<string | null>(node, "setId"),
    columns: attrOf<string[]>(node, "columns"),
    sortBy: attrOf<string | null>(node, "sortBy"),
    reverse: attrOf<boolean>(node, "reverse"),
    pageSize: attrOf<number>(node, "pageSize"),
  };
}

function valueProblem(blocks: readonly NodeJson[]): string | null {
  for (const block of blocks) {
    if (!VALUE_BLOCKS.has(block.type)) return `A property value cannot contain ${block.type}`;
    const children = LIST_BLOCKS.has(block.type)
      ? (block.content ?? []).flatMap((item) => item.content ?? [])
      : block.type === "blockquote"
        ? (block.content ?? [])
        : [];
    const nested = valueProblem(children);
    if (nested) return nested;
  }
  return null;
}

function propertiesHtml(node: ValidNode, renderer: HtmlRenderer): string {
  const rows = node.content.map((row) => renderer.render(row)).join("");
  return element(
    "section",
    {
      class: "ph-page-properties",
      "aria-label": renderer.label("pageProperties"),
      "data-set-id": attrOf<string | null>(node, "setId"),
      "data-hidden": attrOf<boolean>(node, "hidden") ? "true" : null,
    },
    element("table", {}, element("tbody", {}, rows)),
  );
}

function hiddenForReaders(node: ValidNode, renderer: { context: { showPlaceholders?: boolean } }): boolean {
  return attrOf<boolean>(node, "hidden") && !renderer.context.showPlaceholders;
}

function propertyCells(row: ValidNode): { key: ValidNode | undefined; value: ValidNode | undefined } {
  return { key: row.content[0], value: row.content[1] };
}

function wordCellOf(content: WordBlock[], header: boolean): WordTableCell {
  return {
    header,
    colspan: 1,
    rowspan: 1,
    width: null,
    background: null,
    content: content.length > 0 ? content : [{ type: "paragraph", content: [] }],
  };
}

function cellHtml(cell: readonly NodeJson[] | null, renderer: HtmlRenderer): string {
  return cell && cell.length > 0 ? renderer.nested(cell, renderer.context) : "";
}

function reportHeadings(node: ValidNode, report: PropertiesReport, renderer: HtmlRenderer | WordRenderer) {
  const first = attrOf<string>(node, "firstColumn") || renderer.label("reportTitle");
  return [
    first,
    ...report.columns,
    ...(attrOf<boolean>(node, "showCreator") ? [renderer.label("propertiesReportCreator")] : []),
    ...(attrOf<boolean>(node, "showLabels") ? [renderer.label("propertiesReportLabels")] : []),
  ];
}

function reportAttributes(node: ValidNode): Record<string, string | number | null> {
  const json = (name: string) => {
    const value = attrOf<string[]>(node, name);
    return value.length > 0 ? JSON.stringify(value) : null;
  };
  return {
    "data-space-ids": json("spaceIds"),
    "data-labels": json("labels"),
    "data-set-id": attrOf<string | null>(node, "setId"),
    "data-columns": json("columns"),
    "data-first-column": attrOf<string>(node, "firstColumn") || null,
    "data-sort-by": attrOf<string | null>(node, "sortBy"),
    "data-reverse": attrOf<boolean>(node, "reverse") ? "true" : null,
    "data-page-size": attrOf<number>(node, "pageSize"),
    "data-show-creator": attrOf<boolean>(node, "showCreator") ? "true" : null,
    "data-show-labels": attrOf<boolean>(node, "showLabels") ? "true" : null,
  };
}

function reportOf(
  node: ValidNode,
  renderer: HtmlRenderer | MarkdownRenderer | WordRenderer,
): PropertiesReport | null {
  return renderer.context.propertiesReport?.(propertiesReportRequest(node)) ?? null;
}

function moreNote(report: PropertiesReport, renderer: HtmlRenderer | MarkdownRenderer | WordRenderer) {
  return report.total > report.rows.length
    ? renderer.label("propertiesReportMore", {
        shown: String(report.rows.length),
        total: String(report.total),
      })
    : null;
}

function propertiesReportHtml(node: ValidNode, renderer: HtmlRenderer): string {
  const report = reportOf(node, renderer);
  const label = renderer.label("propertiesReport");
  let content: string;
  if (report === null) {
    content = element("p", {}, renderer.escape(label));
  } else if (report.rows.length === 0) {
    content = element(
      "p",
      { class: "ph-listing-empty" },
      renderer.escape(renderer.label("noReportedProperties")),
    );
  } else {
    const head = element(
      "thead",
      {},
      element(
        "tr",
        {},
        reportHeadings(node, report, renderer)
          .map((heading) => element("th", { scope: "col" }, renderer.escape(heading)))
          .join(""),
      ),
    );
    const rows = report.rows.map((row) => {
      const href = renderer.safeHref(row.href);
      const title = renderer.escape(row.title || renderer.label("untitledPage"));
      const cells = [
        href ? element("a", { href }, title) : title,
        ...row.cells.map((cell) => cellHtml(cell, renderer)),
        ...(attrOf<boolean>(node, "showCreator")
          ? [renderer.escape(row.creator ?? renderer.label("unknownPerson"))]
          : []),
        ...(attrOf<boolean>(node, "showLabels") ? [renderer.escape(row.labels.join(", "))] : []),
      ];
      return element("tr", {}, cells.map((cell) => element("td", {}, cell)).join(""));
    });
    const more = moreNote(report, renderer);
    content = `${element("table", {}, `${head}${element("tbody", {}, rows.join(""))}`)}${more ? element("p", { class: "ph-listing-more" }, renderer.escape(more)) : ""}`;
  }
  return element(
    "section",
    { class: "ph-properties-report", "aria-label": label, ...reportAttributes(node) },
    content,
  );
}

function propertiesReportWord(node: ValidNode, renderer: WordRenderer): WordContent[] {
  const report = reportOf(node, renderer);
  if (report === null) return wordNote(renderer.label("propertiesReport"));
  if (report.rows.length === 0) return wordNote(renderer.label("noReportedProperties"));
  const showCreator = attrOf<boolean>(node, "showCreator");
  const showLabels = attrOf<boolean>(node, "showLabels");
  const text = (value: string): WordBlock[] => [{ type: "paragraph", content: [wordText(value)] }];
  const more = moreNote(report, renderer);
  return [
    {
      type: "table",
      borderless: false,
      rows: [
        { cells: reportHeadings(node, report, renderer).map((heading) => wordCellOf(text(heading), true)) },
        ...report.rows.map((row) => {
          const href = renderer.safeHref(row.href);
          return {
            cells: [
              wordCellOf(
                [
                  {
                    type: "paragraph",
                    content: [
                      wordText(row.title || renderer.label("untitledPage"), href ? { link: href } : {}),
                    ],
                  },
                ],
                false,
              ),
              ...row.cells.map((cell) =>
                wordCellOf(cell && cell.length > 0 ? renderer.nested(cell, renderer.context) : [], false),
              ),
              ...(showCreator
                ? [wordCellOf(text(row.creator ?? renderer.label("unknownPerson")), false)]
                : []),
              ...(showLabels ? [wordCellOf(text(row.labels.join(", ")), false)] : []),
            ],
          };
        }),
      ],
    },
    ...(more ? wordNote(more) : []),
  ];
}

function propertiesReportMarkdown(node: ValidNode, renderer: MarkdownRenderer): string {
  const report = reportOf(node, renderer);
  if (report === null) return `*${renderer.escape(renderer.label("propertiesReport"))}*`;
  if (report.rows.length === 0) return `*${renderer.escape(renderer.label("noReportedProperties"))}*`;
  const headings = [
    attrOf<string>(node, "firstColumn") || renderer.label("reportTitle"),
    ...report.columns,
    ...(attrOf<boolean>(node, "showCreator") ? [renderer.label("propertiesReportCreator")] : []),
    ...(attrOf<boolean>(node, "showLabels") ? [renderer.label("propertiesReportLabels")] : []),
  ];
  const rows = report.rows.map((row) => {
    const href = renderer.safeHref(row.href);
    const title = markdownCell(renderer.escape(row.title || renderer.label("untitledPage")));
    const cells = [
      href ? `[${title}](${markdownUrl(href)})` : title,
      ...row.cells.map((cell) =>
        cell && cell.length > 0
          ? markdownCell(renderer.nested(cell, renderer.context).replace(/\n+/g, "<br>"))
          : "",
      ),
      ...(attrOf<boolean>(node, "showCreator")
        ? [markdownCell(renderer.escape(row.creator ?? renderer.label("unknownPerson")))]
        : []),
      ...(attrOf<boolean>(node, "showLabels") ? [renderer.escape(row.labels.join(", "))] : []),
    ];
    return `| ${cells.join(" | ")} |`;
  });
  const more = moreNote(report, renderer);
  return [
    `| ${headings.map((heading) => markdownCell(renderer.escape(heading))).join(" | ")} |`,
    `| ${headings.map(() => "---").join(" | ")} |`,
    ...rows,
    ...(more ? ["", `*${renderer.escape(more)}*`] : []),
  ].join("\n");
}

export interface ImportedFilter {
  labels: string[];
  labelGroups: number;
  spaceIds: string[];
  types: string[];
}

function spaceIdOf(key: string, context: MacroImportContext): string | null {
  return CURRENT_SPACE_KEYS.has(key.toLowerCase()) ? context.space(null) : context.space(key);
}

export function filterFromCql(
  conditions: readonly CqlCondition[],
  context: MacroImportContext,
  fields: ReadonlySet<string>,
): ImportedFilter | null {
  const filter: ImportedFilter = { labels: [], labelGroups: 0, spaceIds: [], types: [] };
  let spaces = 0;
  let types = 0;
  for (const condition of conditions) {
    if (!fields.has(condition.field)) return null;
    if (condition.field === "label") {
      const labels = importedLabels(condition.values.join(","));
      if (!labels || labels.length === 0) return null;
      filter.labels.push(...labels.filter((label) => !filter.labels.includes(label)));
      filter.labelGroups += 1;
    } else if (condition.field === "space") {
      spaces += 1;
      for (const key of condition.values) {
        const spaceId = spaceIdOf(key, context);
        if (!spaceId) return null;
        if (!filter.spaceIds.includes(spaceId)) filter.spaceIds.push(spaceId);
      }
    } else if (condition.field === "type") {
      types += 1;
      filter.types.push(...condition.values.map((value) => value.toLowerCase()));
    }
  }
  if (spaces > 1 || types > 1 || filter.spaceIds.length > MAX_FILTER_SPACES) return null;
  return filter;
}

export function spacesFromParameter(
  macro: SourceElement,
  name: string,
  context: MacroImportContext,
): string[] | null {
  const spaceIds: string[] = [];
  for (const key of macroSpaceKeys(macro, name)) {
    if (/^@?all$/i.test(key)) return null;
    const spaceId = spaceIdOf(key, context);
    if (!spaceId) return null;
    if (!spaceIds.includes(spaceId)) spaceIds.push(spaceId);
  }
  return spaceIds.length <= MAX_FILTER_SPACES ? spaceIds : null;
}

function cleanColumn(value: string): string | null {
  const column = propertyKey(value);
  return column.length > 0 && column.length <= MAX_PROPERTY_KEY_LENGTH && !column.includes(",")
    ? column
    : null;
}

const DETAILS_SUMMARY_PARAMETERS = new Set([
  ...IGNORED_PAGE_REPORT_PARAMETERS,
  "cql",
  "label",
  "labels",
  "spaces",
  "spaceKey",
  "headings",
  "sortBy",
  "reverseSort",
  "firstcolumn",
  "pageSize",
  "showCreator",
  "showPageLabels",
  "showCommentsCount",
  "showLikesCount",
  "id",
]);

const DROPPED_SUMMARY_OPTIONS = ["showCommentsCount", "showLikesCount"];

function setIdOf(value: string | null): string | null | undefined {
  const id = singleLine(value);
  if (id.length === 0) return null;
  return id.length <= MAX_PROPERTY_SET_ID_LENGTH ? id : undefined;
}

const propertiesReportImporter: MacroConverter = {
  source: "confluence",
  macros: ["detailssummary"],
  convert: (macro, context) => {
    if (!onlyKnownParameters(macro, DETAILS_SUMMARY_PARAMETERS)) return null;
    const setId = setIdOf(macroText(macro, "id"));
    if (setId === undefined) return null;
    const cql = macroText(macro, "cql") ?? "";
    let labels = importedLabels(macroText(macro, "labels") ?? macroText(macro, "label")) ?? [];
    let spaceIds =
      spacesFromParameter(macro, macroText(macro, "spaces") ? "spaces" : "spaceKey", context) ?? [];
    let query: string | null = null;
    if (cql.length > 0) {
      const conditions = parseCql(cql);
      const filter = conditions
        ? filterFromCql(conditions, context, new Set(["label", "space", "type"]))
        : null;
      const mapped =
        filter !== null &&
        filter.labelGroups <= 1 &&
        filter.types.every((type) => type === "page" || type === "blogpost");
      if (mapped && filter) {
        labels = filter.labels;
        spaceIds = filter.spaceIds;
      } else {
        query = cql.slice(0, MAX_IMPORTED_QUERY_LENGTH);
        context.note({ code: "unmappedQuery", macro: "detailssummary", query });
      }
    }
    const columns: string[] = [];
    for (const heading of listValues(macroText(macro, "headings"))) {
      const column = cleanColumn(heading);
      if (column && !columns.some((existing) => existing.toLowerCase() === column.toLowerCase())) {
        columns.push(column);
      }
    }
    const firstColumn = singleLine(macroText(macro, "firstcolumn")).slice(0, MAX_PROPERTY_KEY_LENGTH);
    const sortText = cleanColumn(macroText(macro, "sortBy") ?? "");
    const sortBy =
      sortText === null ||
      sortText.toLowerCase() === "title" ||
      sortText.toLowerCase() === firstColumn.toLowerCase()
        ? null
        : sortText;
    const pageSizeText = macroText(macro, "pageSize") ?? "";
    const pageSize =
      pageSizeText.length > 0
        ? (boundedInteger(pageSizeText, 1, 999_999) ?? DEFAULT_PROPERTIES_REPORT_PAGE_SIZE)
        : DEFAULT_PROPERTIES_REPORT_PAGE_SIZE;
    for (const option of DROPPED_SUMMARY_OPTIONS) {
      if (isTrue(macroText(macro, option))) {
        context.note({ code: "macroOptionDropped", macro: "detailssummary", option });
      }
    }
    return [
      {
        type: "propertiesReport",
        attrs: {
          spaceIds,
          labels,
          setId,
          columns: columns.slice(0, MAX_PROPERTIES_REPORT_COLUMNS),
          firstColumn,
          sortBy,
          reverse: isTrue(macroText(macro, "reverseSort")),
          pageSize: Math.min(pageSize, MAX_PROPERTIES_REPORT_PAGE_SIZE),
          showCreator: isTrue(macroText(macro, "showCreator")),
          showLabels: isTrue(macroText(macro, "showPageLabels")),
          query,
        },
      },
    ];
  },
};

function tableRows(table: SourceElement): SourceElement[] {
  const rows: SourceElement[] = [];
  for (const child of sourceElements(table)) {
    if (child.name === "tr") rows.push(child);
    else if (["thead", "tbody", "tfoot"].includes(child.name)) rows.push(...sourceElements(child, "tr"));
  }
  return rows;
}

function cellsOf(row: SourceElement): SourceElement[] | null {
  const cells = sourceElements(row).filter((cell) => cell.name === "th" || cell.name === "td");
  for (const cell of cells) {
    for (const span of ["colspan", "rowspan"]) {
      const value = cell.attributes[span];
      if (value !== undefined && value !== "1") return null;
    }
  }
  return cells;
}

function isBlank(content: SourceContent): boolean {
  if (typeof content === "string") return content.trim().length === 0;
  return (
    content.name === "p" && sourceText(content).trim().length === 0 && sourceElements(content).length === 0
  );
}

function keyNode(cell: SourceElement): NodeJson {
  const text = singleLine(sourceText(cell)).slice(0, MAX_PROPERTY_KEY_LENGTH);
  return text.length > 0
    ? { type: "pagePropertyKey", content: [{ type: "text", text }] }
    : { type: "pagePropertyKey" };
}

function valueBlocks(content: readonly NodeJson[]): NodeJson[] | null {
  if (valueProblem(content)) return null;
  return content.length > 0 ? [...content] : [{ type: "paragraph" }];
}

function propertyRows(table: SourceElement, context: MacroImportContext): NodeJson[] | null {
  const rows = tableRows(table).map(cellsOf);
  if (rows.length === 0 || rows.some((cells) => cells === null)) return null;
  const grid = rows as SourceElement[][];
  const pairs: [SourceElement, SourceElement][] = [];
  const [first = [], second = []] = grid;
  const horizontal =
    grid.length === 2 &&
    first.length === second.length &&
    first.every((cell) => cell.name === "th") &&
    second.every((cell) => cell.name === "td");
  if (horizontal) {
    for (const [index, key] of first.entries()) pairs.push([key, second[index] as SourceElement]);
  } else if (grid.every((cells) => cells.length === 2)) {
    for (const cells of grid) pairs.push([cells[0] as SourceElement, cells[1] as SourceElement]);
  } else {
    return null;
  }
  const result: NodeJson[] = [];
  for (const [key, value] of pairs) {
    const blocks = valueBlocks(context.blocks(value.children));
    if (!blocks) return null;
    result.push({
      type: "pageProperty",
      content: [keyNode(key), { type: "pagePropertyValue", content: blocks }],
    });
  }
  return result;
}

const pagePropertiesImporter: MacroConverter = {
  source: "confluence",
  macros: ["details"],
  convert: (macro, context) => {
    if (!onlyKnownParameters(macro, new Set(["id", "hidden"]))) return null;
    const setId = setIdOf(macroText(macro, "id"));
    if (setId === undefined) return null;
    const body = richBody(macro);
    const content = (body?.children ?? []).filter((child) => !isBlank(child));
    const table = content[0];
    if (content.length !== 1 || typeof table === "string" || table?.name !== "table") return null;
    const rows = propertyRows(table, context);
    if (!rows) return null;
    return [
      {
        type: "pageProperties",
        attrs: { setId, hidden: isTrue(macroText(macro, "hidden")) },
        content: rows,
      },
    ];
  },
};

export const pagePropertiesModule = defineModule({
  name: "pageProperties",
  nodes: [
    {
      name: "pageProperties",
      spec: { content: "pageProperty+", group: "block", defining: true, isolating: true },
      attrs: {
        setId: optional(propertySetIdValue.nullable(), null),
        hidden: optional(z.boolean(), false),
      },
      html: (node, renderer) => (hiddenForReaders(node, renderer) ? "" : propertiesHtml(node, renderer)),
      word: (node, renderer) => {
        if (hiddenForReaders(node, renderer)) return [];
        return [
          {
            type: "table",
            borderless: false,
            rows: node.content.map((row) => {
              const { key, value } = propertyCells(row);
              return {
                cells: [
                  wordCellOf(key ? renderer.blocks(key) : [], true),
                  wordCellOf(value ? renderer.blocks(value) : [], false),
                ],
              };
            }),
          },
        ];
      },
      markdown: (node, renderer) => {
        if (hiddenForReaders(node, renderer)) return "";
        const rows = node.content.map((row) => {
          const { key, value } = propertyCells(row);
          const keyText = key ? markdownCell(renderer.inline(key)) : "";
          const valueText = value
            ? markdownCell(
                value.content
                  .map((block) =>
                    block.type === "paragraph"
                      ? renderer.inline(block)
                      : renderer.html(block).replaceAll("|", "&#124;"),
                  )
                  .join("<br>"),
              )
            : "";
          return `| ${keyText} | ${valueText} |`;
        });
        return [rows[0] ?? "| |", "| --- | --- |", ...rows.slice(1)].join("\n");
      },
    },
    {
      name: "pageProperty",
      spec: { content: "pagePropertyKey pagePropertyValue", isolating: true },
      html: (node, renderer) => element("tr", {}, renderer.children(node)),
      word: (node, renderer) => renderer.blocks(node),
      markdown: (node, renderer) => renderer.blocks(node),
    },
    {
      name: "pagePropertyKey",
      spec: { content: "text*", marks: "", isolating: true },
      validate: (node) =>
        node.content.map((child) => child.text ?? "").join("").length > MAX_PROPERTY_KEY_LENGTH
          ? `A property name has at most ${MAX_PROPERTY_KEY_LENGTH} characters`
          : null,
      html: (node, renderer) => element("th", { scope: "row" }, renderer.children(node)),
      word: (node, renderer) => renderer.inline(node),
      markdown: (node, renderer) => renderer.inline(node),
    },
    {
      name: "pagePropertyValue",
      spec: { content: "(paragraph | bulletList | orderedList | blockquote | codeBlock)+", isolating: true },
      validate: (node) => valueProblem(node.content),
      html: (node, renderer) => element("td", {}, renderer.children(node)),
      word: (node, renderer) => renderer.blocks(node),
      markdown: (node, renderer) => renderer.blocks(node),
    },
  ],
  importers: [pagePropertiesImporter],
});

export const propertiesReportModule = defineModule({
  name: "propertiesReport",
  nodes: [
    {
      name: "propertiesReport",
      spec: { group: "block", atom: true, selectable: true, draggable: true },
      attrs: {
        spaceIds: optional(spaceIdsValue, []),
        labels: optional(labelsValue, []),
        setId: optional(propertySetIdValue.nullable(), null),
        columns: optional(propertyColumnsValue, []),
        firstColumn: optional(z.string().max(MAX_PROPERTY_KEY_LENGTH), ""),
        sortBy: optional(propertyColumnValue.nullable(), null),
        reverse: optional(z.boolean(), false),
        pageSize: optional(
          z.number().int().min(1).max(MAX_PROPERTIES_REPORT_PAGE_SIZE),
          DEFAULT_PROPERTIES_REPORT_PAGE_SIZE,
        ),
        showCreator: optional(z.boolean(), false),
        showLabels: optional(z.boolean(), false),
        query: optional(z.string().min(1).max(MAX_IMPORTED_QUERY_LENGTH).nullable(), null),
      },
      portable: clearedAttributes("report", { spaceIds: [], query: null }),
      html: propertiesReportHtml,
      word: propertiesReportWord,
      markdown: propertiesReportMarkdown,
      text: () => "",
    },
  ],
  importers: [propertiesReportImporter],
});
