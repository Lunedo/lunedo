import {
  bodyBlocks,
  type ImportText,
  type MacroConverter,
  type MacroImportContext,
  macroParameterNames,
  macroText,
  type SourceElement,
  singleLine,
} from "../importing.js";
import type { NodeJson } from "../json.js";
import { defineModule } from "../module.js";
import { isAllowedHref } from "../values.js";
import { macroUrl } from "./embeds.js";

const TABLE_FILTER_OPTIONS: Readonly<Record<string, string>> = {
  sort: "sort",
  column: "filter",
  userfilter: "filter",
  numberfilter: "filter",
  datefilter: "filter",
  iconfilter: "filter",
  globalFilter: "filter",
  globalfilter: "filter",
  default: "filter",
  hideColumns: "hiddenColumns",
  order: "columnOrder",
  rowsPerPage: "pagination",
  numbering: "rowNumbers",
};

function note(text: string): NodeJson {
  return {
    type: "callout",
    attrs: { variant: "note" },
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

function macroName(macro: SourceElement): string {
  return macro.attributes["ac:name"] ?? "";
}

const tableFilterImporter: MacroConverter = {
  source: "confluence",
  macros: ["table-filter"],
  convert: (macro, context) => {
    const dropped = new Set<string>();
    for (const name of macroParameterNames(macro)) {
      const option = TABLE_FILTER_OPTIONS[name];
      if (option && singleLine(macroText(macro, name)).length > 0) dropped.add(option);
    }
    for (const option of [...dropped].sort()) {
      context.note({ code: "macroOptionDropped", macro: "table-filter", option });
    }
    return bodyBlocks(macro, context);
  },
};

function calculatedTable(text: ImportText): MacroConverter["convert"] {
  return (macro, context) => {
    context.note({ code: "chartNotImported", macro: macroName(macro) });
    return [note(context.text(text)), ...bodyBlocks(macro, context)];
  };
}

const chartImporters: MacroConverter[] = [
  { source: "confluence", macros: ["table-chart"], convert: calculatedTable("chartNotImported") },
  { source: "confluence", macros: ["pivot-table"], convert: calculatedTable("pivotNotImported") },
];

const NUMBERING_OPTIONS = ["number-format", "start-numbering-with", "start-numbering-at", "skip-headings"];

const numberedHeadingsImporter: MacroConverter = {
  source: "confluence",
  macros: ["numberedheadings", "numbered-headings"],
  convert: (macro, context) => {
    context.numberHeadings();
    const format = singleLine(macroText(macro, "number-format")).toLowerCase();
    for (const option of NUMBERING_OPTIONS) {
      const value = singleLine(macroText(macro, option));
      if (
        value.length === 0 ||
        (option === "number-format" && ["decimal", "full-decimal"].includes(format))
      ) {
        continue;
      }
      context.note({ code: "macroOptionDropped", macro: macroName(macro), option });
    }
    if (macroParameterNames(macro).some((name) => /^h[1-6]$/.test(name))) {
      context.note({ code: "macroOptionDropped", macro: macroName(macro), option: "headingFormats" });
    }
    return bodyBlocks(macro, context);
  },
};

const ISSUE_KEY = /^[A-Z][A-Z0-9_]{0,49}-\d{1,9}$/;

function notImported(context: MacroImportContext): NodeJson {
  return { type: "text", text: ` ${context.text("jiraNotImported")}`, marks: [{ type: "italic" }] };
}

function issueLink(key: string, context: MacroImportContext): NodeJson {
  const href = context.jiraIssueUrl(key);
  return href && isAllowedHref(href)
    ? { type: "text", text: key, marks: [{ type: "link", attrs: { href } }] }
    : { type: "text", text: key, marks: [{ type: "code" }] };
}

function jqlOf(macro: SourceElement): string | null {
  const query = singleLine(macroText(macro, "jqlQuery"));
  if (query.length > 0) return query;
  const url = macroUrl(macro, ["url"]);
  if (!url) return null;
  try {
    return singleLine(new URL(url).searchParams.get("jqlQuery"));
  } catch {
    return null;
  }
}

const jiraImporter: MacroConverter = {
  source: "confluence",
  macros: ["jira", "jiraissues"],
  inline: true,
  convert: (macro, context) => {
    const key = singleLine(macroText(macro, "key")).toUpperCase();
    const name = macroName(macro);
    if (ISSUE_KEY.test(key)) {
      context.note({ code: "jiraNotImported", macro: name, issues: key });
      return [issueLink(key, context), notImported(context)];
    }
    const query = jqlOf(macro);
    if (!query) return null;
    context.note({ code: "jiraNotImported", macro: name, issues: query.slice(0, 255) });
    return [{ type: "text", text: query.slice(0, 2000), marks: [{ type: "code" }] }, notImported(context)];
  },
};

export const thirdPartyMacrosModule = defineModule({
  name: "thirdPartyMacros",
  importers: [tableFilterImporter, ...chartImporters, numberedHeadingsImporter, jiraImporter],
});
