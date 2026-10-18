import { z } from "zod";
import {
  boundedInteger,
  isTrue,
  listValues,
  type MacroConverter,
  type MacroImportContext,
  macroParameterNames,
  macroSpaceKeys,
  macroText,
  type SourceElement,
} from "../importing.js";
import type { ValidNode } from "../json.js";
import {
  attrOf,
  type DecisionReportOrder,
  type DecisionReportRequest,
  decisionReportOrders,
  defineModule,
  type HtmlRenderer,
  type MarkdownRenderer,
  optional,
  type PageReportRequest,
  type PageReportSort,
  pageReportSorts,
  type ReportedTask,
  type TaskReportDue,
  type TaskReportRequest,
  type TaskReportStatus,
  taskReportDueWindows,
  taskReportStatuses,
  type WordRenderer,
} from "../module.js";
import { clearedAttributes } from "../portable.js";
import { element, markdownUrl } from "../text.js";
import {
  cleanLabel,
  labelsValue,
  MAX_FILTER_LABELS,
  MAX_FILTER_PAGES,
  pageIdsValue,
  uuidValue,
} from "../values.js";
import { type WordContent, type WordInline, type WordTableCell, wordText } from "../word.js";

export { type TaskReportDue, type TaskReportStatus, taskReportDueWindows, taskReportStatuses };

export const MAX_PAGE_REPORT_LIMIT = 100;
export const DEFAULT_PAGE_REPORT_LIMIT = 20;

export const CURRENT_SPACE_KEYS = new Set(["@self", "currentspace()"]);
const IGNORED_TASK_REPORT_PARAMETERS = new Set(["isMissingRequiredParameters", "pageSize", "columns"]);
export const IGNORED_PAGE_REPORT_PARAMETERS = new Set([
  "analyticsKey",
  "blueprintModuleCompleteKey",
  "contentBlueprintId",
  "blankTitle",
  "blankDescription",
  "createButtonLabel",
  "theme",
  "hideHeading",
  "showProfilePic",
  "width",
]);

export function pageReportRequest(node: { attrs: Record<string, unknown> }): PageReportRequest {
  return {
    spaceId: attrOf<string | null>(node, "spaceId"),
    labels: attrOf<string[]>(node, "labels"),
    sort: attrOf<PageReportSort>(node, "sort"),
    reverse: attrOf<boolean>(node, "reverse"),
    limit: attrOf<number>(node, "limit"),
  };
}

export function taskReportRequest(node: { attrs: Record<string, unknown> }): TaskReportRequest {
  return {
    spaceId: attrOf<string | null>(node, "spaceId"),
    seriesId: attrOf<string | null>(node, "seriesId"),
    pageIds: attrOf<string[]>(node, "pageIds"),
    labels: attrOf<string[]>(node, "labels"),
    assignee: attrOf<string | null>(node, "assignee"),
    assignedToViewer: attrOf<boolean>(node, "assignedToViewer"),
    due: attrOf<TaskReportDue>(node, "due"),
    status: attrOf<TaskReportStatus>(node, "status"),
  };
}

export function decisionReportRequest(node: { attrs: Record<string, unknown> }): DecisionReportRequest {
  return {
    spaceId: attrOf<string | null>(node, "spaceId"),
    labels: attrOf<string[]>(node, "labels"),
    parentId: attrOf<string | null>(node, "parentId"),
    order: attrOf<DecisionReportOrder>(node, "order"),
  };
}

export function onlyKnownParameters(macro: SourceElement, known: ReadonlySet<string>): boolean {
  return macroParameterNames(macro).every(
    (name) => known.has(name) || (macroText(macro, name) ?? "").length === 0,
  );
}

export function importedLabels(value: string | null): string[] | null {
  const labels: string[] = [];
  for (const part of listValues(value)) {
    if (part.startsWith("+") || part.startsWith("-")) return null;
    const label = cleanLabel(part);
    if (!label) return null;
    if (!labels.includes(label)) labels.push(label);
  }
  return labels.length <= MAX_FILTER_LABELS ? labels : null;
}

export function importedSpace(
  keys: readonly string[],
  context: MacroImportContext,
): string | null | undefined {
  if (keys.length > 1) return undefined;
  const key = keys[0];
  if (key === undefined || CURRENT_SPACE_KEYS.has(key.toLowerCase())) return context.space(null) ?? undefined;
  return context.space(key) ?? undefined;
}

