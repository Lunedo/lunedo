import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export interface RenderJob {
  html: string;
  baseUrl: string | null;
  assets: ReadonlyMap<string, { contentType: string; data: Buffer }>;
}

export interface Renderer {
  readonly browser: string;
  pdf(job: RenderJob, signal: AbortSignal): Promise<Buffer>;
}

export interface RenderServerOptions {
  token: string;
  version: string;
  renderer: Renderer;
  concurrency: number;
  maxWaiting: number;
  maxBytes: number;
  timeoutSeconds: number;
  log?: (message: string, fields?: Record<string, unknown>) => void;
}

const TOOK_TOO_LONG = "The document took longer than allowed";

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const ORIGIN = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;
const ASSET_PATH = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{1,500}$/;

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
    "cache-control": "no-store",
  });
  response.end(json);
}

function readBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declared = Number(request.headers["content-length"] ?? "0");
  if (declared > maxBytes) return Promise.reject(new HttpError(413, "The request is larger than allowed"));
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new HttpError(413, "The request is larger than allowed"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

export function parseJob(body: Buffer): RenderJob {
  let value: unknown;
  try {
    value = JSON.parse(body.toString("utf8"));
  } catch {
    throw new HttpError(400, "The request is not valid JSON");
  }
  const input = value as { html?: unknown; baseUrl?: unknown; assets?: unknown } | null;
  if (typeof input?.html !== "string" || input.html.length === 0) {
    throw new HttpError(400, "The request needs the HTML of the document");
  }
  if (!Array.isArray(input.assets)) throw new HttpError(400, "The request needs a list of assets");
  const baseUrl = input.baseUrl ?? null;
  if (baseUrl !== null && (typeof baseUrl !== "string" || !ORIGIN.test(baseUrl))) {
    throw new HttpError(400, "The base address must be an http or https origin");
  }
  const assets = new Map<string, { contentType: string; data: Buffer }>();
  for (const asset of input.assets as unknown[]) {
    const entry = asset as { path?: unknown; contentType?: unknown; data?: unknown } | null;
    if (
      typeof entry?.path !== "string" ||
      !ASSET_PATH.test(entry.path) ||
      typeof entry.contentType !== "string" ||
      !/^[\w.+-]+\/[\w.+-]+$/.test(entry.contentType) ||
      typeof entry.data !== "string"
    ) {
      throw new HttpError(400, "Every asset needs a path, a content type and base64 data");
    }
    assets.set(entry.path, { contentType: entry.contentType, data: Buffer.from(entry.data, "base64") });
  }
  return { html: input.html, baseUrl, assets };
}

export function createRenderServer(options: RenderServerOptions): Server {
  const expected = digest(options.token);
  let running = 0;
  const waiting: (() => void)[] = [];
  const log = options.log ?? (() => {});

  const authorized = (request: IncomingMessage): boolean => {
    const header = request.headers.authorization ?? "";
    const match = /^Bearer (.+)$/.exec(header);
    return match?.[1] !== undefined && timingSafeEqual(digest(match[1]), expected);
  };

  const slot = async (): Promise<() => void> => {
    if (running >= options.concurrency) {
      if (waiting.length >= options.maxWaiting) throw new HttpError(503, "Too many documents are waiting");
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    running += 1;
    return () => {
      running -= 1;
      waiting.shift()?.();
    };
  };

  const render = async (request: IncomingMessage, response: ServerResponse) => {
    const job = parseJob(await readBody(request, options.maxBytes));
    const release = await slot();
    const controller = new AbortController();
    const timedOut = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(new HttpError(504, TOOK_TOO_LONG)), {
        once: true,
      });
    });
    const timer = setTimeout(() => controller.abort(), options.timeoutSeconds * 1000);
    const started = Date.now();
    const rendering = options.renderer.pdf(job, controller.signal);
    rendering.then(release, release);
    try {
      const pdf = await Promise.race([rendering, timedOut]);
      if (controller.signal.aborted) throw new HttpError(504, TOOK_TOO_LONG);
      response.writeHead(200, {
        "content-type": "application/pdf",
        "content-length": pdf.length,
        "cache-control": "no-store",
      });
      response.end(pdf);
      log("Rendered a PDF", { milliseconds: Date.now() - started, bytes: pdf.length });
    } catch (error) {
      if (controller.signal.aborted) throw new HttpError(504, TOOK_TOO_LONG);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };

  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://render");
    const handle = async () => {
      if (request.method === "GET" && url.pathname === "/health") {
        send(response, 200, { status: "ok" });
        return;
      }
      if (url.pathname !== "/v1/info" && url.pathname !== "/v1/pdf") throw new HttpError(404, "Not found");
      if (!authorized(request)) throw new HttpError(401, "The token is missing or wrong");
      if (request.method === "GET" && url.pathname === "/v1/info") {
        send(response, 200, {
          version: options.version,
          browser: options.renderer.browser,
          concurrency: options.concurrency,
          running,
          waiting: waiting.length,
          maxBytes: options.maxBytes,
          timeoutSeconds: options.timeoutSeconds,
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/pdf") {
        await render(request, response);
        return;
      }
      throw new HttpError(405, "Method not allowed");
    };
    handle().catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) log("Rendering a PDF failed", { error: (error as Error).message });
      if (response.headersSent) {
        response.destroy();
        return;
      }
      send(response, status, {
        error: error instanceof HttpError ? error.message : "The PDF could not be created",
      });
      if (status === 413) request.resume();
    });
  });
}
