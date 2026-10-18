import { z } from "zod";
import { parseCql } from "../cql.js";
import {
  boundedInteger,
  isTrue,
  listValues,
  type MacroConverter,
  macroText,
  singleLine,
} from "../importing.js";
import type { ValidNode } from "../json.js";
import {
  attrOf,
  type ContentByLabelRequest,
  type ContentLabelSort,
  contentLabelSorts,
  defineModule,
  type HtmlRenderer,
  type LabeledContent,
  type LabeledContentKind,
  labeledContentKinds,
  type MarkdownRenderer,
  optional,
  type RelatedLabel,
  type WordRenderer,
} from "../module.js";
import { clearedAttributes } from "../portable.js";
import { element, markdownUrl } from "../text.js";
import { labelsValue, spaceIdsValue } from "../values.js";
import { type WordContent, wordText } from "../word.js";
import { filterFromCql, MAX_IMPORTED_QUERY_LENGTH, spacesFromParameter } from "./properties.js";
import { IGNORED_PAGE_REPORT_PARAMETERS, importedLabels, onlyKnownParameters, wordNote } from "./reports.js";

export const MAX_CONTENT_BY_LABEL_LIMIT = 100;
export const DEFAULT_CONTENT_BY_LABEL_LIMIT = 5;
export const MAX_LABEL_BLOCK_TITLE = 200;

const kindsValue = z
  .array(z.enum(labeledContentKinds))
  .min(1)
  .max(labeledContentKinds.length)
  .refine((kinds) => new Set(kinds).size === kinds.length, "Each kind may appear only once");

export function contentByLabelRequest(node: { attrs: Record<string, unknown> }): ContentByLabelRequest {
  return {
    labels: attrOf<string[]>(node, "labels"),
    matchAll: attrOf<boolean>(node, "matchAll"),
    spaceIds: attrOf<string[]>(node, "spaceIds"),
    kinds: attrOf<LabeledContentKind[]>(node, "kinds"),
    sort: attrOf<ContentLabelSort>(node, "sort"),
    reverse: attrOf<boolean>(node, "reverse"),
    limit: attrOf<number>(node, "limit"),
    excerpts: attrOf<boolean>(node, "excerpts"),
  };
}

function json(node: ValidNode, name: string): string | null {
  const value = attrOf<string[]>(node, name);
  return value.length > 0 ? JSON.stringify(value) : null;
}

function heading(node: ValidNode, fallback: string): string {
  return attrOf<string>(node, "title") || fallback;
}

function itemsOf(
  node: ValidNode,
  renderer: HtmlRenderer | MarkdownRenderer | WordRenderer,
): readonly LabeledContent[] | null {
  return renderer.context.contentByLabel?.(contentByLabelRequest(node)) ?? null;
}

function details(item: LabeledContent, node: ValidNode): string[] {
  return [
    ...(attrOf<boolean>(node, "showSpace") && item.space ? [item.space] : []),
    ...(attrOf<boolean>(node, "showLabels") && item.labels.length > 0 ? [item.labels.join(", ")] : []),
  ];
}

function contentByLabelHtml(node: ValidNode, renderer: HtmlRenderer): string {
  const items = itemsOf(node, renderer);
  const title = heading(node, renderer.label("contentByLabel"));
  let content: string;
  if (items === null) content = element("p", {}, renderer.escape(renderer.label("contentByLabel")));
  else if (items.length === 0) {
    content = element(
      "p",
      { class: "ph-listing-empty" },
      renderer.escape(renderer.label("noLabeledContent")),
    );
  } else {
    content = element(
      "ul",
      {},
      items
        .map((item) => {
          const href = renderer.safeHref(item.href);
          const name = renderer.escape(item.title || renderer.label("untitledPage"));
          const meta = details(item, node);
          return element(
            "li",
            { "data-kind": item.kind },
            `${href ? element("a", { href }, name) : name}${meta.length > 0 ? element("span", { class: "ph-listing-meta" }, renderer.escape(meta.join(" · "))) : ""}${item.excerpt ? element("p", { class: "ph-listing-excerpt" }, renderer.escape(item.excerpt)) : ""}`,
          );
        })
        .join(""),
    );
  }
  return element(
    "section",
    {
      class: "ph-content-by-label",
      "aria-label": title,
      "data-labels": json(node, "labels"),
      "data-match-all": attrOf<boolean>(node, "matchAll") ? "true" : null,
      "data-space-ids": json(node, "spaceIds"),
      "data-kinds": JSON.stringify(attrOf<string[]>(node, "kinds")),
      "data-sort": attrOf<string>(node, "sort"),
      "data-reverse": attrOf<boolean>(node, "reverse") ? "true" : null,
      "data-limit": attrOf<number>(node, "limit"),
      "data-excerpts": attrOf<boolean>(node, "excerpts") ? "true" : null,
      "data-show-labels": attrOf<boolean>(node, "showLabels") ? "true" : "false",
      "data-show-space": attrOf<boolean>(node, "showSpace") ? "true" : "false",
      "data-title": attrOf<string>(node, "title") || null,
    },
    `${items !== null && attrOf<string>(node, "title") ? element("h3", {}, renderer.escape(title)) : ""}${content}`,
  );
}

