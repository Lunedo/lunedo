import type { Readable } from "node:stream";
import { setTimeout as sleepFor } from "node:timers/promises";
import type { z } from "zod";
import { OutboundError, type OutboundPolicy, openOutbound } from "../../outbound/guarded-request.js";
import { ImportError, ImportFormatError } from "../errors.js";

export type ConfluenceKind = "cloud" | "dataCenter";

export interface ConfluenceConnection {
  readonly kind: ConfluenceKind;
  readonly site: string;
  readonly basePath: string;
  readonly email: string | null;
  readonly token: string;
  readonly caCertificates: string | null;
}

export interface TransportResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: Readable;
}

export interface TransportRequest {
  readonly headers: Readonly<Record<string, string>>;
  readonly ca: string | null;
  readonly signal: AbortSignal | undefined;
  readonly timeoutMs: number;
}

export interface ConfluenceTransport {
  get(url: string, request: TransportRequest): Promise<TransportResponse>;
}

export function guardedTransport(policy: OutboundPolicy): ConfluenceTransport {
  return {
    async get(url, request) {
      const response = await openOutbound(policy, {
        url,
        headers: { ...request.headers },
        timeoutMs: request.timeoutMs,
        idleTimeoutMs: request.timeoutMs,
        ca: request.ca ?? undefined,
        signal: request.signal,
      });
      return { status: response.status, headers: response.headers, body: response.body };
    },
  };
}

export const CLOUD_MEDIA_HOSTS: readonly string[] = ["api.media.atlassian.com"];

const TIMEOUT_MS = 30_000;
const MAX_JSON_BYTES = 32 * 1024 * 1024;
const MAX_ATTEMPTS = 8;
const MAX_WAIT_MS = 5 * 60 * 1000;
const FIRST_BACKOFF_MS = 1000;

export interface ConfluenceApiOptions {
  readonly signal?: AbortSignal | undefined;
  readonly onThrottle?: ((until: Date) => Promise<void>) | undefined;
  readonly sleep?: ((milliseconds: number, signal: AbortSignal | undefined) => Promise<void>) | undefined;
  readonly now?: (() => number) | undefined;
}

export class ConfluenceUnavailableError extends ImportError {
  constructor(code: "confluenceUnreachable" | "confluenceRateLimited") {
    super(
      code,
      code === "confluenceRateLimited"
        ? "Confluence asked Pagehall to slow down for longer than it waits. The import continues later."
        : "Pagehall could not reach Confluence. It tries again shortly.",
    );
  }
}

function header(headers: TransportResponse["headers"], name: string): string | null {
  const value = headers[name];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function retryDelay(headers: TransportResponse["headers"], now: number): number | null {
  for (const name of ["retry-after", "beta-retry-after"]) {
    const value = header(headers, name)?.trim();
    if (!value) continue;
    if (/^\d+(\.\d+)?$/.test(value)) return Math.round(Number(value) * 1000);
    const date = Date.parse(value);
    if (!Number.isNaN(date)) return Math.max(0, date - now);
  }
  const reset = header(headers, "x-ratelimit-reset")?.trim();
  if (reset) {
    const date = /^\d{10}$/.test(reset) ? Number(reset) * 1000 : Date.parse(reset);
    if (!Number.isNaN(date)) return Math.max(0, date - now);
  }
  return null;
}

async function discard(body: Readable): Promise<void> {
  body.resume();
  body.destroy();
}

async function readJson(body: Readable): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) {
      body.destroy();
      throw new ImportFormatError("confluenceResponseTooLarge", "Confluence sent an answer above the limit.");
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new ImportFormatError(
      "confluenceInvalidResponse",
      "Confluence sent an answer Pagehall cannot read.",
    );
  }
}

function unauthorized(kind: ConfluenceKind): ImportFormatError {
  return new ImportFormatError(
    "confluenceUnauthorized",
    kind === "cloud"
      ? "Confluence refused the e-mail address and API token. Check both and that the token is still valid."
      : "Confluence refused the personal access token. Check that it is still valid.",
  );
}

export class ConfluenceApi {
  readonly #connection: ConfluenceConnection;
  readonly #transport: ConfluenceTransport;
  readonly #options: ConfluenceApiOptions;

  constructor(
    connection: ConfluenceConnection,
    transport: ConfluenceTransport,
    options: ConfluenceApiOptions = {},
  ) {
    this.#connection = connection;
    this.#transport = transport;
    this.#options = options;
  }

  get kind(): ConfluenceKind {
    return this.#connection.kind;
  }

  get base(): string {
    const root = this.#connection.kind === "cloud" ? "/wiki" : this.#connection.basePath;
    return `https://${this.#connection.site}${root}`;
  }

  #authorization(): string {
    if (this.#connection.kind === "dataCenter") return `Bearer ${this.#connection.token}`;
    const pair = `${this.#connection.email ?? ""}:${this.#connection.token}`;
    return `Basic ${Buffer.from(pair, "utf8").toString("base64")}`;
  }

