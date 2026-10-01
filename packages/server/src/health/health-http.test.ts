import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { HealthCheck } from "@pagehall/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "../logging/logger.js";
import { isAuthorizedMetricsRequest, Metrics } from "../observability/metrics.js";
import { handleOperationsRequest } from "./health-http.js";

let server: Server | undefined;
const token = "metrics-token-value";

async function start(ready: Record<string, HealthCheck>): Promise<string> {
  const logger = createLogger({ service: "test", level: "silent" });
  const metrics = new Metrics("test");
  server = createServer((request, response) => {
    handleOperationsRequest(request, response, { ready, logger, metrics, metricsToken: token }).then(
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

const failing = async () => {
  throw new Error("down");
};

describe("handleOperationsRequest", () => {
  it("answers liveness without running checks", async () => {
    const base = await start({ database: failing });
    const response = await fetch(`${base}/health/live`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok", checks: {} });
  });

  it("answers readiness with 200 when checks pass and 503 otherwise", async () => {
    const ok = await start({ database: async () => {} });
    expect((await fetch(`${ok}/health/ready`)).status).toBe(200);
    await new Promise((resolve) => server?.close(resolve));
    const failed = await start({ database: failing });
    const response = await fetch(`${failed}/health/ready`);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "error" });
  });

  it("serves metrics only with the correct token", async () => {
    const base = await start({});
    expect((await fetch(`${base}/metrics`)).status).toBe(401);
    expect((await fetch(`${base}/metrics`, { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    expect((await fetch(`${base}/metrics`, { headers: { authorization: token } })).status).toBe(401);
    const response = await fetch(`${base}/metrics`, { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('process_cpu_user_seconds_total{service="test"}');
  });

  it("ignores other paths and methods", async () => {
    const base = await start({});
    expect((await fetch(`${base}/other`)).status).toBe(404);
    expect((await fetch(`${base}/health/live`, { method: "POST" })).status).toBe(404);
  });
});

describe("isAuthorizedMetricsRequest", () => {
  it("requires the bearer scheme and the exact token", () => {
    expect(isAuthorizedMetricsRequest(`Bearer ${token}`, token)).toBe(true);
    expect(isAuthorizedMetricsRequest(`bearer ${token}`, token)).toBe(false);
    expect(isAuthorizedMetricsRequest(`Bearer ${token}x`, token)).toBe(false);
    expect(isAuthorizedMetricsRequest(undefined, token)).toBe(false);
    expect(isAuthorizedMetricsRequest("Bearer ", token)).toBe(false);
  });
});

describe("Metrics", () => {
  it("records HTTP requests and job durations", async () => {
    const metrics = new Metrics("api");
    metrics.observeHttpRequest("GET", "/health/ready", 200, 0.012);
    metrics.observeJob({ name: "test.job", state: "failed", durationSeconds: 2 });
    const output = await metrics.render();
    expect(output).toMatch(
      /pagehall_http_requests_total\{[^}]*method="GET",route="\/health\/ready",status="200"[^}]*\} 1/,
    );
    expect(output).toMatch(
      /pagehall_job_duration_seconds_count\{[^}]*queue="test\.job",state="failed"[^}]*\} 1/,
    );
  });

  it("reports database pool usage and job counts on each scrape", async () => {
    const metrics = new Metrics("worker");
    metrics.observeDatabasePool({ totalCount: 5, idleCount: 3, waitingCount: 1 } as never);
    metrics.observeJobQueue({
      counts: async () => ({ "test.job": { queued: 4, active: 1, deferred: 0, failed: 2 } }),
    } as never);
    const output = await metrics.render();
    expect(output).toContain('pagehall_db_pool_connections{state="idle",service="worker"} 3');
    expect(output).toContain('pagehall_jobs{queue="test.job",state="failed",service="worker"} 2');
  });
});
