import { queryOptions } from "@tanstack/react-query";
import { api } from "../../api/client.js";
import type { paths } from "../../api/generated/schema.js";
import { request } from "../../api/request.js";
import { contentHref } from "../item-paths.js";

export const shortcutKeys = {
  list: (spaceId: string) => ["spaces", spaceId, "shortcuts"] as const,
  manage: (spaceId: string) => ["spaces", spaceId, "shortcuts", "manage"] as const,
};

export function shortcutsQuery(spaceId: string) {
  return queryOptions({
    queryKey: shortcutKeys.list(spaceId),
    queryFn: () =>
      request(() => api.GET("/api/v1/spaces/{spaceId}/shortcuts", { params: { path: { spaceId } } })),
    staleTime: 30_000,
  });
}

export function managedShortcutsQuery(spaceId: string) {
  return queryOptions({
    queryKey: shortcutKeys.manage(spaceId),
    queryFn: () =>
      request(() => api.GET("/api/v1/spaces/{spaceId}/shortcuts/manage", { params: { path: { spaceId } } })),
  });
}

export type Shortcut =
  paths["/api/v1/spaces/{spaceId}/shortcuts"]["get"]["responses"][200]["content"]["application/json"][number];

export function shortcutHref(
  shortcut: Pick<Shortcut, "url" | "item">,
): { href: string; external: boolean } | null {
  if (shortcut.url) return { href: shortcut.url, external: true };
  if (!shortcut.item) return null;
  const href = contentHref(
    { kind: shortcut.item.kind as never, number: shortcut.item.number, title: shortcut.item.title },
    shortcut.item.spaceKey,
  );
  return href ? { href, external: false } : null;
}