function contentByLabelWord(node: ValidNode, renderer: WordRenderer): WordContent[] {
  const items = itemsOf(node, renderer);
  if (items === null) return wordNote(renderer.label("contentByLabel"));
  if (items.length === 0) return wordNote(renderer.label("noLabeledContent"));
  const title = attrOf<string>(node, "title");
  return [
    ...(title ? [{ type: "paragraph" as const, content: [wordText(title, { bold: true })] }] : []),
    {
      type: "list",
      ordered: false,
      start: 1,
      items: items.map((item) => {
        const href = renderer.safeHref(item.href);
        const meta = details(item, node);
        return {
          checked: null,
          content: [
            {
              type: "paragraph" as const,
              content: [
                wordText(item.title || renderer.label("untitledPage"), href ? { link: href } : {}),
                ...(meta.length > 0 ? [wordText(` · ${meta.join(" · ")}`, { muted: true })] : []),
              ],
            },
            ...(item.excerpt ? [{ type: "paragraph" as const, content: [wordText(item.excerpt)] }] : []),
          ],
        };
      }),
    },
  ];
}

function contentByLabelMarkdown(node: ValidNode, renderer: MarkdownRenderer): string {
  const items = itemsOf(node, renderer);
  if (items === null) return `*${renderer.escape(renderer.label("contentByLabel"))}*`;
  if (items.length === 0) return `*${renderer.escape(renderer.label("noLabeledContent"))}*`;
  const title = attrOf<string>(node, "title");
  const lines = items.map((item) => {
    const href = renderer.safeHref(item.href);
    const name = renderer.escape(item.title || renderer.label("untitledPage"));
    const meta = details(item, node);
    const line = `- ${href ? `[${name}](${markdownUrl(href)})` : name}${meta.length > 0 ? ` · ${renderer.escape(meta.join(" · "))}` : ""}`;
    return item.excerpt ? `${line}\n  ${renderer.escape(item.excerpt)}` : line;
  });
  return [...(title ? [`**${renderer.escape(title)}**`, ""] : []), ...lines].join("\n");
}

function relatedOf(
  node: ValidNode,
  renderer: HtmlRenderer | MarkdownRenderer | WordRenderer,
): readonly RelatedLabel[] | null {
  return renderer.context.relatedLabels?.({ labels: attrOf<string[]>(node, "labels") }) ?? null;
}

const CONFLUENCE_SORTS: Readonly<Record<string, ContentLabelSort>> = {
  "": "modified",
  modified: "modified",
  creation: "created",
  created: "created",
  title: "title",
};

const CONTENT_BY_LABEL_PARAMETERS = new Set([
  ...IGNORED_PAGE_REPORT_PARAMETERS,
  "labels",
  "cql",
  "spaces",
  "space",
  "type",
  "types",
  "sort",
  "reverse",
  "max",
  "maxResults",
  "excerpt",
  "excerptType",
  "showLabels",
  "showSpace",
  "title",
  "operator",
  "excludeCurrent",
]);

