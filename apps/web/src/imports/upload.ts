import { api, CSRF_HEADER } from "../api/client.js";
import { ApiError, networkError, request, toApiError } from "../api/request.js";

export interface UploadInfo {
  id: string;
  name: string;
  size: number;
  partSize: number;
  partCount: number;
  parts: { number: number; size: number }[];
  complete: boolean;
}

export interface UploadProgress {
  sent: number;
  total: number;
  phase: "uploading" | "waiting" | "checking" | "done";
}

const RETRY_DELAYS_MS = [1000, 2000, 5000, 10_000, 30_000];

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function combinedSha256(partDigests: readonly string[]): Promise<string> {
  return sha256Hex(new TextEncoder().encode(partDigests.join("")).buffer as ArrayBuffer);
}

export function createUpload(organizationId: string, file: File): Promise<UploadInfo> {
  return request(() =>
    api.POST("/api/v1/organizations/{organizationId}/import-uploads", {
      params: { path: { organizationId } },
      body: { name: file.name, size: file.size },
    }),
  );
}

export function getUpload(organizationId: string, uploadId: string): Promise<UploadInfo> {
  return request(() =>
    api.GET("/api/v1/organizations/{organizationId}/import-uploads/{uploadId}", {
      params: { path: { organizationId, uploadId } },
    }),
  );
}

function sendPart(
  url: string,
  body: Blob,
  onProgress: (loaded: number) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.withCredentials = true;
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.setRequestHeader(CSRF_HEADER, "1");
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      let problem: unknown = null;
      try {
        problem = JSON.parse(xhr.responseText);
      } catch {
        problem = null;
      }
      reject(toApiError(new Response(null, { status: xhr.status }), problem));
    };
    xhr.onerror = () => reject(networkError());
    xhr.onabort = () => reject(new DOMException("The upload was cancelled", "AbortError"));
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

function retryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return !(error instanceof DOMException && error.name === "AbortError");
  return error.status === 0 || error.status >= 500 || error.status === 429;
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const onlineAgain = () => {
      clearTimeout(timer);
      resolve();
    };
    globalThis.addEventListener?.("online", onlineAgain, { once: true });
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("The upload was cancelled", "AbortError"));
      },
      { once: true },
    );
  });
}

export async function uploadParts(options: {
  organizationId: string;
  file: File;
  upload: UploadInfo;
  signal: AbortSignal;
  onProgress: (progress: UploadProgress) => void;
}): Promise<UploadInfo> {
  const { organizationId, file, upload, signal, onProgress } = options;
  const stored = new Set(upload.parts.map((part) => part.number));
  const digests: string[] = [];
  let confirmed = upload.parts.reduce((sum, part) => sum + part.size, 0);
  const report = (phase: UploadProgress["phase"], inFlight = 0) =>
    onProgress({ sent: Math.min(file.size, confirmed + inFlight), total: file.size, phase });
  report("uploading");
  for (let number = 1; number <= upload.partCount; number += 1) {
    signal.throwIfAborted();
    const blob = file.slice((number - 1) * upload.partSize, Math.min(file.size, number * upload.partSize));
    const digest = await sha256Hex(await blob.arrayBuffer());
    digests.push(digest);
    if (stored.has(number)) continue;
    const url = `/api/v1/organizations/${organizationId}/import-uploads/${upload.id}/parts/${number}?sha256=${digest}`;
    for (let attempt = 0; ; attempt += 1) {
      try {
        await sendPart(url, blob, (loaded) => report("uploading", loaded), signal);
        break;
      } catch (error) {
        if (!retryable(error)) throw error;
        report("waiting");
        await wait(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] ?? 30_000, signal);
        report("uploading");
      }
    }
    confirmed += blob.size;
    report("uploading");
  }
  report("checking");
  const sha256 = await combinedSha256(digests);
  const completed = await request(() =>
    api.POST("/api/v1/organizations/{organizationId}/import-uploads/{uploadId}/complete", {
      params: { path: { organizationId, uploadId: upload.id } },
      body: { sha256 },
    }),
  );
  report("done");
  return completed;
}
