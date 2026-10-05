import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeRequest {
  method: string;
  url: URL;
  segments: string[];
  headers: IncomingMessage["headers"];
  body: string;
}

export interface FakeResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export type FakeHandler = (request: FakeRequest) => FakeResponse | Promise<FakeResponse>;

export interface RunningFake {
  url: string;
  close(): Promise<void>;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function send(response: ServerResponse, result: FakeResponse): void {
  const headers = { "content-type": "application/json", ...result.headers };
  response.writeHead(result.status, headers);
  response.end(result.body === undefined ? undefined : JSON.stringify(result.body));
}

export async function serveFake(handler: FakeHandler, port = 0, host = "127.0.0.1"): Promise<RunningFake> {
  const server: Server = createServer((request, response) => {
    void (async () => {
      try {
        const url = new URL(request.url ?? "/", `http://${request.headers.host ?? host}`);
        const result = await handler({
          method: request.method ?? "GET",
          url,
          segments: url.pathname.split("/").filter(Boolean).map(decodeURIComponent),
          headers: request.headers,
          body: await readBody(request),
        });
        send(response, result);
      } catch (error) {
        send(response, { status: 500, body: { error: String(error) } });
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://${host}:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export function issueToken(): string {
  return randomBytes(24).toString("base64url");
}

export function bearer(request: FakeRequest): string | null {
  const header = request.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
}

export function formBody(request: FakeRequest): URLSearchParams {
  return new URLSearchParams(request.body);
}

export function jsonBody<T>(request: FakeRequest): T {
  return (request.body ? JSON.parse(request.body) : {}) as T;
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function page<T>(
  items: readonly T[],
  offset: number,
  size: number,
): { items: T[]; next: number | null } {
  const slice = items.slice(offset, offset + size);
  return { items: slice, next: offset + size < items.length ? offset + size : null };
}
