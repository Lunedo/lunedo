import type { QueryClient } from "@tanstack/react-query";
import { itemHref } from "../spaces/item-paths.js";
import { type ItemDetails, itemNumberQuery } from "../spaces/space-queries.js";

const ITEM_NUMBER = /^#?([1-9][0-9]{0,14})$/;

export function itemNumberOf(text: string): number | null {
  const match = ITEM_NUMBER.exec(text.trim());
  return match?.[1] ? Number(match[1]) : null;
}

export function numberedItemHref(item: ItemDetails): string | null {
  return itemHref({ ...item, link: null }, item.spaceKey);
}

export async function hrefOfNumber(queryClient: QueryClient, text: string): Promise<string | null> {
  const number = itemNumberOf(text);
  if (number === null) return null;
  const item = await queryClient.fetchQuery(itemNumberQuery(number)).catch(() => null);
  return item ? numberedItemHref(item) : null;
}
