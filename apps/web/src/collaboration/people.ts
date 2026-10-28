import type { ComboboxLoader } from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { rememberReferences } from "../editor/references.js";

export function peopleLoaderFor(filter: { spaceId?: string; seriesId?: string }): ComboboxLoader {
  return async (query, cursor) => {
    const page = await request(() =>
      api.GET("/api/v1/people", {
        params: {
          query: { limit: 20, ...filter, ...(query ? { q: query } : {}), ...(cursor ? { cursor } : {}) },
        },
      }),
    );
    rememberReferences({
      people: Object.fromEntries(page.items.map((person) => [person.id, person.name])),
      pictures: Object.fromEntries(
        page.items.flatMap((person) => (person.pictureRef ? [[person.id, person.pictureRef]] : [])),
      ),
    });
    return {
      items: page.items.map((person) => ({
        value: person.id,
        label: person.name,
        ...(person.email ? { description: person.email } : {}),
      })),
      nextCursor: page.nextCursor,
    };
  };
}

export const peopleLoader: ComboboxLoader = peopleLoaderFor({});

export async function checkMentionAccess(
  pageId: string,
  accountIds: readonly string[],
): Promise<{ accountId: string; hasAccess: boolean }[]> {
  if (accountIds.length === 0) return [];
  try {
    return await request(() =>
      api.GET("/api/v1/pages/{pageId}/mention-access", {
        params: { path: { pageId }, query: { accountIds: accountIds.slice(0, 20).join(",") } },
      }),
    );
  } catch {
    return [];
  }
}

export function usePeoplePictures(ids: readonly string[]): (accountId: string) => string | null {
  const wanted = [...new Set(ids)].sort().slice(0, 20);
  const people = useQuery({
    queryKey: ["people", "pictures", wanted] as const,
    queryFn: () =>
      request(() => api.GET("/api/v1/people", { params: { query: { ids: wanted.join(","), limit: 20 } } })),
    enabled: wanted.length > 0,
    throwOnError: false,
  });
  const items = people.data?.items;
  return useCallback(
    (accountId: string) => items?.find((person) => person.id === accountId)?.pictureRef ?? null,
    [items],
  );
}