  url(path: string): string {
    if (!path.startsWith("/") || path.startsWith("//") || /[\s\\]/.test(path)) {
      throw new ImportFormatError(
        "confluenceInvalidResponse",
        "Confluence sent a link Pagehall cannot follow.",
      );
    }
    return `${this.base}${path}`;
  }

  async #sleep(milliseconds: number): Promise<void> {
    const sleep = this.#options.sleep ?? ((ms, signal) => sleepFor(ms, undefined, signal ? { signal } : {}));
    await sleep(milliseconds, this.#options.signal);
  }

  async #send(url: string, headers: Record<string, string>): Promise<TransportResponse> {
    const now = this.#options.now ?? Date.now;
    let failures = 0;
    for (let attempt = 1; ; attempt += 1) {
      this.#options.signal?.throwIfAborted();
      let response: TransportResponse;
      try {
        response = await this.#transport.get(url, {
          headers,
          ca: this.#connection.caCertificates,
          signal: this.#options.signal,
          timeoutMs: TIMEOUT_MS,
        });
      } catch (error) {
        if (this.#options.signal?.aborted) throw error;
        if (error instanceof OutboundError && error.reason === "untrustedCertificate") {
          throw new ImportFormatError(
            "confluenceCertificate",
            "The certificate of the Confluence server is not trusted. Add the certificate of its authority to the connection.",
          );
        }
        if (
          error instanceof OutboundError &&
          ["blockedAddress", "insecureAddress", "invalidAddress"].includes(error.reason)
        ) {
          throw new ImportFormatError(
            "confluenceBlocked",
            "Pagehall may not connect to this address. Ask the instance administrators to allow its network.",
          );
        }
        failures += 1;
        if (failures >= 3) throw new ConfluenceUnavailableError("confluenceUnreachable");
        await this.#sleep(FIRST_BACKOFF_MS * 2 ** failures);
        continue;
      }
      if (response.status === 429 || response.status === 503) {
        await discard(response.body);
        if (attempt >= MAX_ATTEMPTS) throw new ConfluenceUnavailableError("confluenceRateLimited");
        const asked = retryDelay(response.headers, now());
        const wait = Math.min(asked ?? FIRST_BACKOFF_MS * 2 ** (attempt - 1), MAX_WAIT_MS);
        if (asked !== null && asked > MAX_WAIT_MS) {
          await this.#options.onThrottle?.(new Date(now() + asked));
          throw new ConfluenceUnavailableError("confluenceRateLimited");
        }
        const jitter = Math.floor(Math.random() * Math.min(1000, wait / 10));
        await this.#options.onThrottle?.(new Date(now() + wait + jitter));
        await this.#sleep(wait + jitter);
        continue;
      }
      if (response.status >= 500) {
        await discard(response.body);
        failures += 1;
        if (failures >= 3) throw new ConfluenceUnavailableError("confluenceUnreachable");
        await this.#sleep(FIRST_BACKOFF_MS * 2 ** failures);
        continue;
      }
      return response;
    }
  }

  async json<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
    const response = await this.#send(this.url(path), {
      Accept: "application/json",
      Authorization: this.#authorization(),
    });
    if (response.status === 401) {
      await discard(response.body);
      throw unauthorized(this.#connection.kind);
    }
    if (response.status === 403 || response.status === 404) {
      await discard(response.body);
      return null;
    }
    if (response.status < 200 || response.status >= 300) {
      await discard(response.body);
      throw new ImportFormatError(
        response.status >= 300 && response.status < 400 ? "confluenceRedirect" : "confluenceInvalidResponse",
        response.status >= 300 && response.status < 400
          ? "Confluence answered with a redirect to another address. Enter the address Confluence really uses."
          : "Confluence sent an answer Pagehall cannot read.",
      );
    }
    const parsed = schema.safeParse(await readJson(response.body));
    if (!parsed.success) {
      throw new ImportFormatError(
        "confluenceInvalidResponse",
        "Confluence sent an answer Pagehall cannot read.",
      );
    }
    return parsed.data;
  }

  async download(path: string): Promise<Readable | null> {
    const headers = { Accept: "*/*", Authorization: this.#authorization() };
    let response = await this.#send(this.url(path), headers);
    if (response.status >= 300 && response.status < 400) {
      const location = header(response.headers, "location");
      await discard(response.body);
      const target = location ? this.#mediaTarget(location) : null;
      if (!target) return null;
      response = await this.#send(target, { Accept: "*/*" });
      if (response.status >= 300 && response.status < 400) {
        await discard(response.body);
        return null;
      }
    }
    if (response.status === 401) {
      await discard(response.body);
      throw unauthorized(this.#connection.kind);
    }
    if (response.status < 200 || response.status >= 300) {
      await discard(response.body);
      return null;
    }
    return response.body;
  }

  #mediaTarget(location: string): string | null {
    if (this.#connection.kind !== "cloud") return null;
    let target: URL;
    try {
      target = new URL(location, this.base);
    } catch {
      return null;
    }
    if (target.protocol !== "https:" || target.port !== "" || target.username || target.password) return null;
    return CLOUD_MEDIA_HOSTS.includes(target.hostname.toLowerCase()) ? target.toString() : null;
  }
}