function kindsOf(types: readonly string[]): LabeledContentKind[] | null {
  if (types.length === 0) return ["page", "blogPost"];
  const kinds: LabeledContentKind[] = [];
  for (const type of types) {
    const kind =
      type.toLowerCase() === "page" ? "page" : type.toLowerCase() === "blogpost" ? "blogPost" : null;
    if (!kind) return null;
    if (!kinds.includes(kind)) kinds.push(kind);
  }
  return kinds;
}

const contentByLabelImporter: MacroConverter = {
  source: "confluence",
  macros: ["contentbylabel"],
  convert: (macro, context) => {
    if (!onlyKnownParameters(macro, CONTENT_BY_LABEL_PARAMETERS)) return null;
    const sort = CONFLUENCE_SORTS[(macroText(macro, "sort") ?? "").toLowerCase()];
    const maxText = macroText(macro, "max") ?? macroText(macro, "maxResults") ?? "";
    const limit = maxText.length > 0 ? boundedInteger(maxText, 1, 999_999) : DEFAULT_CONTENT_BY_LABEL_LIMIT;
    if (!sort || limit === null) return null;
    const cql = macroText(macro, "cql") ?? "";
    let labels = importedLabels(macroText(macro, "labels"));
    let matchAll = (macroText(macro, "operator") ?? "").toUpperCase() === "AND";
    let spaceIds = spacesFromParameter(macro, macroText(macro, "spaces") ? "spaces" : "space", context);
    let kinds = kindsOf(listValues(macroText(macro, "type") ?? macroText(macro, "types")));
    let query: string | null = null;
    const conditions = cql.length > 0 ? parseCql(cql) : null;
    const filter = conditions
      ? filterFromCql(conditions, context, new Set(["label", "space", "type"]))
      : null;
    const filterKinds = filter ? kindsOf(filter.types) : null;
    if (filter && filterKinds && (filter.labelGroups <= 1 || filter.labelGroups === filter.labels.length)) {
      labels = filter.labels;
      matchAll = filter.labelGroups > 1;
      spaceIds = filter.spaceIds;
      kinds = filterKinds;
    } else if (cql.length > 0) {
      query = cql.slice(0, MAX_IMPORTED_QUERY_LENGTH);
    }
    if (labels === null || spaceIds === null || kinds === null) {
      if (cql.length === 0) return null;
      query = cql.slice(0, MAX_IMPORTED_QUERY_LENGTH);
      labels = labels ?? [];
      spaceIds = spaceIds ?? [];
      kinds = kinds ?? ["page", "blogPost"];
    }
    if (query !== null) context.note({ code: "unmappedQuery", macro: "contentbylabel", query });
    if (isTrue(macroText(macro, "excludeCurrent"))) {
      context.note({ code: "macroOptionDropped", macro: "contentbylabel", option: "excludeCurrent" });
    }
    const excerptType = (macroText(macro, "excerptType") ?? "").toLowerCase();
    return [
      {
        type: "contentByLabel",
        attrs: {
          labels,
          matchAll,
          spaceIds,
          kinds,
          sort,
          reverse: isTrue(macroText(macro, "reverse")),
          limit: Math.min(limit, MAX_CONTENT_BY_LABEL_LIMIT),
          excerpts: isTrue(macroText(macro, "excerpt")) || (excerptType !== "" && excerptType !== "none"),
          showLabels: macroText(macro, "showLabels")?.toLowerCase() !== "false",
          showSpace: macroText(macro, "showSpace")?.toLowerCase() !== "false",
          title: singleLine(macroText(macro, "title")).slice(0, MAX_LABEL_BLOCK_TITLE),
          query,
        },
      },
    ];
  },
};

const relatedLabelsImporter: MacroConverter = {
  source: "confluence",
  macros: ["related-labels"],
  convert: (macro) => {
    if (!onlyKnownParameters(macro, new Set(["labels", "title"]))) return null;
    const labels = importedLabels(macroText(macro, "labels"));
    if (labels === null) return null;
    return [
      {
        type: "relatedLabels",
        attrs: { labels, title: singleLine(macroText(macro, "title")).slice(0, MAX_LABEL_BLOCK_TITLE) },
      },
    ];
  },
};

