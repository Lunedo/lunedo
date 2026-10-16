import { queryOptions } from "@tanstack/react-query";
import { api, CSRF_HEADER } from "../api/client.js";
import type { paths } from "../api/generated/schema.js";
import { networkError, request, toApiError } from "../api/request.js";
import { contentUrl, fetchBytes } from "../files/attachments-api.js";

type Json<T> = T extends { content: { "application/json": infer Body } } ? Body : never;

export type WhiteboardContent = Json<paths["/api/v1/whiteboards/{itemId}/scene"]["get"]["responses"][200]>;
export type WhiteboardVersion = Json<
  paths["/api/v1/whiteboards/{itemId}/versions"]["get"]["responses"][200]
>[number];
export type WhiteboardVersionContent = Json<
  paths["/api/v1/whiteboards/{itemId}/versions/{number}"]["get"]["responses"][200]
>;

export const whiteboardKeys = {
  scene: (itemId: string) => ["items", itemId, "whiteboard"] as const,
  versions: (itemId: string) => ["items", itemId, "whiteboard", "versions"] as const,
  version: (itemId: string, number: number) => ["items", itemId, "whiteboard", "versions", number] as const,
};

export function whiteboardSceneQuery(itemId: string) {
  return queryOptions({
    queryKey: whiteboardKeys.scene(itemId),
    queryFn: () =>
      request(() => api.GET("/api/v1/whiteboards/{itemId}/scene", { params: { path: { itemId } } })),
  });
}

export function whiteboardVersionsQuery(itemId: string) {
  return queryOptions({
    queryKey: whiteboardKeys.versions(itemId),
    queryFn: () =>
      request(() => api.GET("/api/v1/whiteboards/{itemId}/versions", { params: { path: { itemId } } })),
  });
}

export function whiteboardVersionQuery(itemId: string, number: number) {
  return queryOptions({
    queryKey: whiteboardKeys.version(itemId, number),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/whiteboards/{itemId}/versions/{number}", { params: { path: { itemId, number } } }),
      ),
  });
}

export function previewUrl(itemId: string, version?: number): string {
  return `/api/v1/whiteboards/${itemId}/preview${version === undefined ? "" : `?version=${version}`}`;
}

export async function putBytes<T>(url: string, body: Blob): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/octet-stream", [CSRF_HEADER]: "1" },
      body,
    });
  } catch {
    throw networkError();
  }
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  if (!response.ok) throw toApiError(response, parsed);
  return parsed as T;
}

export function storePreview(itemId: string, revision: number, svg: string): Promise<{ kept: boolean }> {
  return putBytes(
    `/api/v1/whiteboards/${itemId}/preview?revision=${revision}`,
    new Blob([svg], { type: "image/svg+xml" }),
  );
}

export function restoreWhiteboardVersion(itemId: string, number: number) {
  return request(() =>
    api.POST("/api/v1/whiteboards/{itemId}/versions/{number}/restore", {
      params: { path: { itemId, number } },
    }),
  );
}

export async function uploadImage(itemId: string, file: { id: string; mimeType: string; dataURL: string }) {
  const blob = await (await fetch(file.dataURL)).blob();
  const extension = file.mimeType.split("/")[1]?.replace("svg+xml", "svg") ?? "bin";
  const response = await fetch(
    `/api/v1/pages/${itemId}/attachments?name=${encodeURIComponent(`image-${file.id}.${extension}`)}`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/octet-stream", [CSRF_HEADER]: "1" },
      body: blob,
    },
  ).catch(() => {
    throw networkError();
  });
  const parsed = (await response.json().catch(() => null)) as { id?: string } | null;
  if (!response.ok || !parsed?.id) throw toApiError(response, parsed);
  return parsed.id;
}

export async function loadImage(attachmentId: string, mimeType: string, version?: number): Promise<string> {
  const bytes = await fetchBytes(contentUrl(attachmentId, version === undefined ? {} : { version }));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([bytes], { type: mimeType }));
  });
}
