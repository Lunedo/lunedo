import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import type { Server } from "@hocuspocus/server";
import { createLogger } from "@pagehall/shared/node";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { createCollabServer } from "./server.js";

let server: Server | undefined;

afterEach(async () => {
  await server?.destroy();
  server = undefined;
});

async function start(query: () => Promise<unknown>) {
  server = createCollabServer({
    config: { host: "127.0.0.1", port: 0, logLevel: "silent", databaseUrl: "" },
    logger: createLogger({ service: "collab", level: "silent" }),
    pool: { query: vi.fn(query) } as never,
  });
  await server.listen();
  return { http: `http://127.0.0.1:${server.address.port}`, ws: `ws://127.0.0.1:${server.address.port}` };
}

describe("collaboration server", () => {
  it("reports liveness and readiness", async () => {
    const { http } = await start(async () => ({}));
    expect((await fetch(`${http}/health/live`)).status).toBe(200);
    const ready = await fetch(`${http}/health/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({ checks: { database: { status: "ok" } } });
  });

  it("reports not ready when the database fails", async () => {
    const { http } = await start(async () => {
      throw new Error("down");
    });
    expect((await fetch(`${http}/health/ready`)).status).toBe(503);
  });

  it("answers other HTTP requests with 404", async () => {
    const { http } = await start(async () => ({}));
    const response = await fetch(`${http}/`);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it("rejects every document connection", async () => {
    const { ws } = await start(async () => ({}));
    const socket = new HocuspocusProviderWebsocket({ url: ws });
    const reason = await new Promise<string>((resolve) => {
      const provider = new HocuspocusProvider({
        websocketProvider: socket,
        name: "page-1",
        document: new Y.Doc(),
        token: "anything",
        onAuthenticationFailed: ({ reason }) => {
          provider.destroy();
          resolve(reason);
        },
      });
      provider.attach();
    });
    socket.destroy();
    expect(reason).toBeTruthy();
  });
});