function importedPages(value: string | null, context: MacroImportContext): string[] | null {
  const pages: string[] = [];
  for (const sourceId of listValues(value)) {
    const pageId = /^\d{1,19}$/.test(sourceId) ? context.pageById(sourceId) : null;
    if (!pageId) return null;
    if (!pages.includes(pageId)) pages.push(pageId);
  }
  return pages.length <= MAX_FILTER_PAGES ? pages : null;
}

function reportSort(value: string | null): PageReportSort | null {
  const sort = (value ?? "")
    .toLowerCase()
    .replace(/^page\s+/, "")
    .replace(/[\s_-]+/g, "");
  if (
    sort === "" ||
    ["modified", "lastmodified", "lastmodifieddate", "updated", "lastupdated"].includes(sort)
  ) {
    return "modified";
  }
  if (["created", "creation", "createddate", "creationdate"].includes(sort)) return "created";
  if (sort === "title") return "title";
  return null;
}

const PAGE_REPORT_PARAMETERS = new Set([
  ...IGNORED_PAGE_REPORT_PARAMETERS,
  "spaces",
  "labels",
  "maxResults",
  "sort",
  "reverse",
]);
const RECENTLY_UPDATED_PARAMETERS = new Set([
  ...IGNORED_PAGE_REPORT_PARAMETERS,
  "spaces",
  "labels",
  "max",
  "types",
]);

const pageReportImporter: MacroConverter = {
  source: "confluence",
  macros: ["content-report-table", "recently-updated"],
  convert: (macro, context) => {
    const recent = macro.attributes["ac:name"] === "recently-updated";
    if (!onlyKnownParameters(macro, recent ? RECENTLY_UPDATED_PARAMETERS : PAGE_REPORT_PARAMETERS))
      return null;
    const spaceId = importedSpace(macroSpaceKeys(macro, "spaces"), context);
    const labels = importedLabels(macroText(macro, "labels"));
    if (spaceId === undefined || labels === null) return null;
    const maxText = macroText(macro, recent ? "max" : "maxResults") ?? "";
    const max =
      maxText.length > 0 ? boundedInteger(maxText, 1, 999_999) : recent ? 15 : DEFAULT_PAGE_REPORT_LIMIT;
    if (max === null) return null;
    if (recent && listValues(macroText(macro, "types")).some((type) => type.toLowerCase() !== "page"))
      return null;
    const sort = recent ? "modified" : reportSort(macroText(macro, "sort"));
    if (!sort) return null;
    return [
      {
        type: "pageReport",
        attrs: {
          spaceId,
          labels,
          sort,
          reverse: !recent && isTrue(macroText(macro, "reverse")),
          limit: Math.min(max, MAX_PAGE_REPORT_LIMIT),
        },
      },
    ];
  },
};

type CqlClause = { field: string; value: string };

