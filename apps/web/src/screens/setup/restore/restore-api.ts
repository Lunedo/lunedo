import { api, CSRF_HEADER } from "../../../api/client.js";
import type { paths } from "../../../api/generated/schema.js";
import { ApiError, networkError, request, toApiError } from "../../../api/request.js";

export type RestoreStart = NonNullable<
  paths["/api/v1/setup/restore"]["post"]["requestBody"]
>["content"]["application/json"];
export type S3Input = NonNullable<
  paths["/api/v1/setup/restore/s3"]["post"]["requestBody"]
>["content"]["application/json"];
export type BackupEntry = Awaited<ReturnType<typeof listServerBackups>>["backups"][number];
export type UploadState = Awaited<ReturnType<typeof getUpload>>;
export type RestoreStatus = Awaited<ReturnType<typeof restoreStatus>>;

const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
const MIN_CHUNK_BYTES = 256 * 1024;
const RETRY_DELAYS_MS = [1000, 2000, 5000, 10_000, 30_000];
const UPLOAD_MEMORY = "lunedo.setupRestoreUpload";

export function listServerBackups(directory?: string) {
  return request(
    () =>
      api.GET("/api/v1/setup/restore/sources", {
        params: { query: directory ? { directory } : {} },
      }),
    { sessionHandling: false },
  );
}

export function getUpload(uploadId: string) {
  return request(
    () => api.GET("/api/v1/setup/restore/uploads/{uploadId}", { params: { path: { uploadId } } }),
    {
      sessionHandling: false,
    },
  );
}

export function listBucketBackups(input: S3Input) {
  return request(() => api.POST("/api/v1/setup/restore/s3", { body: input }), { sessionHandling: false });
}

export function startRestore(body: RestoreStart) {
  return request(() => api.POST("/api/v1/setup/restore", { body }), { sessionHandling: false });
}

export function restoreStatus() {
  return request(() => api.GET("/api/v1/setup/restore/status"), { sessionHandling: false });
}

interface RememberedUpload {
  id: string;
  name: string;
  size: number;
  lastModified: number;
}

function rememberedUpload(file: File): string | null {
  try {
    const stored = JSON.parse(
      globalThis.sessionStorage?.getItem(UPLOAD_MEMORY) ?? "null",
    ) as RememberedUpload | null;
    return stored &&
      stored.name === file.name &&
      stored.size === file.size &&
      stored.lastModified === file.lastModified
      ? stored.id
      : null;
  } catch {
    return null;
  }
}

function rememberUpload(file: File, id: string | null): void {
  try {
    if (id === null) globalThis.sessionStorage?.removeItem(UPLOAD_MEMORY);
    else
      globalThis.sessionStorage?.setItem(
        UPLOAD_MEMORY,
        JSON.stringify({ id, name: file.name, size: file.size, lastModified: file.lastModified }),
      );
  } catch {
    return;
  }
}

export async function openUpload(file: File): Promise<UploadState> {
  const earlier = rememberedUpload(file);
  if (earlier) {
    try {
      return await getUpload(earlier);
    } catch {
      rememberUpload(file, null);
    }
  }
  const started = await request(
    () => api.POST("/api/v1/setup/restore/uploads", { body: { name: file.name, size: file.size } }),
    { sessionHandling: false },
  );
  rememberUpload(file, started.id);
  return started;
}

function sendPart(
  id: string,
  offset: number,
  body: Blob,
  onProgress: (loaded: number) => void,
  signal: AbortSignal,
): Promise<UploadState> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/v1/setup/restore/uploads/${encodeURIComponent(id)}?offset=${offset}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.setRequestHeader(CSRF_HEADER, "1");
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () => {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(xhr.responseText);
      } catch {
        parsed = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(parsed as UploadState);
      else reject(toApiError(new Response(null, { status: xhr.status }), parsed));
    };
    xhr.onerror = () => reject(networkError());
    xhr.onabort = () => reject(new DOMException("The upload was cancelled", "AbortError"));
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
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

function retryable(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return false;
  if (!(error instanceof ApiError)) return true;
  return error.status === 0 || error.status >= 500 || error.status === 429 || error.code === "uploadOffset";
}

export async function uploadFile(options: {
  file: File;
  upload: UploadState;
  signal: AbortSignal;
  onProgress: (received: number) => void;
}): Promise<UploadState> {
  const { file, signal, onProgress } = options;
  let state = options.upload;
  let chunk = MAX_CHUNK_BYTES;
  let failures = 0;
  onProgress(state.received);
  while (!state.complete) {
    signal.throwIfAborted();
    const offset = state.received;
    const end = Math.min(file.size, offset + chunk);
    try {
      state = await sendPart(
        state.id,
        offset,
        file.slice(offset, end),
        (loaded) => onProgress(offset + loaded),
        signal,
      );
      failures = 0;
      onProgress(state.received);
    } catch (error) {
      if (error instanceof ApiError && error.status === 413 && chunk > MIN_CHUNK_BYTES) {
        chunk = Math.max(MIN_CHUNK_BYTES, Math.floor(chunk / 2));
        continue;
      }
      const delay = RETRY_DELAYS_MS[failures];
      if (!retryable(error) || delay === undefined) throw error;
      failures += 1;
      await wait(delay, signal);
      state = await getUpload(state.id);
      onProgress(state.received);
    }
  }
  rememberUpload(file, null);
  return state;
}
