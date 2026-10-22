import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp } from "../testing/create-test-app.js";

let app: NestFastifyApplication | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const failing = async () => {
  throw new Error("password authentication failed for user lunedo");
};

describe("health endpoints", () => {
  it("report liveness without running readiness checks", async () => {
    app = await createTestApp({ readiness: { database: failing } });
    const response = await app.inject({ method: "GET", url: "/health/live" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", checks: {} });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("report ready when all checks pass", async () => {
    app = await createTestApp({
      readiness: { database: async () => {}, migrations: async () => {}, masterKey: async () => {} },
    });
    const response = await app.inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(200);
    expect(Object.keys(response.json().checks)).toEqual(["database", "migrations", "masterKey"]);
  });

  it("report not ready without exposing the error", async () => {
    app = await createTestApp({ readiness: { database: failing, masterKey: async () => {} } });
    const response = await app.inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: "error", checks: { database: { status: "error" } } });
    expect(response.body).not.toContain("password");
  });

  it("return a request ID with every response", async () => {
    app = await createTestApp();
    const response = await app.inject({ method: "GET", url: "/health/live" });
    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});
