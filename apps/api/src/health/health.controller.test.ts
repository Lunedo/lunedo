import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestApp } from "../testing/create-test-app.js";

let app: NestFastifyApplication | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function pool(query: () => Promise<unknown>) {
  return { query: vi.fn(query), end: vi.fn(async () => {}) } as never;
}

describe("health endpoints", () => {
  it("report liveness without touching the database", async () => {
    const database = pool(async () => {
      throw new Error("down");
    });
    app = await createTestApp({ pool: database });
    const response = await app.inject({ method: "GET", url: "/health/live" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", checks: {} });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("report ready when the database answers", async () => {
    app = await createTestApp({ pool: pool(async () => ({ rows: [] })) });
    const response = await app.inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", checks: { database: { status: "ok" } } });
  });

  it("report not ready without exposing the database error", async () => {
    app = await createTestApp({
      pool: pool(async () => {
        throw new Error("password authentication failed for user pagehall");
      }),
    });
    const response = await app.inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: "error", checks: { database: { status: "error" } } });
    expect(response.body).not.toContain("password");
  });

  it("return a request ID with every response", async () => {
    app = await createTestApp({ pool: pool(async () => ({})) });
    const response = await app.inject({ method: "GET", url: "/health/live" });
    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

const databaseUrl = process.env.PAGEHALL_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("health endpoints against PostgreSQL", () => {
  it("report ready", async () => {
    app = await createTestApp({ config: { databaseUrl: databaseUrl ?? "" } });
    const response = await app.inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(200);
  });
});
