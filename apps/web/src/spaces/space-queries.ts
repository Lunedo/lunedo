import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { api } from "../api/client.js";
import type { paths } from "../api/generated/schema.js";
import { fetchAllPages } from "../api/queries.js";
import { request } from "../api/request.js";

type Json<T> = T extends { content: { "application/json": infer Body } } ? Body : never;
type Ok<Path extends keyof paths, Method extends "get" | "post" | "put" | "patch"> = Json<
  NonNullable<paths[Path][Method]> extends { responses: infer Responses }
    ? Responses[keyof Responses & (200 | 201)]
    : never
>;

export type SpaceWithRole = Ok<"/api/v1/spaces/{spaceId}", "get">;
export type Space = Ok<"/api/v1/spaces/{spaceId}/key", "put">;
export type SpaceRole = NonNullable<SpaceWithRole["role"]>;
export type SpaceVisibility = Space["visibility"];
export type TreeItem = Ok<"/api/v1/spaces/{spaceId}/items", "get">["items"][number];
export type ItemDetails = Ok<"/api/v1/items/{itemId}", "get">;
export type AccessImpact = Ok<"/api/v1/spaces/{spaceId}/permissions/preview", "post">;
export type MoveImpact = Ok<"/api/v1/items/{itemId}/move/preview", "post">;
export type CopyImpact = Ok<"/api/v1/items/{itemId}/copy/preview", "post">;
export type ItemCopy = Ok<"/api/v1/items/{itemId}/copy", "post">;
export type SpacePermission = Ok<"/api/v1/spaces/{spaceId}/permissions", "get">[number];
export type HolderKind = SpacePermission["principalKind"];
export type PageContent = Ok<"/api/v1/pages/{pageId}/content", "get">;
export type PageView = Ok<"/api/v1/pages/by-number/{number}/view", "get">;
export type NewestContent = Ok<"/api/v1/spaces/{spaceId}/newest-content", "get">[number];

export const spaceKeys = {
  all: ["spaces"] as const,
  list: (filters: { search: string; organizationId: string | null }) => ["spaces", "list", filters] as const,
  byKey: (key: string) => ["spaces", "key", key.toUpperCase()] as const,
  space: (spaceId: string) => ["spaces", spaceId] as const,
  newest: (spaceId: string) => ["spaces", spaceId, "newest"] as const,
  children: (spaceId: string, parentId: string | null) => ["spaces", spaceId, "children", parentId] as const,
  permissions: (spaceId: string) => ["spaces", spaceId, "permissions"] as const,
  labelPages: (spaceId: string, label: string) => ["spaces", spaceId, "labels", label] as const,
  item: (itemId: string) => ["items", itemId] as const,
  itemNumber: (number: number) => ["itemNumbers", number] as const,
  pageView: (number: number) => ["itemNumbers", number, "view"] as const,
  content: (itemId: string) => ["items", itemId, "content"] as const,
  labels: (itemId: string) => ["items", itemId, "labels"] as const,
  backlinks: (itemId: string) => ["items", itemId, "backlinks"] as const,
  defaults: (organizationId: string) => ["organization", organizationId, "spaceDefaults"] as const,
  withoutAdministrator: (organizationId: string) =>
    ["organization", organizationId, "spacesWithoutAdministrator"] as const,
  organizationSpaces: (organizationId: string) => ["organization", organizationId, "spaces"] as const,
  personalReview: ["instance", "personalSpaces"] as const,
};

export function spaceByKeyQuery(key: string) {
  return queryOptions({
    queryKey: spaceKeys.byKey(key),
    queryFn: () => request(() => api.GET("/api/v1/space-keys/{key}", { params: { path: { key } } })),
    staleTime: 30_000,
  });
}

