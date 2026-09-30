import type { IncomingMessage, ServerResponse } from "node:http";
import { type HealthCheck, type HealthReport, runHealthChecks } from "../health.js";
import type { Logger } from "./logger.js";

export const healthPaths = { live: "/health/live", ready: "/health/ready" } as const;

function send(response: ServerResponse, report: HealthReport): void {
  response.writeHead(report.status === "ok" ? 200 : 503, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(report));
}

/**
 * Answers the health endpoints on a plain Node HTTP server.
 * Returns false when the request is not a health request.
 */
export async function handleHealthRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: { ready: Record<string, HealthCheck>; logger: Logger },
): Promise<boolean> {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const path = new URL(request.url ?? "/", "http://localhost").pathname;

  if (path === healthPaths.live) {
    send(response, { status: "ok", checks: {} });
    return true;
  }
  if (path === healthPaths.ready) {
    const report = await runHealthChecks(options.ready, {
      onFailure: (check, error) => options.logger.warn({ check, err: error }, "Health check failed"),
    });
    send(response, report);
    return true;
  }
  return false;
}
