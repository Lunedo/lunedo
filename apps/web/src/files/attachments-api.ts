import { queryOptions } from "@tanstack/react-query";
import { api, CSRF_HEADER } from "../api/client.js";
import type { paths } from "../api/generated/schema.js";
import { ApiError, networkError, request, toApiError } from "../api/request.js";

type Json<T> = T extends { content: { "application/json": infer Body } } ? Body : never;

export type Attachment = Json<paths["/api/v1/attachments/{attachmentId}"]["get"]["responses"][200]>;
export type AttachmentVersion = Json<
  paths["/api/v1/attachments/{attachmentId}/versions"]["get"]["responses"][200]
>[number];
export type PreviewKind = Attachment["preview"];
export type ImageSize = "display" | "preview";

export const attachmentKeys = {
  list: (pageId: string) => ["items", pageId, "attachments"] as const,
  versions: (attachmentId: string) => ["attachments", attachmentId, "versions"] as const,
};

export function attachmentsQuery(pageId: string) {
  return queryOptions({
    queryKey: attachmentKeys.list(pageId),
    queryFn: () =>
      request(() => api.GET("/api/v1/pages/{pageId}/attachments", { params: { path: { pageId } } })),
    staleTime: 10_000,
  });
}

export function versionsQuery(attachmentId: string) {
  return queryOptions({
    queryKey: attachmentKeys.versions(attachmentId),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/attachments/{attachmentId}/versions", { params: { path: { attachmentId } } }),
      ),
  });
}

export function contentUrl(
  attachmentId: string,
  options: { version?: number; download?: boolean; size?: ImageSize } = {},
): string {
  const query = new URLSearchParams();
  if (options.version !== undefined) query.set("version", String(options.version));
  if (options.download) query.set("download", "true");
  if (options.size) query.set("size", options.size);
  const suffix = query.toString();
  return `/api/v1/attachments/${attachmentId}/content${suffix ? `?${suffix}` : ""}`;
}

export interface UploadHandle {
  promise: Promise<Attachment>;
  abort: () => void;
}

export function uploadFile(
  pageId: string,
  file: File,
  onProgress: (loaded: number, total: number) => void,
): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<Attachment>((resolve, reject) => {
    xhr.open("POST", `/api/v1/pages/${pageId}/attachments?name=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.setRequestHeader(CSRF_HEADER, "1");
    xhr.withCredentials = true;
    xhr.upload.onprogress = (event) =>
      onProgress(event.loaded, event.lengthComputable ? event.total : file.size);
    xhr.onerror = () => reject(networkError());
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as Attachment);
      else reject(toApiError(new Response(null, { status: xhr.status, statusText: xhr.statusText }), body));
    };
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}

export async function fetchBytes(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: "same-origin", ...(signal ? { signal } : {}) });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw networkError();
  }
  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    throw toApiError(response, body);
  }
  return response.arrayBuffer();
}

export function isApiFailure(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