export function itemNumberQuery(number: number) {
  return queryOptions({
    queryKey: spaceKeys.itemNumber(number),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/items/by-number/{number}", { params: { path: { number: String(number) } } }),
      ),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function pageViewQuery(number: number) {
  return queryOptions({
    queryKey: spaceKeys.pageView(number),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/pages/by-number/{number}/view", { params: { path: { number: String(number) } } }),
      ),
    staleTime: 0,
  });
}

export function itemQuery(itemId: string) {
  return queryOptions({
    queryKey: spaceKeys.item(itemId),
    queryFn: () => request(() => api.GET("/api/v1/items/{itemId}", { params: { path: { itemId } } })),
    staleTime: 10_000,
  });
}

export function childrenQuery(spaceId: string, parentId: string | null) {
  return queryOptions({
    queryKey: spaceKeys.children(spaceId, parentId),
    queryFn: () =>
      fetchAllPages((cursor) =>
        request(() =>
          api.GET("/api/v1/spaces/{spaceId}/items", {
            params: {
              path: { spaceId },
              query: { limit: 500, ...(parentId ? { parentId } : {}), ...(cursor ? { cursor } : {}) },
            },
          }),
        ),
      ),
    staleTime: 10_000,
  });
}

export function newestContentQuery(spaceId: string, limit: number) {
  return queryOptions({
    queryKey: [...spaceKeys.newest(spaceId), limit] as const,
    queryFn: ({ signal }) =>
      request(() =>
        api.GET("/api/v1/spaces/{spaceId}/newest-content", {
          params: { path: { spaceId }, query: { limit } },
          signal,
        }),
      ),
    staleTime: 30_000,
  });
}

export function contentQuery(itemId: string) {
  return queryOptions({
    queryKey: spaceKeys.content(itemId),
    queryFn: () =>
      request(() => api.GET("/api/v1/pages/{pageId}/content", { params: { path: { pageId: itemId } } })),
  });
}

export function labelsQuery(itemId: string) {
  return queryOptions({
    queryKey: spaceKeys.labels(itemId),
    queryFn: () =>
      request(() => api.GET("/api/v1/pages/{pageId}/labels", { params: { path: { pageId: itemId } } })),
  });
}

export function backlinksQuery(itemId: string) {
  return queryOptions({
    queryKey: spaceKeys.backlinks(itemId),
    queryFn: () =>
      request(() => api.GET("/api/v1/pages/{pageId}/backlinks", { params: { path: { pageId: itemId } } })),
  });
}

export function permissionsQuery(spaceId: string) {
  return queryOptions({
    queryKey: spaceKeys.permissions(spaceId),
    queryFn: () =>
      request(() => api.GET("/api/v1/spaces/{spaceId}/permissions", { params: { path: { spaceId } } })),
  });
}

export function spaceDefaultsQuery(organizationId: string) {
  return queryOptions({
    queryKey: spaceKeys.defaults(organizationId),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/organizations/{organizationId}/space-defaults", {
          params: { path: { organizationId } },
        }),
      ),
  });
}

const SPACE_CHANGE_KINDS = [
  "space",
  "tree",
  "page",
  "draft",
  "access",
  "comments",
  "reactions",
  "tasks",
  "blog",
  "meetings",
  "editing",
] as const;

export interface SpaceChangeEvent {
  spaceId: string;
  kind: (typeof SPACE_CHANGE_KINDS)[number];
  itemId: string | null;
}

export function isSpaceChangeEvent(value: unknown): value is SpaceChangeEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Partial<SpaceChangeEvent>;
  return (
    typeof event.spaceId === "string" &&
    (SPACE_CHANGE_KINDS as readonly string[]).includes(event.kind ?? "") &&
    (event.itemId === null || typeof event.itemId === "string")
  );
}

