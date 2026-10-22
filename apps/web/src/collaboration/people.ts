import type { ComboboxLoader } from "@lunedo/ui";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { rememberReferences } from "../editor/references.js";

export const peopleLoader: ComboboxLoader = async (query, cursor) => {
  const page = await request(() =>
    api.GET("/api/v1/people", {
      params: { query: { limit: 20, ...(query ? { q: query } : {}), ...(cursor ? { cursor } : {}) } },
    }),
  );
  rememberReferences({ people: Object.fromEntries(page.items.map((person) => [person.id, person.name])) });
  return {
    items: page.items.map((person) => ({
      value: person.id,
      label: person.name,
      ...(person.email ? { description: person.email } : {}),
    })),
    nextCursor: page.nextCursor,
  };
};

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
