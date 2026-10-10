import { z } from "zod";
import {
  boundedInteger,
  isTrue,
  type MacroConverter,
  macroParameter,
  macroReference,
  macroText,
} from "../importing.js";
import type { ValidNode } from "../json.js";
import {
  attrOf,
  type ChildPageSort,
  type ChildPagesRequest,
  childPageSorts,
  defineModule,
  type HtmlRenderer,
  type ListedAttachment,
  type ListedPage,
  type MarkdownRenderer,
  optional,
} from "../module.js";
import { element, markdownUrl, prefixLines } from "../text.js";
import { uuidValue } from "../values.js";

export const MAX_CHILD_PAGE_DEPTH = 10;
export const MAX_FILE_TYPES = 20;

const fileTypeValue = z.string().regex(/^[a-z0-9]{1,16}$/, "Expected a file extension without a dot");

const CONFLUENCE_SORTS: Readonly<Record<string, ChildPageSort>> = {
  creation: "created",
  title: "title",
  modified: "modified",
};

export function childPagesRequest(node: { attrs: Record<string, unknown> }): ChildPagesRequest {
  return {
    pageId: attrOf<string | null>(node, "pageId"),
    depth: attrOf<number | null>(node, "depth"),
    sort: attrOf<ChildPageSort>(node, "sort"),
    reverse: attrOf<boolean>(node, "reverse"),
  };
}

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function matchesFileTypes(name: string, fileTypes: readonly string[]): boolean {
  return fileTypes.length === 0 || fileTypes.includes(fileExtension(name));
}

function pagesHtml(pages: readonly ListedPage[], renderer: HtmlRenderer, level: number): string {
  if (pages.length === 0 || level > MAX_CHILD_PAGE_DEPTH) return "";
  const items = pages.map((page) => {
    const href = renderer.safeHref(page.href);
    const title = renderer.escape(page.title || renderer.label("untitledPage"));
    const link = href ? element("a", { href }, title) : title;
    return element("li", {}, `${link}${pagesHtml(page.children, renderer, level + 1)}`);
  });
  return element("ul", {}, items.join(""));
}

function pagesMarkdown(pages: readonly ListedPage[], renderer: MarkdownRenderer, level: number): string[] {
  if (level > MAX_CHILD_PAGE_DEPTH) return [];
  return pages.flatMap((page) => {
    const href = renderer.safeHref(page.href);
    const title = renderer.escape(page.title || renderer.label("untitledPage"));
    const line = `${"  ".repeat(level - 1)}- ${href ? `[${title}](${markdownUrl(href)})` : title}`;
    return [line, ...pagesMarkdown(page.children, renderer, level + 1)];
  });
}

function listedAttachments(
  node: ValidNode,
  renderer: HtmlRenderer | MarkdownRenderer,
): ListedAttachment[] | null {
  const attachments = renderer.context.attachmentList?.() ?? null;
  if (!attachments) return null;
  const fileTypes = attrOf<string[]>(node, "fileTypes");
  return attachments.filter((attachment) => matchesFileTypes(attachment.name, fileTypes));
}

function attachmentHref(
  attachment: ListedAttachment,
  renderer: HtmlRenderer | MarkdownRenderer,
): string | null {
  const resolved = renderer.context.attachment?.(attachment.id) ?? null;
  return resolved ? renderer.safeHref(resolved.href) : null;
}

const childPagesImporter: MacroConverter = {
  source: "confluence",
  macros: ["children"],
  convert: (macro, context) => {
    let pageId: string | null = null;
    if (macroParameter(macro, "page")) {
      const reference = macroReference(macro, "page", "ri:page");
      if (!reference) return null;
      pageId = context.page(reference);
      if (!pageId) return null;
    }
    const depth = boundedInteger(macroText(macro, "depth"), 1, 999);
    const sort = CONFLUENCE_SORTS[(macroText(macro, "sort") ?? "").toLowerCase()] ?? "tree";
    return [
      {
        type: "childPages",
        attrs: {
          pageId,
          depth:
            depth !== null
              ? Math.min(depth, MAX_CHILD_PAGE_DEPTH)
              : isTrue(macroText(macro, "all"))
                ? null
                : 1,
          sort,
          reverse: isTrue(macroText(macro, "reverse")),
        },
      },
    ];
  },
};

function confluenceFileTypes(patterns: string | null): string[] | null {
  if (patterns === null || patterns.length === 0) return [];
  const types: string[] = [];
  for (const pattern of patterns.split(",")) {
    const value = pattern
      .trim()
      .replace(/^\.\*\\?\.?|^\*?\./, "")
      .toLowerCase();
    if (value.length === 0) continue;
    if (!/^[a-z0-9]{1,16}$/.test(value)) return null;
    if (!types.includes(value)) types.push(value);
  }
  return types.length <= MAX_FILE_TYPES ? types : null;
}