const CQL_CLAUSE =
  /^([A-Za-z]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(currentSpace)\s*\(\s*\)|([^\s"'()=!~<>,]+))\s*/;

export function simpleCql(cql: string): CqlClause[] | null {
  const clauses: CqlClause[] = [];
  let rest = cql.trim();
  while (rest.length > 0) {
    const clause = CQL_CLAUSE.exec(rest);
    if (!clause?.[1]) return null;
    const value = clause[4]
      ? "currentSpace()"
      : (clause[2] ?? clause[3] ?? clause[5] ?? "").replace(/\\(.)/g, "$1");
    clauses.push({ field: clause[1].toLowerCase(), value });
    rest = rest.slice(clause[0].length);
    if (rest.length === 0) break;
    const and = /^and\s+/i.exec(rest);
    if (!and) return null;
    rest = rest.slice(and[0].length);
  }
  return clauses.length > 0 ? clauses : null;
}

function decisionClauses(macro: SourceElement): Map<string, string> | null {
  const clauses = simpleCql(macroText(macro, "cql") ?? "");
  if (!clauses) return null;
  const fields = new Map<string, string>();
  for (const clause of clauses) {
    if (!["space", "label", "parent"].includes(clause.field) || fields.has(clause.field)) return null;
    fields.set(clause.field, clause.value);
  }
  return fields;
}

const decisionReportImporter: MacroConverter = {
  source: "confluence",
  macros: ["decisionreport"],
  references: (macro) => {
    const parent = decisionClauses(macro)?.get("parent");
    return parent ? { pageIds: [parent] } : {};
  },
  convert: (macro, context) => {
    if (!onlyKnownParameters(macro, new Set(["cql", "sort", "reverse"]))) return null;
    const fields = decisionClauses(macro);
    if (!fields) return null;
    const space = fields.get("space");
    const spaceId = space === undefined ? null : importedSpace([space], context);
    const label = fields.get("label");
    const labels = label === undefined ? [] : importedLabels(label);
    const parent = fields.get("parent");
    const parentId = parent === undefined ? null : importedPages(parent, context)?.[0];
    if (spaceId === undefined || labels === null || parentId === undefined) return null;
    const sort = (macroText(macro, "sort") ?? "").toLowerCase().replace(/^page\s+/, "");
    if (sort !== "" && sort !== "created") return null;
    const order = sort === "created" && !isTrue(macroText(macro, "reverse")) ? "oldest" : "newest";
    return [{ type: "decisionReport", attrs: { spaceId, labels, parentId, order } }];
  },
};

const TASK_STATUSES: Readonly<Record<string, TaskReportStatus>> = {
  "": "open",
  incomplete: "open",
  complete: "done",
};

function legacyTaskSpaces(macro: SourceElement): string[] | null {
  const keys = [...macroSpaceKeys(macro, "spaces")];
  for (const entry of listValues(macroText(macro, "spaceAndPage"))) {
    const match = /^space:(.+)$/i.exec(entry);
    if (!match?.[1]) return null;
    keys.push(match[1].trim());
  }
  return [...new Set(keys)];
}

const taskReportImporter: MacroConverter = {
  source: "confluence",
  macros: ["tasks-report-macro"],
  references: (macro) => ({
    pageIds: listValues(macroText(macro, "pages")).filter((id) => /^\d{1,19}$/.test(id)),
  }),
  convert: (macro, context) => {
    const known = new Set([
      ...IGNORED_TASK_REPORT_PARAMETERS,
      "pages",
      "spaces",
      "spaceAndPage",
      "labels",
      "status",
    ]);
    if (!onlyKnownParameters(macro, known)) return null;
    const status = TASK_STATUSES[(macroText(macro, "status") ?? "").toLowerCase()];
    const labels = importedLabels(macroText(macro, "labels"));
    const pageIds = importedPages(macroText(macro, "pages"), context);
    const spaceKeys = legacyTaskSpaces(macro);
    if (!status || labels === null || pageIds === null || spaceKeys === null) return null;
    if (pageIds.length === 0 && spaceKeys.length === 0) return null;
    const spaceId = spaceKeys.length > 0 ? importedSpace(spaceKeys, context) : null;
    if (spaceId === undefined) return null;
    return [{ type: "taskReport", attrs: { spaceId, pageIds, labels, status } }];
  },
};

export function formatDay(iso: string, renderer: HtmlRenderer | MarkdownRenderer | WordRenderer): string {
  return renderer.formatDate(iso.slice(0, 10));
}

function reportAttributes(node: ValidNode): Record<string, string | null> {
  const labels = attrOf<string[]>(node, "labels");
  return {
    "data-space-id": attrOf<string | null>(node, "spaceId"),
    "data-labels": labels.length > 0 ? labels.join(",") : null,
  };
}

function taskReportHtml(tasks: readonly ReportedTask[] | null, renderer: HtmlRenderer): string {
  if (tasks === null) return element("p", {}, renderer.escape(renderer.label("taskReport")));
  if (tasks.length === 0) {
    return element("p", { class: "ph-listing-empty" }, renderer.escape(renderer.label("noReportedTasks")));
  }
  const head = element(
    "thead",
    {},
    element(
      "tr",
      {},
      [
        renderer.label("reportTask"),
        renderer.label("reportAssignee"),
        renderer.label("reportDue"),
        renderer.label("reportPage"),
      ]
        .map((heading) => element("th", { scope: "col" }, renderer.escape(heading)))
        .join(""),
    ),
  );
  const rows = tasks.map((task) => {
    const href = renderer.safeHref(task.page.href);
    const title = renderer.escape(task.page.title || renderer.label("untitledPage"));
    const status = renderer.label(task.done ? "taskDone" : "taskOpen");
    const box = `<input type="checkbox" disabled aria-label="${renderer.escape(status)}"${task.done ? " checked" : ""}>`;
    return element(
      "tr",
      { "data-checked": task.done ? "true" : "false" },
      [
        `${box} ${renderer.escape(task.text)}`,
        renderer.escape(task.assignee ?? ""),
        renderer.escape(task.dueDate ? renderer.formatDate(task.dueDate) : ""),
        href ? element("a", { href }, title) : title,
      ]
        .map((cell) => element("td", {}, cell))
        .join(""),
    );
  });
  return element("table", {}, `${head}${element("tbody", {}, rows.join(""))}`);
}

export function wordCell(content: WordInline[], header = false): WordTableCell {
  return {
    header,
    colspan: 1,
    rowspan: 1,
    width: null,
    background: null,
    content: [{ type: "paragraph", content }],
  };
}

export function wordTable(headings: readonly string[], rows: readonly WordInline[][][]): WordContent[] {
  return [
    {
      type: "table",
      borderless: false,
      rows: [
        { cells: headings.map((heading) => wordCell([wordText(heading)], true)) },
        ...rows.map((cells) => ({ cells: cells.map((cell) => wordCell(cell)) })),
      ],
    },
  ];
}

export function wordLink(title: string, href: string | null): WordInline {
  return wordText(title, href ? { link: href } : {});
}

export function wordNote(text: string): WordContent[] {
  return [{ type: "paragraph", content: [wordText(text, { muted: true, italic: true })] }];
}

function taskReportWord(tasks: readonly ReportedTask[] | null, renderer: WordRenderer): WordContent[] {
  if (tasks === null) return wordNote(renderer.label("taskReport"));
  if (tasks.length === 0) return wordNote(renderer.label("noReportedTasks"));
  return wordTable(
    [
      renderer.label("reportTask"),
      renderer.label("reportAssignee"),
      renderer.label("reportDue"),
      renderer.label("reportPage"),
    ],
    tasks.map((task) => [
      [wordText(`${task.done ? "\u2611" : "\u2610"} ${task.text}`)],
      [wordText(task.assignee ?? "")],
      [wordText(task.dueDate ? renderer.formatDate(task.dueDate) : "")],
      [wordLink(task.page.title || renderer.label("untitledPage"), renderer.safeHref(task.page.href))],
    ]),
  );
}

export function markdownCell(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ");
}

function taskReportMarkdown(tasks: readonly ReportedTask[] | null, renderer: MarkdownRenderer): string {
  if (tasks === null) return `*${renderer.escape(renderer.label("taskReport"))}*`;
  if (tasks.length === 0) return `*${renderer.escape(renderer.label("noReportedTasks"))}*`;
  const header = [
    renderer.label("reportTask"),
    renderer.label("reportAssignee"),
    renderer.label("reportDue"),
    renderer.label("reportPage"),
  ]
    .map((heading) => renderer.escape(heading))
    .join(" | ");
  const rows = tasks.map((task) => {
    const href = renderer.safeHref(task.page.href);
    const title = renderer.escape(task.page.title || renderer.label("untitledPage"));
    const cells = [
      `${task.done ? "[x]" : "[ ]"} ${markdownCell(renderer.escape(task.text))}`,
      markdownCell(renderer.escape(task.assignee ?? "")),
      renderer.escape(task.dueDate ? renderer.formatDate(task.dueDate) : ""),
      href ? `[${markdownCell(title)}](${markdownUrl(href)})` : markdownCell(title),
    ];
    return `| ${cells.join(" | ")} |`;
  });
  return [`| ${header} |`, "| --- | --- | --- | --- |", ...rows].join("\n");
}

export const taskReportModule = defineModule({
  name: "taskReport",
  nodes: [
    {
      name: "taskReport",
      spec: { group: "block", atom: true, selectable: true, draggable: true },
      attrs: {
        spaceId: optional(uuidValue.nullable(), null),
        seriesId: optional(uuidValue.nullable(), null),
        pageIds: optional(pageIdsValue, []),
        labels: optional(labelsValue, []),
        assignee: optional(uuidValue.nullable(), null),
        assignedToViewer: optional(z.boolean(), false),
        due: optional(z.enum(taskReportDueWindows), "any"),
        status: optional(z.enum(taskReportStatuses), "open"),
      },
      validate: (node) =>
        attrOf<string | null>(node, "assignee") !== null && attrOf<boolean>(node, "assignedToViewer")
          ? "A task report filters by one assignee or by the viewer, not both"
          : null,
      portable: clearedAttributes("report", { spaceId: null, seriesId: null, pageIds: [], assignee: null }),
      html: (node, renderer) =>
        element(
          "div",
          {
            class: "ph-task-report",
            ...reportAttributes(node),
            "data-series-id": attrOf<string | null>(node, "seriesId"),
            "data-page-ids": attrOf<string[]>(node, "pageIds").join(",") || null,
            "data-assignee": attrOf<string | null>(node, "assignee"),
            "data-assigned-to-viewer": attrOf<boolean>(node, "assignedToViewer") ? "true" : null,
            "data-due": attrOf<string>(node, "due"),
            "data-status": attrOf<string>(node, "status"),
          },
          taskReportHtml(renderer.context.taskReport?.(taskReportRequest(node)) ?? null, renderer),
        ),
      word: (node, renderer) =>
        taskReportWord(renderer.context.taskReport?.(taskReportRequest(node)) ?? null, renderer),
      markdown: (node, renderer) =>
        taskReportMarkdown(renderer.context.taskReport?.(taskReportRequest(node)) ?? null, renderer),
      text: () => "",
    },
  ],
  importers: [taskReportImporter],
});

export const pageReportModule = defineModule({
  name: "pageReport",
  nodes: [
    {
      name: "pageReport",
      spec: { group: "block", atom: true, selectable: true, draggable: true },
      attrs: {
        spaceId: optional(uuidValue.nullable(), null),
        labels: optional(labelsValue, []),
        sort: optional(z.enum(pageReportSorts), "modified"),
        reverse: optional(z.boolean(), false),
        limit: optional(z.number().int().min(1).max(MAX_PAGE_REPORT_LIMIT), DEFAULT_PAGE_REPORT_LIMIT),
      },
      portable: clearedAttributes("report", { spaceId: null }),
      html: (node, renderer) => {
        const request = pageReportRequest(node);
        const pages = renderer.context.pageReport?.(request) ?? null;
        const label = renderer.escape(renderer.label("pageReport"));
        const head = element(
          "thead",
          {},
          element(
            "tr",
            {},
            [renderer.label("reportTitle"), renderer.label("reportAuthor"), renderer.label("reportUpdated")]
              .map((heading) => element("th", { scope: "col" }, renderer.escape(heading)))
              .join(""),
          ),
        );
        const rows = (pages ?? []).map((page) => {
          const href = renderer.safeHref(page.href);
          const title = renderer.escape(page.title || renderer.label("untitledPage"));
          return element(
            "tr",
            {},
            `${element("td", {}, href ? element("a", { href }, title) : title)}${element("td", {}, renderer.escape(page.author ?? renderer.label("unknownPerson")))}${element("td", {}, renderer.escape(formatDay(page.updatedAt, renderer)))}`,
          );
        });
        const content =
          pages === null
            ? element("p", {}, label)
            : rows.length === 0
              ? element(
                  "p",
                  { class: "ph-listing-empty" },
                  renderer.escape(renderer.label("noReportedPages")),
                )
              : element("table", {}, `${head}${element("tbody", {}, rows.join(""))}`);
        return element(
          "section",
          {
            class: "ph-page-report",
            "aria-label": renderer.label("pageReport"),
            ...reportAttributes(node),
            "data-sort": request.sort,
            "data-reverse": request.reverse ? "true" : null,
            "data-limit": request.limit,
          },
          content,
        );
      },
      word: (node, renderer) => {
        const pages = renderer.context.pageReport?.(pageReportRequest(node)) ?? null;
        if (pages === null) return wordNote(renderer.label("pageReport"));
        if (pages.length === 0) return wordNote(renderer.label("noReportedPages"));
        return wordTable(
          [renderer.label("reportTitle"), renderer.label("reportAuthor"), renderer.label("reportUpdated")],
          pages.map((page) => [
            [wordLink(page.title || renderer.label("untitledPage"), renderer.safeHref(page.href))],
            [wordText(page.author ?? renderer.label("unknownPerson"))],
            [wordText(formatDay(page.updatedAt, renderer))],
          ]),
        );
      },
      markdown: (node, renderer) => {
        const pages = renderer.context.pageReport?.(pageReportRequest(node)) ?? null;
        if (pages === null) return `*${renderer.escape(renderer.label("pageReport"))}*`;
        if (pages.length === 0) return `*${renderer.escape(renderer.label("noReportedPages"))}*`;
        const header = [
          renderer.label("reportTitle"),
          renderer.label("reportAuthor"),
          renderer.label("reportUpdated"),
        ]
          .map((heading) => renderer.escape(heading))
          .join(" | ");
        const rows = pages.map((page) => {
          const href = renderer.safeHref(page.href);
          const title = renderer.escape(page.title || renderer.label("untitledPage"));
          const author = renderer.escape(page.author ?? renderer.label("unknownPerson"));
          return `| ${href ? `[${title}](${markdownUrl(href)})` : title} | ${author} | ${renderer.escape(formatDay(page.updatedAt, renderer))} |`;
        });
        return [`| ${header} |`, "| --- | --- | --- |", ...rows].join("\n");
      },
      text: () => "",
    },
  ],
  importers: [pageReportImporter],
});

export const decisionReportModule = defineModule({
  name: "decisionReport",
  nodes: [
    {
      name: "decisionReport",
      spec: { group: "block", atom: true, selectable: true, draggable: true },
      attrs: {
        spaceId: optional(uuidValue.nullable(), null),
        labels: optional(labelsValue, []),
        parentId: optional(uuidValue.nullable(), null),
        order: optional(z.enum(decisionReportOrders), "newest"),
      },
      portable: clearedAttributes("report", { spaceId: null, parentId: null }),
      html: (node, renderer) => {
        const request = decisionReportRequest(node);
        const decisions = renderer.context.decisionReport?.(request) ?? null;
        const items = (decisions ?? []).map((decision) => {
          const href = renderer.safeHref(decision.page.href);
          const title = renderer.escape(decision.page.title || renderer.label("untitledPage"));
          return element(
            "li",
            {},
            `${element("p", {}, renderer.escape(decision.text))}${element("p", { class: "ph-decision-source" }, `${href ? element("a", { href }, title) : title} · ${renderer.escape(formatDay(decision.date, renderer))}`)}`,
          );
        });
        const content =
          decisions === null
            ? element("p", {}, renderer.escape(renderer.label("decisionReport")))
            : items.length === 0
              ? element(
                  "p",
                  { class: "ph-listing-empty" },
                  renderer.escape(renderer.label("noReportedDecisions")),
                )
              : element("ul", {}, items.join(""));
        return element(
          "section",
          {
            class: "ph-decision-report",
            "aria-label": renderer.label("decisionReport"),
            ...reportAttributes(node),
            "data-parent-id": request.parentId,
            "data-order": request.order,
          },
          content,
        );
      },
      word: (node, renderer) => {
        const decisions = renderer.context.decisionReport?.(decisionReportRequest(node)) ?? null;
        if (decisions === null) return wordNote(renderer.label("decisionReport"));
        if (decisions.length === 0) return wordNote(renderer.label("noReportedDecisions"));
        return [
          {
            type: "list",
            ordered: false,
            start: 1,
            items: decisions.map((decision) => ({
              checked: null,
              content: [
                { type: "paragraph", content: [wordText(decision.text)] },
                {
                  type: "paragraph",
                  content: [
                    wordLink(
                      decision.page.title || renderer.label("untitledPage"),
                      renderer.safeHref(decision.page.href),
                    ),
                    wordText(` · ${formatDay(decision.date, renderer)}`, { muted: true }),
                  ],
                },
              ],
            })),
          },
        ];
      },
      markdown: (node, renderer) => {
        const decisions = renderer.context.decisionReport?.(decisionReportRequest(node)) ?? null;
        if (decisions === null) return `*${renderer.escape(renderer.label("decisionReport"))}*`;
        if (decisions.length === 0) return `*${renderer.escape(renderer.label("noReportedDecisions"))}*`;
        return decisions
          .map((decision) => {
            const href = renderer.safeHref(decision.page.href);
            const title = renderer.escape(decision.page.title || renderer.label("untitledPage"));
            const source = `${href ? `[${title}](${markdownUrl(href)})` : title} · ${renderer.escape(formatDay(decision.date, renderer))}`;
            return `- ${renderer.escape(decision.text)}\n  ${source}`;
          })
          .join("\n");
      },
      text: () => "",
    },
  ],
  importers: [decisionReportImporter],
});
