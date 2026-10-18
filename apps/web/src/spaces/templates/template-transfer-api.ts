import { CSRF_HEADER } from "../../api/client.js";
import type { paths } from "../../api/generated/schema.js";
import { networkError, toApiError } from "../../api/request.js";
import { downloadBlob } from "../../components/download.js";
import type { ImageSize } from "../../files/attachments-api.js";

type Json<T> = T extends { content: { "application/json": infer Body } } ? Body : never;

export type TemplateFile = Json<
  paths["/api/v1/spaces/{spaceId}/templates/{templateId}/files"]["post"]["responses"][201]
>;
export type ExportSummary = Json<
  paths["/api/v1/spaces/{spaceId}/templates/export-summary"]["post"]["responses"][200]
>;
export type ExportedTemplate = ExportSummary["templates"][number];
export type ImportPreview = Json<
  paths["/api/v1/spaces/{spaceId}/template-imports"]["post"]["responses"][201]
>;
export type ImportedTemplate = ImportPreview["templates"][number];
export type ImportResult = Json<
  paths["/api/v1/spaces/{spaceId}/template-imports/{importId}/confirm"]["post"]["responses"][200]
>;
export type RemovedReferences = ExportedTemplate["removed"];

export interface ImportDecision {
  index: number;
  action: "create" | "replace" | "skip";
  name?: string;
}

export interface TemplateLevelApi {
  fileUrl(templateId: string, fileId: string, size?: ImageSize): string;
  uploadImage(templateId: string, file: File): Promise<TemplateFile>;
  exportSummary(templateIds: string[] | null): Promise<ExportSummary>;
  exportFile(templateIds: string[] | null): Promise<void>;
  exportBuiltIn?: ((language: "en" | "de") => Promise<void>) | undefined;
  preview(file: File): Promise<ImportPreview>;
  previewFileUrl(importId: string, fileId: string): string;
  confirm(importId: string, decisions: ImportDecision[], skipInvalid: boolean): Promise<ImportResult>;
  discard(importId: string): Promise<void>;
}

async function send(url: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: "same-origin",
      ...init,
      headers: { [CSRF_HEADER]: "1", ...init.headers },
    });
  } catch {
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
  return response;
}

async function json<T>(url: string, init: RequestInit): Promise<T> {
  return (await (await send(url, init)).json()) as T;
}

function postJson<T>(url: string, body: unknown): Promise<T> {
  return json<T>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function postFile<T>(url: string, file: File): Promise<T> {
  return json<T>(`${url}?name=${encodeURIComponent(file.name)}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: file,
  });
}

function fileNameOf(response: Response, fallback: string): string {
  const header = response.headers.get("content-disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return fallback;
    }
  }
  return /filename="([^"]+)"/i.exec(header)?.[1] ?? fallback;
}

async function download(url: string, body: unknown): Promise<void> {
  const response = await send(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  downloadBlob(fileNameOf(response, "templates.pagehall-template.json"), await response.blob());
}

export function templateLevelApi(base: string, options: { builtIn?: boolean } = {}): TemplateLevelApi {
  return {
    fileUrl: (templateId, fileId, size) =>
      `${base}/templates/${templateId}/files/${fileId}/content${size ? `?size=${size}` : ""}`,
    uploadImage: (templateId, file) => postFile(`${base}/templates/${templateId}/files`, file),
    exportSummary: (templateIds) => postJson(`${base}/templates/export-summary`, { templateIds }),
    exportFile: (templateIds) => download(`${base}/templates/export`, { templateIds }),
    exportBuiltIn: options.builtIn
      ? (language) => download(`${base}/templates/built-in/export`, { language, templateIds: null })
      : undefined,
    preview: (file) => postFile(`${base}/template-imports`, file),
    previewFileUrl: (importId, fileId) => `${base}/template-imports/${importId}/files/${fileId}/content`,
    confirm: (importId, decisions, skipInvalid) =>
      postJson(`${base}/template-imports/${importId}/confirm`, { decisions, skipInvalid }),
    discard: async (importId) => {
      await send(`${base}/template-imports/${importId}`, { method: "DELETE" });
    },
  };
}

export const REMOVAL_KINDS = [
  "pageLink",
  "mention",
  "include",
  "diagramReference",
  "whiteboard",
  "templateButton",
  "report",
  "roadmap",
  "person",
  "comment",
  "meetingTopic",
  "file",
  "unsupportedMacro",
] as const;

export function removedEntries(removed: RemovedReferences): [string, number][] {
  return REMOVAL_KINDS.flatMap((kind) => {
    const count = removed[kind] ?? 0;
    return count > 0 ? [[kind, count] as [string, number]] : [];
  });
}
