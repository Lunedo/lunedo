import type { Secret } from "../config/secret.js";
import type { Logger } from "../logging/logger.js";

export interface RenderConnection {
  url: string;
  token: Secret;
}

export interface RenderAsset {
  path: string;
  contentType: string;
  data: Buffer;
}

export interface RenderInfo {
  version: string;
  browser: string;
  concurrency: number;
  running: number;
  waiting: number;
  maxBytes: number;
  timeoutSeconds: number;
}

export type RenderStatus =
  | { state: "notConfigured" }
  | { state: "unreachable"; url: string; checkedAt: Date; reason: "connection" | "token" | "response" }
  | ({ state: "healthy"; url: string; checkedAt: Date } & RenderInfo);

export type RenderFailure = "unavailable" | "busy" | "tooLarge" | "timeout" | "failed";

export class RenderError extends Error {
  override name = "RenderError";

  constructor(readonly reason: RenderFailure) {
    super(`The render service could not create the PDF: ${reason}`);
  }
}

const STATUS_TIMEOUT_MS = 5_000;
const RESPONSE_MARGIN_MS = 30_000;

function failureOf(status: number): RenderFailure {
  if (status === 413) return "tooLarge";
  if (status === 429 || status === 503) return "busy";
  if (status === 504) return "timeout";
  if (status === 401 || status === 403) return "unavailable";
  return "failed";
}

function isInfo(value: unknown): value is RenderInfo {
  const info = value as Partial<RenderInfo> | null;
  return (
    typeof info?.version === "string" &&
    typeof info.browser === "string" &&
    Number.isInteger(info.concurrency) &&
    Number.isInteger(info.running) &&
    Number.isInteger(info.waiting) &&
    Number.isInteger(info.maxBytes) &&
    Number.isInteger(info.timeoutSeconds)
  );
}

export class RenderService {
  readonly #connection: RenderConnection | undefined;
  readonly #fetch: typeof fetch;
  readonly #logger: Logger;

  constructor(options: { connection: RenderConnection | undefined; logger: Logger; fetch?: typeof fetch }) {
    this.#connection = options.connection;
    this.#fetch = options.fetch ?? fetch;
    this.#logger = options.logger;
  }

  get configured(): boolean {
    return this.#connection !== undefined;
  }

  #headers(connection: RenderConnection): Record<string, string> {
    return { authorization: `Bearer ${connection.token.reveal()}` };
  }

  async status(): Promise<RenderStatus> {
    const connection = this.#connection;
    if (!connection) return { state: "notConfigured" };
    const checkedAt = new Date();
    let response: Response;
    try {
      response = await this.#fetch(`${connection.url}/v1/info`, {
        headers: this.#headers(connection),
        signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
      });
    } catch (error) {
      this.#logger.warn({ err: error }, "The render service could not be reached");
      return { state: "unreachable", url: connection.url, checkedAt, reason: "connection" };
    }
    if (response.status === 401 || response.status === 403) {
      return { state: "unreachable", url: connection.url, checkedAt, reason: "token" };
    }
    const body: unknown = response.ok ? await response.json().catch(() => null) : null;
    if (!isInfo(body)) return { state: "unreachable", url: connection.url, checkedAt, reason: "response" };
    return {
      state: "healthy",
      url: connection.url,
      checkedAt,
      version: body.version,
      browser: body.browser,
      concurrency: body.concurrency,
      running: body.running,
      waiting: body.waiting,
      maxBytes: body.maxBytes,
      timeoutSeconds: body.timeoutSeconds,
    };
  }

  async pdf(
    html: string,
    assets: readonly RenderAsset[],
    baseUrl: string,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    const connection = this.#connection;
    if (!connection) throw new RenderError("unavailable");
    const status = await this.status();
    if (status.state !== "healthy") throw new RenderError("unavailable");
    const body = JSON.stringify({
      html,
      baseUrl: /^https?:\/\//.test(baseUrl) ? new URL(baseUrl).origin : null,
      assets: assets.map((asset) => ({
        path: asset.path,
        contentType: asset.contentType,
        data: asset.data.toString("base64"),
      })),
    });
    if (Buffer.byteLength(body) > status.maxBytes) throw new RenderError("tooLarge");
    const timeout = AbortSignal.timeout(status.timeoutSeconds * 1000 + RESPONSE_MARGIN_MS);
    let response: Response;
    try {
      response = await this.#fetch(`${connection.url}/v1/pdf`, {
        method: "POST",
        headers: { ...this.#headers(connection), "content-type": "application/json" },
        body,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      this.#logger.warn({ err: error }, "The render service could not be reached");
      throw new RenderError(timeout.aborted ? "timeout" : "unavailable");
    }
    if (!response.ok) {
      this.#logger.warn({ status: response.status }, "The render service refused a PDF");
      throw new RenderError(failureOf(response.status));
    }
    const pdf = Buffer.from(await response.arrayBuffer());
    if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new RenderError("failed");
    return pdf;
  }
}
