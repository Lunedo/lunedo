import { MAX_NAME_LENGTH, NameScope } from "./names.js";
import type { ExportFormat, Locator } from "./renderer.js";

export type PlannedKind = "page" | "folder" | "link";

export interface PlanInput {
  id: string;
  parentId: string | null;
  path: readonly string[];
  kind: PlannedKind;
  title: string;
  linkUrl: string | null;
  linkItemId: string | null;
}

export interface PlanAttachment {
  id: string;
  itemId: string;
  name: string;
  fileId: string;
  size: number;
}

export interface PlannedAttachment extends PlanAttachment {
  path: string;
}

export interface PlannedNode {
  id: string;
  kind: PlannedKind;
  title: string;
  linkUrl: string | null;
  linkItemId: string | null;
  folder: readonly string[];
  stem: string | null;
  children: PlannedNode[];
  attachments: PlannedAttachment[];
}

export interface ExportPlan {
  roots: PlannedNode[];
  pages: PlannedNode[];
  attachments: PlannedAttachment[];
  locator(node: PlannedNode | null): Locator;
}

export const INDEX_NAME = "index";
export const MAX_PATH_LENGTH = 239;
export const MIN_NAME_LENGTH = 16;
const LONGEST_EXTENSION = 11;
const PAGE_EXTENSION = ".html".length;
const MIN_FILE_LENGTH = MIN_NAME_LENGTH + LONGEST_EXTENSION;

function lengthOf(text: string): number {
  return [...text].length;
}

function prefixLength(folder: readonly string[]): number {
  return folder.reduce((total, segment) => total + lengthOf(segment) + 1, 0);
}

function encodePath(segments: readonly string[]): string {
  return segments.map((segment) => encodeURIComponent(segment)).join("/");
}

function relative(from: readonly string[], to: readonly string[]): string {
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common += 1;
  return encodePath([...from.slice(common).map(() => ".."), ...to.slice(common)]);
}

export function planExport(options: {
  rootId: string | null;
  items: readonly PlanInput[];
  attachments: readonly PlanAttachment[];
  untitledPage: string;
  untitledFolder: string;
  flat?: boolean;
}): ExportPlan {
  const included = new Map(options.items.map((item) => [item.id, item]));
  const nodes = new Map<string, PlannedNode>();
  const children = new Map<string | null, PlanInput[]>();
  for (const item of options.items) {
    let parent: string | null = null;
    if (item.id !== options.rootId) {
      for (let index = item.path.length - 2; index >= 0; index -= 1) {
        const ancestor = item.path[index] ?? "";
        if (included.has(ancestor)) {
          parent = ancestor;
          break;
        }
      }
    }
    const list = children.get(parent) ?? [];
    list.push(item);
    children.set(parent, list);
  }
  const attachmentsOf = new Map<string, PlanAttachment[]>();
  for (const attachment of options.attachments) {
    const list = attachmentsOf.get(attachment.itemId) ?? [];
    list.push(attachment);
    attachmentsOf.set(attachment.itemId, list);
  }
  const heights = new Map<string, number>();
  const height = (item: PlanInput): number => {
    const known = heights.get(item.id);
    if (known !== undefined) return known;
    let levels = 0;
    for (const child of children.get(item.id) ?? []) {
      if (child.kind !== "link") levels = Math.max(levels, 1 + height(child));
    }
    heights.set(item.id, levels);
    return levels;
  };
  const pages: PlannedNode[] = [];
  const attachments: PlannedAttachment[] = [];
  const rootScope = new NameScope();
  rootScope.reserve(`${INDEX_NAME}.html`);
  rootScope.reserve(`${INDEX_NAME}.md`);

  const place = (item: PlanInput, folder: readonly string[], scope: NameScope): PlannedNode => {
    const fallback = item.kind === "folder" ? options.untitledFolder : options.untitledPage;
    const node: PlannedNode = {
      id: item.id,
      kind: item.kind,
      title: item.title,
      linkUrl: item.linkUrl,
      linkItemId: item.linkItemId,
      folder,
      stem: null,
      children: [],
      attachments: [],
    };
    nodes.set(item.id, node);
    if (item.kind === "link") return node;
    const room = MAX_PATH_LENGTH - prefixLength(folder);
    const folderLength = Math.min(
      MAX_NAME_LENGTH,
      room - 1 - height(item) * (MIN_NAME_LENGTH + 1) - MIN_FILE_LENGTH,
    );
    const flat = options.flat === true || folderLength < MIN_NAME_LENGTH;
    const own = flat ? folder : [...folder, scope.take(item.title.trim() || fallback, [""], folderLength)];
    const inner = flat ? scope : new NameScope();
    const fileRoom = MAX_PATH_LENGTH - prefixLength(own);
    if (item.kind === "page") {
      node.stem = inner.take(
        item.title.trim() || fallback,
        [".md", ".html"],
        Math.min(MAX_NAME_LENGTH, fileRoom - PAGE_EXTENSION),
      );
      pages.push(node);
    }
    node.folder = own;
    for (const child of children.get(item.id) ?? []) node.children.push(place(child, own, inner));
    for (const attachment of item.kind === "page" ? (attachmentsOf.get(item.id) ?? []) : []) {
      const name = inner.file(attachment.name, "attachment", Math.min(MAX_NAME_LENGTH, fileRoom));
      const planned = { ...attachment, path: [...own, name].join("/") };
      node.attachments.push(planned);
      attachments.push(planned);
    }
    return node;
  };

  const roots = (children.get(null) ?? []).map((item) => place(item, [], rootScope));

  const fileOf = (node: PlannedNode, format: ExportFormat): string[] => [
    ...node.folder,
    `${node.stem ?? ""}.${format === "markdown" ? "md" : "html"}`,
  ];
  const attachmentPaths = new Map(
    attachments.map((attachment) => [attachment.id, attachment.path.split("/")]),
  );

  return {
    roots,
    pages,
    attachments,
    locator(from) {
      const folder = from?.folder ?? [];
      return {
        page(pageId, format) {
          const target = nodes.get(pageId);
          return target?.stem ? relative(folder, fileOf(target, format)) : null;
        },
        attachment(attachmentId) {
          const path = attachmentPaths.get(attachmentId);
          return path ? relative(folder, path) : null;
        },
        index(format) {
          return options.flat
            ? null
            : relative(folder, [`${INDEX_NAME}.${format === "markdown" ? "md" : "html"}`]);
        },
      };
    },
  };
}

export function pageFile(node: PlannedNode, format: ExportFormat): string {
  return [...node.folder, `${node.stem ?? ""}.${format === "markdown" ? "md" : "html"}`].join("/");
}
