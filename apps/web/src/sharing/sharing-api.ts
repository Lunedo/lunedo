import { queryOptions } from "@tanstack/react-query";
import { api } from "../api/client.js";
import type { paths } from "../api/generated/schema.js";
import { request } from "../api/request.js";

type Json<T> = T extends { content: { "application/json": infer Body } } ? Body : never;
type Ok<Path extends keyof paths, Method extends "get" | "post" | "put" | "patch"> = Json<
  NonNullable<paths[Path][Method]> extends { responses: infer Responses }
    ? Responses[keyof Responses & (200 | 201)]
    : never
>;
type Body<Path extends keyof paths, Method extends "post" | "put" | "patch"> =
  NonNullable<paths[Path][Method]> extends { requestBody?: { content: { "application/json": infer Value } } }
    ? Value
    : never;

export type PageAccess = Ok<"/api/v1/pages/{pageId}/access", "get">;
export type PageShare = PageAccess["shares"][number];
export type ShareRole = PageShare["role"];
export type AccessChange = Body<"/api/v1/pages/{pageId}/access", "post">["changes"][number];
export type PageImpact = Ok<"/api/v1/pages/{pageId}/access/preview", "post">;
export type ShareLinks = Ok<"/api/v1/pages/{pageId}/share-links", "get">;
export type ShareLink = ShareLinks["links"][number];
export type ShareLinkScope = ShareLinkInput["scope"];
export type ShareLinkInput = Body<"/api/v1/pages/{pageId}/share-links", "post">;
export type AccessExplanation = Ok<"/api/v1/pages/{pageId}/access/explain", "get">;
export type AccessRequest = Ok<"/api/v1/access-requests/mine", "get">[number];
export type RestrictedPage = Ok<"/api/v1/spaces/{spaceId}/restricted-pages", "get">[number];
export type PersonAccess = Ok<"/api/v1/organizations/{organizationId}/people/{accountId}/access", "get">;
export type GiveEffect = Ok<"/api/v1/spaces/{spaceId}/give-access/preview", "post">;

export const SHARE_ROLES: readonly ShareRole[] = ["reader", "commenter", "editor"];

export const sharingKeys = {
  access: (pageId: string) => ["items", pageId, "access"] as const,
  links: (pageId: string) => ["items", pageId, "shareLinks"] as const,
  mine: (pageId: string) => ["items", pageId, "myAccess"] as const,
  restricted: (spaceId: string) => ["spaces", spaceId, "restrictedPages"] as const,
  requests: (spaceId: string) => ["spaces", spaceId, "accessRequests"] as const,
  myRequests: ["accessRequests", "mine"] as const,
  discoverable: (organizationId: string) => ["organization", organizationId, "discoverableSpaces"] as const,
};

export function pageAccessQuery(pageId: string) {
  return queryOptions({
    queryKey: sharingKeys.access(pageId),
    queryFn: () => request(() => api.GET("/api/v1/pages/{pageId}/access", { params: { path: { pageId } } })),
  });
}

export function shareLinksQuery(pageId: string) {
  return queryOptions({
    queryKey: sharingKeys.links(pageId),
    queryFn: () =>
      request(() => api.GET("/api/v1/pages/{pageId}/share-links", { params: { path: { pageId } } })),
  });
}

export function myAccessQuery(pageId: string) {
  return queryOptions({
    queryKey: sharingKeys.mine(pageId),
    queryFn: () =>
      request(() => api.GET("/api/v1/pages/{pageId}/access/mine", { params: { path: { pageId } } })),
    staleTime: 10_000,
  });
}

export function previewAccess(pageId: string, changes: AccessChange[]) {
  return request(() =>
    api.POST("/api/v1/pages/{pageId}/access/preview", { params: { path: { pageId } }, body: { changes } }),
  );
}

export function changeAccess(pageId: string, changes: AccessChange[]) {
  return request(() =>
    api.POST("/api/v1/pages/{pageId}/access", { params: { path: { pageId } }, body: { changes } }),
  );
}

export function linkAddress(token: string): string {
  return `${globalThis.location.origin}/s/${token}`;
}

export type SharedWithMe = Ok<"/api/v1/shared-with-me", "get">[number];

export function sharedWithMeQuery() {
  return queryOptions({
    queryKey: ["sharedWithMe"] as const,
    queryFn: () => request(() => api.GET("/api/v1/shared-with-me")),
    staleTime: 30_000,
  });
}
