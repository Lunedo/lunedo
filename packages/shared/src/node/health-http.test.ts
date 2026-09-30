import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { HealthCheck } from "../health.js";
import { handleHealthRequest } from "./health-http.js";
import { createLogger } from "./logger.js";

let server: Server | undefined;

async function start(ready: Record<string, HealthCheck>): Promise<string> {
  const logger = createLogger({ service: "test", level: "silent" });
  server = createServer((request, response) => {
    handleHealthRequest(request, response, { ready, logger }).then(
      (handled) => {
        if (!handled) response.writeHead(404).end();
      },
      () => response.writeHead(500).end(),
    );
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await new Promise((resolve) => server?.close(resolve));
});

describe("handleHealthRequest", () => {
  it("answers liveness without running checks", async () => {
    const base = await start({
      database: async () => {
        throw new Error("down");
      },
    });
    const response = await fetch(`${base}/health/live`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok", checks: {} });
  });

  it("answers readiness with 200 when checks pass", async () => {
    const base = await start({ database: async () => {} });
    const response = await fetch(`${base}/health/ready`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok", checks: { database: { status: "ok" } } });
  });

  it("answers readiness with 503 when a check fails", async () => {
    const base = await start({
      database: async () => {
        throw new Error("down");
      },
    });
    const response = await fetch(`${base}/health/ready`);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "error" });
  });

  it("ignores other paths and methods", async () => {
    const base = await start({});
    expect((await fetch(`${base}/other`)).status).toBe(404);
    expect((await fetch(`${base}/health/live`, { method: "POST" })).status).toBe(404);
  });
});
