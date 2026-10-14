import { queryOptions } from "@tanstack/react-query";
import { api } from "../api/client.js";
import type { paths } from "../api/generated/schema.js";
import { request } from "../api/request.js";
import { downloadBlob } from "../components/download.js";

export type ExportEntry =
  paths["/api/v1/exports/{exportId}"]["get"]["responses"][200]["content"]["application/json"];
export type PageExportFormat = "markdown" | "html" | "zip";

export const exportKeys = {
  all: ["exports"] as const,
};

const RUNNING_REFRESH_MS = 2000;

export function isRunning(entry: Pick<ExportEntry, "state">): boolean {
  return entry.state === "queued" || entry.state === "running";
}

export const exportsQuery = queryOptions({
  queryKey: exportKeys.all,
  queryFn: () => request(() => api.GET("/api/v1/exports")),
  refetchInterval: (query) => (query.state.data?.some(isRunning) ? RUNNING_REFRESH_MS : false),
});

export function exportDownloadUrl(exportId: string): string {
  return `/api/v1/exports/${encodeURIComponent(exportId)}/content`;
}

function fileNameOf(header: string | null, fallback: string): string {
  const encoded = header ? /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1] : undefined;
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export async function downloadPageExport(pageId: string, format: PageExportFormat): Promise<void> {
  let disposition: string | null = null;
  const blob = await request(async () => {
    const result = await api.GET("/api/v1/pages/{pageId}/export", {
      params: { path: { pageId }, query: { format } },
      parseAs: "blob",
    });
    disposition = result.response.headers.get("content-disposition");
    return result;
  });
  const extension = format === "markdown" ? "md" : format;
  downloadBlob(fileNameOf(disposition, `export.${extension}`), blob as Blob);
}

export function startPagesExport(pageId: string) {
  return request(() => api.POST("/api/v1/pages/{pageId}/exports", { params: { path: { pageId } } }));
}

export function startSpaceExport(spaceId: string) {
  return request(() => api.POST("/api/v1/spaces/{spaceId}/exports", { params: { path: { spaceId } } }));
}

export function deleteExport(exportId: string) {
  return request(() => api.DELETE("/api/v1/exports/{exportId}", { params: { path: { exportId } } }));
}