export function spacesChanged(queryClient: QueryClient, events: SpaceChangeEvent[]): void {
  const keys = new Map<string, readonly unknown[]>();
  const add = (key: readonly unknown[]) => keys.set(JSON.stringify(key), key);
  for (const event of events) {
    if (event.kind === "space" || event.kind === "access") {
      add(["spaces", "list"]);
      add(["spaces", "key"]);
      add(spaceKeys.space(event.spaceId));
      add(spaceKeys.permissions(event.spaceId));
      add(["organization"]);
    }
    if (event.kind === "tree") {
      add(["spaces", event.spaceId, "children"]);
      add(["spaces", event.spaceId, "trash"]);
      add(["spaces", event.spaceId, "archive"]);
      add(["spaces", event.spaceId, "shortcuts"]);
      if (event.itemId) add(spaceKeys.item(event.itemId));
    }
    if (event.kind === "draft" && event.itemId) {
      add(["items", event.itemId, "draft"]);
      add(["items", event.itemId, "compare"]);
      add(["items", event.itemId, "discarded"]);
      add(["items", event.itemId, "attachments"]);
    }
    if ((event.kind === "page" || event.kind === "tree") && event.itemId) {
      add(["items", event.itemId, "whiteboard"]);
    }
    if (event.kind === "page" && event.itemId) {
      add(["items", event.itemId, "draft"]);
      add(["items", event.itemId, "versions"]);
      add(["items", event.itemId, "compare"]);
      add(["items", event.itemId, "attachments"]);
      add(spaceKeys.content(event.itemId));
      add(spaceKeys.labels(event.itemId));
      add(spaceKeys.backlinks(event.itemId));
      add(["spaces", event.spaceId, "labels"]);
      add(["items", event.itemId, "comments"]);
      add(["items", event.itemId, "tasks"]);
      add(["tasks"]);
      add(["home"]);
      add(["blogPosts", event.itemId]);
      add(["spaces", event.spaceId, "blog"]);
      add(["blog"]);
    }
    if ((event.kind === "comments" || event.kind === "reactions") && event.itemId) {
      add(["items", event.itemId, "comments"]);
      add(["items", event.itemId, "reactions"]);
    }
    if (event.kind === "tasks" && event.itemId) {
      add(["items", event.itemId, "tasks"]);
      add(["tasks"]);
      add(["home"]);
    }
    if (event.kind === "blog") {
      add(["spaces", event.spaceId, "blog"]);
      add(["blog"]);
      add(["home"]);
      if (event.itemId) add(["blogPosts", event.itemId]);
    }
    if (["space", "tree", "page", "access"].includes(event.kind)) {
      add(["spaces", event.spaceId, "knowledgeBase"]);
    }
    if (event.kind === "meetings") add(["meetings"]);
    if (event.kind === "editing" && event.itemId) add(["items", event.itemId, "editors"]);
    if (event.kind === "page" || event.kind === "tree" || event.kind === "tasks") add(["meetings"]);
    if (event.kind === "access") add(["items"]);
  }
  for (const key of keys.values()) void queryClient.invalidateQueries({ queryKey: key });
}

export function sharedPath(number: number, slug: string): string {
  return withSlug(`/shared/${number}`, slug);
}

function withSlug(path: string, slug: string): string {
  return slug ? `${path}/${slug}` : path;
}

function spacePath(spaceKey: string, segment: string, number: number, slug: string): string {
  return withSlug(`/spaces/${encodeURIComponent(spaceKey)}/${segment}/${number}`, slug);
}

export function pagePath(spaceKey: string, number: number, slug: string): string {
  if (!spaceKey) return sharedPath(number, slug);
  return spacePath(spaceKey, "pages", number, slug);
}

export function blogPostPath(spaceKey: string, number: number, slug: string): string {
  if (!spaceKey) return sharedPath(number, slug);
  return spacePath(spaceKey, "blog", number, slug);
}

export function whiteboardPath(spaceKey: string, number: number, slug: string): string {
  if (!spaceKey) return sharedPath(number, slug);
  return spacePath(spaceKey, "whiteboards", number, slug);
}

export function folderPath(spaceKey: string, number: number, slug: string): string {
  return spacePath(spaceKey, "folders", number, slug);
}

export function seriesPath(spaceKey: string, number: number, slug: string): string {
  return spacePath(spaceKey, "meetings", number, slug);
}

export function topicPath(spaceKey: string, number: number, slug: string): string {
  return spacePath(spaceKey, "topics", number, slug);
}
