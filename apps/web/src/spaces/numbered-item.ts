import { type QueryClient, useQuery } from "@tanstack/react-query";
import { notFound, redirect } from "@tanstack/react-router";
import { itemHref } from "./item-paths.js";
import { type ItemDetails, itemNumberQuery, itemQuery } from "./space-queries.js";

const ITEM_NUMBER = /^[1-9][0-9]{0,14}$/;

export const itemNumberParams = {
  parse: <T extends { number: string; slug?: string }>(
    params: T,
  ): Omit<T, "number"> & { number: number; slug?: string } => {
    if (!ITEM_NUMBER.test(params.number)) throw notFound();
    return { ...params, number: Number(params.number) };
  },
  stringify: <T extends { number: number }>(params: T): Omit<T, "number"> & { number: string } => ({
    ...params,
    number: String(params.number),
  }),
};

export type ItemLocation = { pathname: string; searchStr: string; hash: string };

export async function resolveNumberedItem(
  queryClient: QueryClient,
  number: number,
  location: ItemLocation,
): Promise<ItemDetails | null> {
  const item = await queryClient.fetchQuery({ ...itemNumberQuery(number), staleTime: 0 }).catch(() => null);
  if (!item) return null;
  return keepItem(queryClient, item, location);
}

export function keepItem(queryClient: QueryClient, item: ItemDetails, location: ItemLocation): ItemDetails {
  queryClient.setQueryData(itemQuery(item.id).queryKey, item);
  const href = itemHref({ ...item, link: null }, item.spaceKey);
  if (href && decodeURI(href) !== decodeURI(location.pathname)) {
    throw redirect({
      href: `${href}${location.searchStr}${location.hash ? `#${location.hash}` : ""}`,
      replace: true,
    });
  }
  return item;
}

export function useNumberedItem(number: number) {
  const resolved = useQuery({ ...itemNumberQuery(number), retry: false, throwOnError: false });
  const item = useQuery({
    ...itemQuery(resolved.data?.id ?? ""),
    enabled: resolved.data !== undefined,
    throwOnError: false,
  });
  return resolved.isError ? resolved : item;
}
