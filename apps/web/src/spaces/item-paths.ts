import { slugify } from "@pagehall/editor-schema";
import { blogPostPath, folderPath, pagePath, type TreeItem } from "./space-queries.js";

export function itemSlug(title: string): string {
  return slugify(title);
}

export function itemHref(
  item: Pick<TreeItem, "id" | "kind" | "title" | "link">,
  spaceKey: string,
): string | null {
  if (item.kind === "page") return pagePath(spaceKey, item.id, itemSlug(item.title));
  if (item.kind === "folder") return folderPath(spaceKey, item.id, itemSlug(item.title));
  if (item.kind === "blogPost") return blogPostPath(spaceKey, item.id, itemSlug(item.title));
  if (item.kind !== "link") return null;
  const link = item.link;
  if (!link?.accessible) return null;
  if (link.url) return link.url;
  const target = link.target;
  if (!target || !link.itemId) return null;
  const slug = itemSlug(target.title);
  if (target.kind === "page") return pagePath(target.spaceKey, link.itemId, slug);
  if (target.kind === "folder") return folderPath(target.spaceKey, link.itemId, slug);
  if (target.kind === "blogPost") return blogPostPath(target.spaceKey, link.itemId, slug);
  return null;
}

export function isExternal(href: string): boolean {
  return /^https?:\/\//.test(href);
}
