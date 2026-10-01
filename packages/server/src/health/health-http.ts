import type { IncomingMessage, ServerResponse } from "node:http";
import { type HealthCheck, type HealthReport, runHealthChecks } from "@pagehall/shared";
import type { Logger } from "../logging/logger.js";
import { isAuthorizedMetricsRequest, type Metrics } from "../observability/metrics.js";

export const operationsPaths = { live: "/health/live", ready: "/health/ready", metrics: "/metrics" } as const;

function send(response: ServerResponse, report: HealthReport): void {
  response.writeHead(report.status === "ok" ? 200 : 503, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(report));
}

export interface OperationsEndpoints {
  ready: Record<string, HealthCheck>;
  logger: Logger;
  metrics: Metrics;
  metricsToken: string;
}

/**
 * Answers the health and metrics endpoints on a plain Node HTTP server, as used by the
 * worker and the collaboration server. Returns false for any other request.
 */
export async function handleOperationsRequest(
  request: IncomingMessage,
  response: ServerResponse,
  endpoints: OperationsEndpoints,
): Promise<boolean> {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const path = new URL(request.url ?? "/", "http://localhost").pathname;

  if (path === operationsPaths.live) {
    send(response, { status: "ok", checks: {} });
    return true;
  }
  if (path === operationsPaths.ready) {
    const report = await runHealthChecks(endpoints.ready, {
      onFailure: (check, error) => endpoints.logger.warn({ check, err: error }, "Health check failed"),
    });
    send(response, report);
    return true;
  }
  if (path === operationsPaths.metrics) {
    if (!isAuthorizedMetricsRequest(request.headers.authorization, endpoints.metricsToken)) {
      response.writeHead(401, { "www-authenticate": "Bearer", "cache-control": "no-store" }).end();
      return true;
    }
    const body = await endpoints.metrics.render();
    response.writeHead(200, { "content-type": endpoints.metrics.contentType(), "cache-control": "no-store" });
    response.end(body);
    return true;
  }
  return false;
}
