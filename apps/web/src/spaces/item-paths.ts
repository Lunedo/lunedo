import { slugify } from "@lunedo/editor-schema";
import {
  blogPostPath,
  folderPath,
  pagePath,
  seriesPath,
  type TreeItem,
  topicPath,
  whiteboardPath,
} from "./space-queries.js";

export function itemSlug(title: string): string {
  return slugify(title);
}

type Addressable = { kind: TreeItem["kind"]; number: number | null; title: string };

export function contentHref(item: Addressable, spaceKey: string): string | null {
  if (item.number === null) return null;
  const slug = itemSlug(item.title);
  if (item.kind === "page") return pagePath(spaceKey, item.number, slug);
  if (item.kind === "folder") return spaceKey ? folderPath(spaceKey, item.number, slug) : null;
  if (item.kind === "blogPost") return blogPostPath(spaceKey, item.number, slug);
  if (item.kind === "whiteboard") return whiteboardPath(spaceKey, item.number, slug);
  if (item.kind === "meetingSeries") return spaceKey ? seriesPath(spaceKey, item.number, slug) : null;
  if (item.kind === "meetingTopic") return spaceKey ? topicPath(spaceKey, item.number, slug) : null;
  return null;
}

export function itemHref(
  item: Pick<TreeItem, "id" | "kind" | "number" | "title" | "link">,
  spaceKey: string,
): string | null {
  if (item.kind !== "link") return contentHref(item, spaceKey);
  const link = item.link;
  if (!link?.accessible) return null;
  if (link.url) return link.url;
  const target = link.target;
  if (!target || !link.itemId || target.kind === "link") return null;
  return contentHref(target, target.spaceKey);
}

export function isExternal(href: string): boolean {
  return /^https?:\/\//.test(href);
}
