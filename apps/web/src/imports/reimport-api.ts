import { queryOptions } from "@tanstack/react-query";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import type { ImportView } from "./imports-api.js";

export type ChangeTab = "conflicts" | "updates" | "deleted" | "moved" | "permissions";
export type ChangeSummary = Awaited<ReturnType<typeof fetchSummary>>;
export type ChangeEntry = Awaited<ReturnType<typeof fetchChanges>>["items"][number];
export type ChangeDecision = NonNullable<ChangeEntry["decision"]>;
export type DifferenceImpact = Awaited<ReturnType<typeof previewDifference>>;
export type ResolvedLink = Awaited<ReturnType<typeof resolveConfluenceLink>>;
export type ChangeComparison = Awaited<ReturnType<typeof fetchComparison>>;

export const CHANGE_TABS: readonly ChangeTab[] = ["conflicts", "updates", "deleted", "moved", "permissions"];

export const reimportKeys = {
  summary: (importId: string) => ["imports", "report", importId, "changes", "summary"] as const,
  changes: (importId: string, tab: ChangeTab, cursor: string | null) =>
    ["imports", "report", importId, "changes", tab, cursor] as const,
  comparison: (importId: string, changeId: string) =>
    ["imports", "report", importId, "changes", "comparison", changeId] as const,
};

function fetchSummary(importId: string) {
  return request(() =>
    api.GET("/api/v1/imports/{importId}/changes/summary", { params: { path: { importId } } }),
  );
}

function fetchChanges(importId: string, tab: ChangeTab, cursor: string | null) {
  return request(() =>
    api.GET("/api/v1/imports/{importId}/changes", {
      params: { path: { importId }, query: { tab, limit: 100, ...(cursor ? { cursor } : {}) } },
    }),
  );
}

export function changeSummaryQuery(importId: string) {
  return queryOptions({ queryKey: reimportKeys.summary(importId), queryFn: () => fetchSummary(importId) });
}

export function changesQuery(importId: string, tab: ChangeTab, cursor: string | null) {
  return queryOptions({
    queryKey: reimportKeys.changes(importId, tab, cursor),
    queryFn: () => fetchChanges(importId, tab, cursor),
  });
}

function fetchComparison(importId: string, changeId: string) {
  return request(() =>
    api.GET("/api/v1/imports/{importId}/changes/{changeId}/compare", {
      params: { path: { importId, changeId } },
    }),
  );
}

export function changeComparisonQuery(importId: string, changeId: string) {
  return queryOptions({
    queryKey: reimportKeys.comparison(importId, changeId),
    queryFn: () => fetchComparison(importId, changeId),
  });
}

export function createReimport(organizationId: string, source: ImportView["source"], spaceId: string) {
  return request(() =>
    api.POST("/api/v1/organizations/{organizationId}/imports", {
      params: { path: { organizationId } },
      body: { source, spaceId },
    }),
  );
}

export function decideChanges(importId: string, ids: string[], decision: ChangeDecision | null) {
  return request(() =>
    api.PUT("/api/v1/imports/{importId}/changes/decisions", {
      params: { path: { importId } },
      body: { ids, decision },
    }),
  );
}

export function applyChanges(importId: string) {
  return request(() => api.POST("/api/v1/imports/{importId}/apply", { params: { path: { importId } } }));
}

export function previewDifference(importId: string, changeId: string) {
  return request(() =>
    api.POST("/api/v1/imports/{importId}/changes/{changeId}/preview", {
      params: { path: { importId, changeId } },
    }),
  );
}

export function applyDifference(importId: string, changeId: string) {
  return request(() =>
    api.POST("/api/v1/imports/{importId}/changes/{changeId}/apply", {
      params: { path: { importId, changeId } },
    }),
  );
}

export function resolveConfluenceLink(url: string) {
  return request(() => api.GET("/api/v1/confluence-links", { params: { query: { url } } }));
}

export function looksLikeConfluenceLink(text: string): boolean {
  const value = text.trim();
  return (
    value.length > 0 &&
    value.length <= 2000 &&
    /(\/pages\/|pageId=|\/display\/|\/x\/|\/spaces\/[^/]+\/(pages|blog)\/)/.test(value)
  );
}
