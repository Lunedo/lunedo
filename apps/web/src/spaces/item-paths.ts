import { slugify } from "@pagehall/editor-schema";
import { folderPath, pagePath, type TreeItem } from "./space-queries.js";

export function itemSlug(title: string): string {
  return slugify(title);
}

export function itemHref(
  item: Pick<TreeItem, "id" | "kind" | "title" | "link">,
  spaceKey: string,
): string | null {
  if (item.kind === "page") return pagePath(spaceKey, item.id, itemSlug(item.title));
  if (item.kind === "folder") return folderPath(spaceKey, item.id, itemSlug(item.title));
  const link = item.link;
  if (!link?.accessible) return null;
  if (link.url) return link.url;
  const target = link.target;
  if (!target || !link.itemId) return null;
  return target.kind === "folder"
    ? folderPath(target.spaceKey, link.itemId, itemSlug(target.title))
    : pagePath(target.spaceKey, link.itemId, itemSlug(target.title));
}

export function isExternal(href: string): boolean {
  return /^https?:\/\//.test(href);
}
