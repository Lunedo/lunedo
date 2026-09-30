import { createLogger } from "@pagehall/shared/node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorker, type Worker } from "./worker.js";

let worker: Worker | undefined;

afterEach(async () => {
  await worker?.stop();
  worker = undefined;
});

function create(port: number, query: () => Promise<unknown>): Worker {
  return createWorker({
    config: { host: "127.0.0.1", port, logLevel: "silent", databaseUrl: "" },
    logger: createLogger({ service: "worker", level: "silent" }),
    pool: { query: vi.fn(query) } as never,
  });
}

async function start(query: () => Promise<unknown>): Promise<string> {
  worker = create(0, query);
  const address = await worker.start();
  return `http://127.0.0.1:${address.port}`;
}

describe("worker", () => {
  it("reports liveness and readiness", async () => {
    const base = await start(async () => ({}));
    expect((await fetch(`${base}/health/live`)).status).toBe(200);
    expect((await fetch(`${base}/health/ready`)).status).toBe(200);
  });

  it("reports not ready when the database fails", async () => {
    const base = await start(async () => {
      throw new Error("down");
    });
    expect((await fetch(`${base}/health/ready`)).status).toBe(503);
  });

  it("answers other paths with 404", async () => {
    const base = await start(async () => ({}));
    expect((await fetch(`${base}/`)).status).toBe(404);
  });

  it("fails to start when the port is taken", async () => {
    const base = await start(async () => ({}));
    await expect(create(Number(new URL(base).port), async () => ({})).start()).rejects.toThrow();
  });
});
