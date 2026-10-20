import { queryOptions } from "@tanstack/react-query";
import { api } from "../api/client.js";
import type { paths } from "../api/generated/schema.js";
import { request } from "../api/request.js";
import { downloadBlob } from "../components/download.js";

export type ExportEntry =
  paths["/api/v1/exports/{exportId}"]["get"]["responses"][200]["content"]["application/json"];
export type PageExportFormat = "markdown" | "html" | "zip" | "print" | "pdf" | "docx";
export type ExportFormat = NonNullable<
  NonNullable<
    paths["/api/v1/spaces/{spaceId}/exports"]["post"]["requestBody"]
  >["content"]["application/json"]["format"]
>;
export type ExportOptions = ExportEntry["options"];
export type ExportCounts =
  paths["/api/v1/spaces/{spaceId}/exports/summary"]["get"]["responses"][200]["content"]["application/json"];
export type ExportTarget = { spaceId: string } | { pageId: string };

export const defaultExportOptions: ExportOptions = {
  attachments: true,
  comments: false,
  contents: true,
  paper: "a4",
  orientation: "portrait",
};

export const exportKeys = {
  all: ["exports"] as const,
  one: (exportId: string) => ["exports", exportId] as const,
  counts: (target: ExportTarget) =>
    ["export-counts", "spaceId" in target ? target.spaceId : target.pageId] as const,
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

export function exportQuery(exportId: string) {
  return queryOptions({
    queryKey: exportKeys.one(exportId),
    queryFn: () => request(() => api.GET("/api/v1/exports/{exportId}", { params: { path: { exportId } } })),
    refetchInterval: (query) =>
      query.state.data && isRunning(query.state.data) ? RUNNING_REFRESH_MS : false,
  });
}

export function exportCountsQuery(target: ExportTarget) {
  return queryOptions({
    queryKey: exportKeys.counts(target),
    queryFn: () =>
      "spaceId" in target
        ? request(() =>
            api.GET("/api/v1/spaces/{spaceId}/exports/summary", {
              params: { path: { spaceId: target.spaceId } },
            }),
          )
        : request(() =>
            api.GET("/api/v1/pages/{pageId}/exports/summary", {
              params: { path: { pageId: target.pageId } },
            }),
          ),
  });
}

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

const EXTENSIONS: Record<PageExportFormat, string> = {
  markdown: "md",
  html: "html",
  zip: "zip",
  print: "html",
  pdf: "pdf",
  docx: "docx",
};

function pagedQuery(options: ExportOptions) {
  return {
    attachments: options.attachments ? ("true" as const) : ("false" as const),
    comments: options.comments ? ("true" as const) : ("false" as const),
    contents: options.contents ? ("true" as const) : ("false" as const),
    paper: options.paper,
    orientation: options.orientation,
  };
}

async function pageExport(pageId: string, format: PageExportFormat, options: ExportOptions) {
  let disposition: string | null = null;
  const blob = await request(async () => {
    const result = await api.GET("/api/v1/pages/{pageId}/export", {
      params: {
        path: { pageId },
        query: {
          format,
          ...(format === "print" || format === "docx" || format === "pdf" ? pagedQuery(options) : {}),
        },
      },
      parseAs: "blob",
    });
    disposition = result.response.headers.get("content-disposition");
    return result;
  });
  return { blob: blob as Blob, disposition: disposition as string | null };
}

export async function downloadPageExport(
  pageId: string,
  format: PageExportFormat,
  options: ExportOptions = defaultExportOptions,
): Promise<void> {
  const { blob, disposition } = await pageExport(pageId, format, options);
  downloadBlob(fileNameOf(disposition, `export.${EXTENSIONS[format]}`), blob);
}

export async function printPageHtml(pageId: string, options: ExportOptions): Promise<string> {
  return (await pageExport(pageId, "print", options)).blob.text();
}

export async function printExportHtml(exportId: string): Promise<string> {
  const blob = await request(() =>
    api.GET("/api/v1/exports/{exportId}/content", { params: { path: { exportId } }, parseAs: "blob" }),
  );
  return (blob as Blob).text();
}

export function startExport(target: ExportTarget, format: ExportFormat, options: ExportOptions) {
  const body = { format, ...options };
  return "spaceId" in target
    ? request(() =>
        api.POST("/api/v1/spaces/{spaceId}/exports", { params: { path: { spaceId: target.spaceId } }, body }),
      )
    : request(() =>
        api.POST("/api/v1/pages/{pageId}/exports", { params: { path: { pageId: target.pageId } }, body }),
      );
}

export function startPagesExport(pageId: string) {
  return startExport({ pageId }, "archive", defaultExportOptions);
}

export function startSpaceExport(spaceId: string) {
  return startExport({ spaceId }, "archive", defaultExportOptions);
}

export function deleteExport(exportId: string) {
  return request(() => api.DELETE("/api/v1/exports/{exportId}", { params: { path: { exportId } } }));
}
