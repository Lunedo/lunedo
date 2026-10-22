import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createLogger } from "@lunedo/server";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { attachCollabProxy } from "./collab-proxy.js";

const servers: { close(callback?: () => void): void }[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function listen(server: Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

async function upstream(): Promise<{ port: number; seen: IncomingHttpHeaders[]; paths: string[] }> {
  const seen: IncomingHttpHeaders[] = [];
  const paths: string[] = [];
  const http = createServer();
  const sockets = new WebSocketServer({ server: http });
  servers.push(sockets);
  sockets.on("connection", (socket, request) => {
    seen.push(request.headers);
    paths.push(request.url ?? "");
    socket.on("message", (data) => socket.send(`echo:${data.toString()}`));
  });
  return { port: await listen(http), seen, paths };
}

async function proxy(upstreamPort: number, trustedProxies: string[] = []): Promise<number> {
  const http = createServer((_request, response) => response.writeHead(404).end());
  attachCollabProxy(http, {
    upstream: `http://127.0.0.1:${upstreamPort}`,
    trustedProxies,
    logger: createLogger({ service: "api", level: "silent" }),
  });
  return listen(http);
}

function open(url: string, headers: Record<string, string>): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers });
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
    socket.once("unexpected-response", (_request, response) =>
      reject(new Error(`status ${response.statusCode}`)),
    );
  });
}

describe("collaboration proxy", () => {
  it("forwards WebSocket connections on /collab with their cookie and origin", async () => {
    const target = await upstream();
    const port = await proxy(target.port);
    const socket = await open(`ws://127.0.0.1:${port}/collab`, {
      cookie: "__Host-lunedo-session=abc",
      origin: "https://wiki.example.org",
      "x-forwarded-for": "203.0.113.66",
    });
    const reply = new Promise<string>((resolve) =>
      socket.once("message", (data) => resolve(data.toString())),
    );
    socket.send("hello");
    expect(await reply).toBe("echo:hello");
    socket.close();
    expect(target.paths).toEqual(["/collab"]);
    expect(target.seen[0]).toMatchObject({
      cookie: "__Host-lunedo-session=abc",
      origin: "https://wiki.example.org",
      "x-forwarded-for": "127.0.0.1",
      "x-forwarded-proto": "http",
    });
  });

  it("passes the client address on from trusted proxies only", async () => {
    const target = await upstream();
    const port = await proxy(target.port, ["127.0.0.1"]);
    const socket = await open(`ws://127.0.0.1:${port}/collab`, { "x-forwarded-for": "203.0.113.66" });
    socket.close();
    expect(target.seen[0]?.["x-forwarded-for"]).toBe("203.0.113.66");
  });

  it("refuses other paths and reports an unreachable collaboration server", async () => {
    const target = await upstream();
    const port = await proxy(target.port);
    await expect(open(`ws://127.0.0.1:${port}/other`, {})).rejects.toThrow("status 404");
    const down = await proxy(1);
    await expect(open(`ws://127.0.0.1:${down}/collab`, {})).rejects.toThrow("status 502");
    expect(target.paths).toEqual([]);
  });
});
