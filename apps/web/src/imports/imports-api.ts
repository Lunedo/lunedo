import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { api } from "../api/client.js";
import type { paths } from "../api/generated/schema.js";
import { request } from "../api/request.js";

export type ImportView = ImportResponse;
type ImportResponse = Awaited<ReturnType<typeof fetchImport>>;
export type ImportState = ImportResponse["state"];
export type ImportUpdate =
  paths["/api/v1/imports/{importId}"]["patch"]["requestBody"]["content"]["application/json"];
export type AcceptBody =
  paths["/api/v1/imports/{importId}/accept"]["post"]["requestBody"]["content"]["application/json"];
export type ReportSummary = Awaited<ReturnType<typeof fetchReport>>;
export type ReportEntry = Awaited<ReturnType<typeof fetchEntries>>["items"][number];
export type MacroUsage = Awaited<ReturnType<typeof fetchMacros>>[number];

export const importKeys = {
  all: ["imports"] as const,
  list: (organizationId: string) => ["imports", "list", organizationId] as const,
  detail: (importId: string) => ["imports", "detail", importId] as const,
  report: (importId: string) => ["imports", "report", importId] as const,
  entries: (importId: string, category: string | null, code: string | null, macro: string | null) =>
    ["imports", "report", importId, "entries", category, code, macro] as const,
  macros: (importId: string) => ["imports", "report", importId, "macros"] as const,
  folder: (organizationId: string) => ["imports", "folder", organizationId] as const,
};

export const ACTIVE_STATES: readonly ImportState[] = ["analyzing", "running", "stopping", "discarding"];

function fetchImport(importId: string) {
  return request(() => api.GET("/api/v1/imports/{importId}", { params: { path: { importId } } }));
}

function fetchReport(importId: string) {
  return request(() => api.GET("/api/v1/imports/{importId}/report", { params: { path: { importId } } }));
}

function fetchEntries(
  importId: string,
  category: string | null,
  code: string | null,
  macro: string | null,
  cursor?: string,
) {
  return request(() =>
    api.GET("/api/v1/imports/{importId}/report/entries", {
      params: {
        path: { importId },
        query: {
          limit: 50,
          ...(category ? { category } : {}),
          ...(code ? { code } : {}),
          ...(macro ? { macro } : {}),
          ...(cursor ? { cursor } : {}),
        },
      },
    }),
  );
}

function fetchMacros(importId: string) {
  return request(() =>
    api.GET("/api/v1/imports/{importId}/report/macros", { params: { path: { importId } } }),
  );
}

export function importsQuery(organizationId: string) {
  return queryOptions({
    queryKey: importKeys.list(organizationId),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/organizations/{organizationId}/imports", { params: { path: { organizationId } } }),
      ),
  });
}

export function importQuery(importId: string) {
  return queryOptions({ queryKey: importKeys.detail(importId), queryFn: () => fetchImport(importId) });
}

export function reportQuery(importId: string) {
  return queryOptions({ queryKey: importKeys.report(importId), queryFn: () => fetchReport(importId) });
}

export function entriesQuery(
  importId: string,
  filter: { category?: string | null; code?: string | null; macro?: string | null },
  cursor?: string,
) {
  const category = filter.category ?? null;
  const code = filter.code ?? null;
  const macro = filter.macro ?? null;
  return queryOptions({
    queryKey: [...importKeys.entries(importId, category, code, macro), cursor ?? null] as const,
    queryFn: () => fetchEntries(importId, category, code, macro, cursor),
  });
}

export function macrosQuery(importId: string) {
  return queryOptions({ queryKey: importKeys.macros(importId), queryFn: () => fetchMacros(importId) });
}

export function folderQuery(organizationId: string) {
  return queryOptions({
    queryKey: importKeys.folder(organizationId),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/organizations/{organizationId}/import-folder", {
          params: { path: { organizationId } },
        }),
      ),
  });
}

export function createImport(organizationId: string, source: ImportResponse["source"]) {
  return request(() =>
    api.POST("/api/v1/organizations/{organizationId}/imports", {
      params: { path: { organizationId } },
      body: { source },
    }),
  );
}

export function updateImport(importId: string, body: ImportUpdate) {
  return request(() => api.PATCH("/api/v1/imports/{importId}", { params: { path: { importId } }, body }));
}

export function removeImport(importId: string) {
  return request(() => api.DELETE("/api/v1/imports/{importId}", { params: { path: { importId } } }));
}

export function setReviewers(importId: string, accountIds: string[]) {
  return request(() =>
    api.PUT("/api/v1/imports/{importId}/reviewers", { params: { path: { importId } }, body: { accountIds } }),
  );
}

export function startImport(importId: string) {
  return request(() => api.POST("/api/v1/imports/{importId}/start", { params: { path: { importId } } }));
}

export function stopImport(importId: string, confirmation: string) {
  return request(() =>
    api.POST("/api/v1/imports/{importId}/stop", { params: { path: { importId } }, body: { confirmation } }),
  );
}

export function discardImport(importId: string, confirmation: string) {
  return request(() =>
    api.POST("/api/v1/imports/{importId}/discard", {
      params: { path: { importId } },
      body: { confirmation },
    }),
  );
}

export function acceptImport(importId: string, body: AcceptBody) {
  return request(() =>
    api.POST("/api/v1/imports/{importId}/accept", { params: { path: { importId } }, body }),
  );
}

export function takeOverImport(importId: string) {
  return request(() => api.POST("/api/v1/imports/{importId}/take-over", { params: { path: { importId } } }));
}

export function reportExportUrl(importId: string): string {
  return `/api/v1/imports/${importId}/report/export`;
}

export async function refreshImport(queryClient: QueryClient, importId: string, organizationId?: string) {
  await queryClient.invalidateQueries({ queryKey: importKeys.detail(importId) });
  await queryClient.invalidateQueries({ queryKey: ["imports", "report", importId] });
  if (organizationId) await queryClient.invalidateQueries({ queryKey: importKeys.list(organizationId) });
}

export function importChanged(queryClient: QueryClient, event: { importId: string; organizationId: string }) {
  void refreshImport(queryClient, event.importId, event.organizationId);
}
