import { queryOptions } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { api } from "../../api/client.js";
import type { paths } from "../../api/generated/schema.js";
import { request } from "../../api/request.js";

type Json<T> = T extends { content: { "application/json": infer Body } } ? Body : never;
type Ok<Path extends keyof paths, Method extends "get" | "post" | "put"> = Json<
  NonNullable<paths[Path][Method]> extends { responses: infer Responses }
    ? Responses[keyof Responses & (200 | 201)]
    : never
>;

export type PageStatusValue = Ok<"/api/v1/spaces/{spaceId}/page-statuses", "get">["values"][number];
export type PageStatus = Pick<PageStatusValue, "id" | "builtIn" | "name" | "color">;
export type PageStatusColor = PageStatusValue["color"];
export type UnownedPage = Ok<"/api/v1/spaces/{spaceId}/unowned-items", "get">;
export type UnownedItem = UnownedPage["items"][number];
export type ActivityEntry = Ok<"/api/v1/items/{itemId}/activity", "get">[number];

export const PAGE_STATUS_COLORS: readonly PageStatusColor[] = [
  "neutral",
  "accent",
  "info",
  "success",
  "warning",
  "danger",
];

export const ownershipKeys = {
  statuses: (spaceId: string) => ["spaces", spaceId, "page-statuses"] as const,
  spaceUnowned: (spaceId: string) => ["spaces", spaceId, "unowned-items"] as const,
  organizationUnowned: (organizationId: string) =>
    ["organizations", organizationId, "unowned-items"] as const,
  activity: (itemId: string) => ["items", itemId, "activity"] as const,
};

export function pageStatusesQuery(spaceId: string) {
  return queryOptions({
    queryKey: ownershipKeys.statuses(spaceId),
    queryFn: () =>
      request(() => api.GET("/api/v1/spaces/{spaceId}/page-statuses", { params: { path: { spaceId } } })),
  });
}

export function activityQuery(itemId: string) {
  return queryOptions({
    queryKey: ownershipKeys.activity(itemId),
    queryFn: () =>
      request(() => api.GET("/api/v1/items/{itemId}/activity", { params: { path: { itemId } } })),
  });
}

export function statusName(t: TFunction, status: { builtIn: string | null; name: string | null }): string {
  if (status.name) return status.name;
  switch (status.builtIn) {
    case "roughDraft":
      return t("pageStatus.builtIn.roughDraft");
    case "inProgress":
      return t("pageStatus.builtIn.inProgress");
    case "readyForReview":
      return t("pageStatus.builtIn.readyForReview");
    case "verified":
      return t("pageStatus.builtIn.verified");
    default:
      return status.builtIn ?? "";
  }
}

export function colorName(t: TFunction, color: PageStatusColor): string {
  switch (color) {
    case "neutral":
      return t("pageStatus.colors.neutral");
    case "accent":
      return t("pageStatus.colors.accent");
    case "info":
      return t("pageStatus.colors.info");
    case "success":
      return t("pageStatus.colors.success");
    case "warning":
      return t("pageStatus.colors.warning");
    case "danger":
      return t("pageStatus.colors.danger");
  }
}
