import type { QueryClient } from "@tanstack/react-query";
import { taskStatusesQuery } from "../collaboration/queries.js";
import { myAccessQuery } from "../sharing/sharing-api.js";
import { type ItemLocation, keepItem, resolveNumberedItem } from "./numbered-item.js";
import { contentQuery, type ItemDetails, itemNumberQuery, pageViewQuery } from "./space-queries.js";

export async function resolveNumberedPage(
  queryClient: QueryClient,
  number: number,
  location: ItemLocation,
): Promise<ItemDetails | null> {
  const view = await queryClient.fetchQuery(pageViewQuery(number)).catch(() => null);
  if (!view) return resolveNumberedItem(queryClient, number, location);
  const { item, content, tasks, access } = view;
  queryClient.removeQueries({ queryKey: pageViewQuery(number).queryKey, exact: true });
  queryClient.setQueryData(itemNumberQuery(number).queryKey, item);
  if (content) queryClient.setQueryData(contentQuery(item.id).queryKey, content);
  if (tasks) queryClient.setQueryData(taskStatusesQuery(item.id).queryKey, tasks);
  queryClient.setQueryData(myAccessQuery(item.id).queryKey, access);
  return keepItem(queryClient, item, location);
}
