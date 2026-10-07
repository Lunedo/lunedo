import { request as httpRequest, type IncomingMessage, type Server } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Duplex } from "node:stream";
import type { TLSSocket } from "node:tls";
import { clientAddress, type Logger, trustedProxyList } from "@pagehall/server";

export const COLLAB_PATH = "/collab";

const FORWARDING_HEADERS = new Set(["x-forwarded-for", "x-forwarded-proto", "x-forwarded-host"]);

function rejectUpgrade(socket: Duplex, status: string): void {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function headerBlock(statusLine: string, rawHeaders: string[]): string {
  let block = `${statusLine}\r\n`;
  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    block += `${rawHeaders[index]}: ${rawHeaders[index + 1]}\r\n`;
  }
  return `${block}\r\n`;
}

export function attachCollabProxy(
  server: Server,
  options: { upstream: string; trustedProxies: readonly string[]; logger: Logger },
): void {
  const target = new URL(options.upstream);
  const proxies = trustedProxyList(options.trustedProxies);
  const send = target.protocol === "https:" ? httpsRequest : httpRequest;

  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path !== COLLAB_PATH) {
      rejectUpgrade(socket, "404 Not Found");
      return;
    }
    const encrypted = (request.socket as TLSSocket).encrypted === true;
    const headers: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(request.headers)) {
      if (value !== undefined && !FORWARDING_HEADERS.has(name)) headers[name] = value;
    }
    headers["x-forwarded-for"] = clientAddress(
      request.socket.remoteAddress,
      request.headers["x-forwarded-for"],
      proxies,
    );
    headers["x-forwarded-proto"] = encrypted ? "https" : "http";
    if (request.headers.host) headers["x-forwarded-host"] = request.headers.host;

    const upstream = send({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: request.method,
      path: request.url,
      headers,
    });
    upstream.on("upgrade", (response, upstreamSocket: Duplex, upstreamHead: Buffer) => {
      socket.write(
        headerBlock(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}`, response.rawHeaders),
      );
      if (upstreamHead.length > 0) socket.write(upstreamHead);
      if (head.length > 0) upstreamSocket.write(head);
      upstreamSocket.on("error", () => socket.destroy());
      socket.on("error", () => upstreamSocket.destroy());
      upstreamSocket.pipe(socket).pipe(upstreamSocket);
    });
    upstream.on("response", (response) => {
      socket.write(
        headerBlock(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}`, response.rawHeaders),
      );
      response.pipe(socket);
    });
    upstream.on("error", (error) => {
      options.logger.warn({ err: error }, "The collaboration server could not be reached");
      rejectUpgrade(socket, "502 Bad Gateway");
    });
    socket.on("error", () => upstream.destroy());
    upstream.end();
  });
}