const attachmentListImporter: MacroConverter = {
  source: "confluence",
  macros: ["attachments"],
  convert: (macro) => {
    if ((macroText(macro, "page") ?? "").length > 0 || macroReference(macro, "page", "ri:page")) return null;
    if ((macroText(macro, "labels") ?? "").length > 0) return null;
    const fileTypes = confluenceFileTypes(macroText(macro, "patterns"));
    return fileTypes ? [{ type: "attachmentList", attrs: { fileTypes } }] : null;
  },
};

export const childPagesModule = defineModule({
  name: "childPages",
  nodes: [
    {
      name: "childPages",
      spec: { group: "block", atom: true, selectable: true, draggable: true },
      attrs: {
        pageId: optional(uuidValue.nullable(), null),
        depth: optional(z.number().int().min(1).max(MAX_CHILD_PAGE_DEPTH).nullable(), null),
        sort: optional(z.enum(childPageSorts), "tree"),
        reverse: optional(z.boolean(), false),
      },
      html: (node, renderer) => {
        const request = childPagesRequest(node);
        const pages = renderer.context.childPages?.(request) ?? null;
        const content =
          pages === null
            ? element("p", {}, renderer.escape(renderer.label("childPages")))
            : pages.length === 0
              ? element("p", { class: "ph-listing-empty" }, renderer.escape(renderer.label("noChildPages")))
              : pagesHtml(pages, renderer, 1);
        return element(
          "nav",
          {
            class: "ph-child-pages",
            "aria-label": renderer.label("childPages"),
            "data-page-id": request.pageId,
            "data-depth": request.depth ?? "all",
            "data-sort": request.sort,
            "data-reverse": request.reverse ? "true" : null,
          },
          content,
        );
      },
      markdown: (node, renderer) => {
        const pages = renderer.context.childPages?.(childPagesRequest(node)) ?? null;
        if (pages === null) return `*${renderer.escape(renderer.label("childPages"))}*`;
        if (pages.length === 0) return `*${renderer.escape(renderer.label("noChildPages"))}*`;
        return pagesMarkdown(pages, renderer, 1).join("\n");
      },
      text: () => "",
    },
  ],
  importers: [childPagesImporter],
});

export const attachmentListModule = defineModule({
  name: "attachmentList",
  nodes: [
    {
      name: "attachmentList",
      spec: { group: "block", atom: true, selectable: true, draggable: true },
      attrs: {
        fileTypes: optional(
          z
            .array(fileTypeValue)
            .max(MAX_FILE_TYPES)
            .refine((types) => new Set(types).size === types.length, "Each file type may appear only once"),
          [],
        ),
      },
      html: (node, renderer) => {
        const attachments = listedAttachments(node, renderer);
        const items = (attachments ?? []).map((attachment) => {
          const href = attachmentHref(attachment, renderer);
          const name = renderer.escape(attachment.name);
          return element(
            "li",
            { "data-attachment-id": attachment.id },
            `${href ? element("a", { href, rel: "noopener noreferrer" }, name) : name} ${element("span", { class: "ph-attachment-size" }, `(${renderer.escape(renderer.formatSize(attachment.size))})`)}`,
          );
        });
        const content =
          attachments === null
            ? element("p", {}, renderer.escape(renderer.label("attachmentList")))
            : items.length === 0
              ? element("p", { class: "ph-listing-empty" }, renderer.escape(renderer.label("noAttachments")))
              : element("ul", {}, items.join(""));
        return element(
          "section",
          {
            class: "ph-attachment-list",
            "aria-label": renderer.label("attachmentList"),
            "data-file-types": attrOf<string[]>(node, "fileTypes").join(",") || null,
          },
          content,
        );
      },
      markdown: (node, renderer) => {
        const attachments = listedAttachments(node, renderer);
        if (attachments === null) return `*${renderer.escape(renderer.label("attachmentList"))}*`;
        if (attachments.length === 0) return `*${renderer.escape(renderer.label("noAttachments"))}*`;
        return attachments
          .map((attachment) => {
            const href = attachmentHref(attachment, renderer);
            const name = renderer.escape(attachment.name);
            return prefixLines(
              `${href ? `[${name}](${markdownUrl(href)})` : name} (${renderer.escape(renderer.formatSize(attachment.size))})`,
              "- ",
            );
          })
          .join("\n");
      },
      text: () => "",
    },
  ],
  importers: [attachmentListImporter],
});
