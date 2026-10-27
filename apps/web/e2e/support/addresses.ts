import { slugify } from "@lunedo/editor-schema";
import { expect, type Page } from "@playwright/test";

export type Segment = "pages" | "folders" | "blog" | "whiteboards" | "meetings" | "topics";

export interface Numbered {
  number: number;
  title: string;
}

export { slugify };

function withSlug(path: string, title: string): string {
  const slug = slugify(title);
  return slug ? `${path}/${slug}` : path;
}

export function itemPath(spaceKey: string, segment: Segment, item: Numbered): string {
  return withSlug(`/spaces/${encodeURIComponent(spaceKey)}/${segment}/${item.number}`, item.title);
}

export function pagePath(spaceKey: string, item: Numbered): string {
  return itemPath(spaceKey, "pages", item);
}

export function sharedPath(item: Numbered): string {
  return withSlug(`/shared/${item.number}`, item.title);
}

export function numberIn(url: string, segment: Segment): number {
  const match = new RegExp(`/${segment}/([1-9][0-9]*)(?:[/?#]|$)`).exec(new URL(url).pathname);
  if (!match?.[1]) throw new Error(`No ${segment} number in ${url}`);
  return Number(match[1]);
}

export async function itemOfNumber(
  page: Page,
  number: number,
): Promise<{ id: string; number: number; title: string; spaceKey: string }> {
  const response = await page.request.get(`/api/v1/items/by-number/${number}`);
  expect(response.status(), `GET /api/v1/items/by-number/${number}`).toBe(200);
  return (await response.json()) as { id: string; number: number; title: string; spaceKey: string };
}

export async function idIn(page: Page, segment: Segment): Promise<string> {
  return (await itemOfNumber(page, numberIn(page.url(), segment))).id;
}
