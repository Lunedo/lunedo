import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, TEST_METRICS_TOKEN } from "../testing/create-test-app.js";

let app: NestFastifyApplication | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("GET /metrics", () => {
  it.each([
    ["no token", undefined],
    ["a wrong token", "Bearer wrong"],
    ["the token without scheme", TEST_METRICS_TOKEN],
    ["another scheme", `Basic ${TEST_METRICS_TOKEN}`],
  ])("rejects requests with %s", async (_case, authorization) => {
    app = await createTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: authorization ? { authorization } : {},
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers["www-authenticate"]).toBe("Bearer");
    expect(response.body).not.toContain("lunedo_");
  });

  it("answers with the correct token in Prometheus format", async () => {
    app = await createTestApp();
    await app.inject({ method: "GET", url: "/health/live" });
    const response = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: `Bearer ${TEST_METRICS_TOKEN}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.body).toMatch(/lunedo_http_requests_total\{[^}]*route="\/health\/live"[^}]*\} 1/);
  });

  it("labels unknown paths without the raw path", async () => {
    app = await createTestApp();
    await app.inject({ method: "GET", url: "/does-not-exist/12345" });
    const response = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: `Bearer ${TEST_METRICS_TOKEN}` },
    });
    expect(response.body).not.toContain("12345");
  });
});