export const contentByLabelModule = defineModule({
  name: "contentByLabel",
  nodes: [
    {
      name: "contentByLabel",
      spec: { group: "block", atom: true, selectable: true, draggable: true },
      attrs: {
        labels: optional(labelsValue, []),
        matchAll: optional(z.boolean(), false),
        spaceIds: optional(spaceIdsValue, []),
        kinds: optional(kindsValue, ["page", "blogPost"]),
        sort: optional(z.enum(contentLabelSorts), "modified"),
        reverse: optional(z.boolean(), false),
        limit: optional(
          z.number().int().min(1).max(MAX_CONTENT_BY_LABEL_LIMIT),
          DEFAULT_CONTENT_BY_LABEL_LIMIT,
        ),
        excerpts: optional(z.boolean(), false),
        showLabels: optional(z.boolean(), true),
        showSpace: optional(z.boolean(), true),
        title: optional(z.string().max(MAX_LABEL_BLOCK_TITLE), ""),
        query: optional(z.string().min(1).max(MAX_IMPORTED_QUERY_LENGTH).nullable(), null),
      },
      portable: clearedAttributes("report", { spaceIds: [], query: null }),
      html: contentByLabelHtml,
      word: contentByLabelWord,
      markdown: contentByLabelMarkdown,
      text: () => "",
    },
  ],
  importers: [contentByLabelImporter],
});

export const relatedLabelsModule = defineModule({
  name: "relatedLabels",
  nodes: [
    {
      name: "relatedLabels",
      spec: { group: "block", atom: true, selectable: true, draggable: true },
      attrs: {
        labels: optional(labelsValue, []),
        title: optional(z.string().max(MAX_LABEL_BLOCK_TITLE), ""),
      },
      html: (node, renderer) => {
        const labels = relatedOf(node, renderer);
        const title = heading(node, renderer.label("relatedLabels"));
        const content =
          labels === null
            ? element("p", {}, renderer.escape(renderer.label("relatedLabels")))
            : labels.length === 0
              ? element(
                  "p",
                  { class: "ph-listing-empty" },
                  renderer.escape(renderer.label("noRelatedLabels")),
                )
              : element(
                  "ul",
                  { class: "ph-label-list" },
                  labels
                    .map((label) => {
                      const href = renderer.safeHref(label.href);
                      const text = renderer.escape(label.label);
                      return element("li", {}, href ? element("a", { href }, text) : text);
                    })
                    .join(""),
                );
        return element(
          "section",
          {
            class: "ph-related-labels",
            "aria-label": title,
            "data-labels": json(node, "labels"),
            "data-title": attrOf<string>(node, "title") || null,
          },
          `${labels === null ? "" : element("h3", {}, renderer.escape(title))}${content}`,
        );
      },
      word: (node, renderer) => {
        const labels = relatedOf(node, renderer);
        const title = heading(node, renderer.label("relatedLabels"));
        if (labels === null) return wordNote(renderer.label("relatedLabels"));
        return [
          { type: "paragraph", content: [wordText(title, { bold: true })] },
          ...(labels.length === 0
            ? wordNote(renderer.label("noRelatedLabels"))
            : [
                {
                  type: "paragraph" as const,
                  content: labels.flatMap((label, index) => {
                    const href = renderer.safeHref(label.href);
                    return [
                      ...(index > 0 ? [wordText(", ")] : []),
                      wordText(label.label, href ? { link: href } : {}),
                    ];
                  }),
                },
              ]),
        ];
      },
      markdown: (node, renderer) => {
        const labels = relatedOf(node, renderer);
        if (labels === null) return `*${renderer.escape(renderer.label("relatedLabels"))}*`;
        const title = `**${renderer.escape(heading(node, renderer.label("relatedLabels")))}**`;
        if (labels.length === 0) return `${title}\n\n*${renderer.escape(renderer.label("noRelatedLabels"))}*`;
        const list = labels.map((label) => {
          const href = renderer.safeHref(label.href);
          const text = renderer.escape(label.label);
          return href ? `[${text}](${markdownUrl(href)})` : text;
        });
        return `${title}\n\n${list.join(", ")}`;
      },
      text: () => "",
    },
  ],
  importers: [relatedLabelsImporter],
});
