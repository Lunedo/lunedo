import { createLogger, Metrics } from "@lunedo/server";
import type { HealthCheck } from "@lunedo/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createOperationsServer, type OperationsServer } from "./worker.js";

let server: OperationsServer | undefined;
const token = "worker-metrics-token";

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

function create(port: number, ready: Record<string, HealthCheck> = {}): OperationsServer {
  return createOperationsServer({
    host: "127.0.0.1",
    port,
    endpoints: {
      ready,
      logger: createLogger({ service: "worker", level: "silent" }),
      metrics: new Metrics("worker"),
      metricsToken: token,
    },
  });
}

async function start(ready: Record<string, HealthCheck> = {}): Promise<string> {
  server = create(0, ready);
  const address = await server.start();
  return `http://127.0.0.1:${address.port}`;
}

describe("worker operations server", () => {
  it("reports liveness and readiness", async () => {
    const base = await start({ database: async () => {} });
    expect((await fetch(`${base}/health/live`)).status).toBe(200);
    expect((await fetch(`${base}/health/ready`)).status).toBe(200);
  });

  it("reports not ready when a check fails", async () => {
    const base = await start({
      masterKey: async () => {
        throw new Error("missing");
      },
    });
    expect((await fetch(`${base}/health/ready`)).status).toBe(503);
  });

  it("serves metrics only with the token", async () => {
    const base = await start();
    expect((await fetch(`${base}/metrics`)).status).toBe(401);
    expect((await fetch(`${base}/metrics`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(
      200,
    );
  });

  it("answers other paths with 404", async () => {
    const base = await start();
    expect((await fetch(`${base}/`)).status).toBe(404);
  });

  it("fails to start when the port is taken", async () => {
    const base = await start();
    await expect(create(Number(new URL(base).port)).start()).rejects.toThrow();
  });
});
