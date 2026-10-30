import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { HealthCheck } from "@lunedo/shared";
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
      /lunedo_http_requests_total\{[^}]*method="GET",route="\/health\/ready",status="200"[^}]*\} 1/,
    );
    expect(output).toMatch(
      /lunedo_job_duration_seconds_count\{[^}]*queue="test\.job",state="failed"[^}]*\} 1/,
    );
  });

  it("reports database pool usage and job counts on each scrape", async () => {
    const metrics = new Metrics("worker");
    metrics.observeDatabasePool({ totalCount: 5, idleCount: 3, waitingCount: 1 } as never);
    metrics.observeJobQueue({
      counts: async () => ({ "test.job": { queued: 4, active: 1, deferred: 0, failed: 2 } }),
    } as never);
    const output = await metrics.render();
    expect(output).toContain('lunedo_db_pool_connections{state="idle",service="worker"} 3');
    expect(output).toContain('lunedo_jobs{queue="test.job",state="failed",service="worker"} 2');
  });

  it("reports how long queries waited for a database connection and how many gave up", async () => {
    const metrics = new Metrics("api");
    metrics.observeDatabaseAcquire({ seconds: 0.2, timedOut: false });
    metrics.observeDatabaseAcquire({ seconds: 5, timedOut: true });
    const output = await metrics.render();
    expect(output).toContain('lunedo_db_pool_acquire_seconds_count{service="api"} 2');
    expect(output).toContain('lunedo_db_pool_acquire_timeouts_total{service="api"} 1');
  });
});

describe("Lunedo metrics", () => {
  const snapshot = {
    databaseSizeBytes: 5_000_000,
    storage: { usedBytes: 800, totalBytes: 1000, ratio: 0.8, level: 1 },
    storageLevel: 1,
    backup: { lastSuccessAt: new Date("2026-10-21T03:00:00Z"), failures: 2, scheduled: true },
    mail: {
      failedAttempts: 7,
      failedMessages: 1,
      lastSuccessAt: new Date("2026-10-21T07:00:00Z"),
      lastFailureAt: null,
    },
    search: { pendingItems: 4, failingItems: 1 },
    collaborationReady: true,
    maintenance: true,
    updateAvailable: true,
  };

  it("exposes build info, logged errors and collaboration connections", async () => {
    const metrics = new Metrics("collab");
    metrics.observeBuild("1.4.2");
    metrics.countLoggedError({ type: "Request failed", code: "ECONNRESET" });
    metrics.countLoggedError({ type: "Request failed", code: null });
    metrics.observeCollaboration(() => ({ connections: 3, documents: 2 }));
    const output = await metrics.render();
    expect(output).toContain('lunedo_build_info{version="1.4.2",service="collab"} 1');
    expect(output).toContain('lunedo_log_errors_total{type="Request failed",service="collab"} 2');
    expect(output).toContain('lunedo_collab_connections{service="collab"} 3');
    expect(output).toContain('lunedo_collab_documents{service="collab"} 2');
  });

  it("exposes the instance values only Lunedo knows", async () => {
    const metrics = new Metrics("api");
    metrics.observeInstance(async () => snapshot);
    const output = await metrics.render();
    for (const line of [
      'lunedo_database_size_bytes{service="api"} 5000000',
      'lunedo_storage_used_bytes{service="api"} 800',
      'lunedo_storage_size_bytes{service="api"} 1000',
      'lunedo_storage_usage_ratio{service="api"} 0.8',
      'lunedo_storage_level{service="api"} 1',
      'lunedo_backup_last_success_timestamp_seconds{service="api"} 1792551600',
      'lunedo_backup_failures_total{service="api"} 2',
      'lunedo_backup_scheduled{service="api"} 1',
      'lunedo_mail_delivery_failures_total{service="api"} 7',
      'lunedo_mail_undelivered_total{service="api"} 1',
      'lunedo_mail_last_success_timestamp_seconds{service="api"} 1792566000',
      'lunedo_search_pending_items{service="api"} 4',
      'lunedo_search_failing_items{service="api"} 1',
      'lunedo_collab_up{service="api"} 1',
      'lunedo_maintenance_mode{service="api"} 1',
      'lunedo_update_available{service="api"} 1',
    ]) {
      expect(output).toContain(line);
    }
    expect(output).not.toMatch(/^lunedo_mail_last_failure_timestamp_seconds\{/m);
  });

  it("leaves out values that are not known", async () => {
    const metrics = new Metrics("api");
    metrics.observeInstance(async () => ({
      ...snapshot,
      storage: null,
      backup: { lastSuccessAt: null, failures: 0, scheduled: false },
      collaborationReady: null,
      updateAvailable: null,
    }));
    const output = await metrics.render();
    expect(output).toContain('lunedo_storage_level{service="api"} 1');
    for (const name of [
      "lunedo_storage_used_bytes",
      "lunedo_backup_last_success_timestamp_seconds",
      "lunedo_collab_up",
      "lunedo_update_available",
    ]) {
      expect(output).not.toMatch(new RegExp(`^${name}{`, "m"));
    }
  });
});
