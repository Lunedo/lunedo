import type { FastifyRequest } from "fastify";

/** Header that browsers do not send on cross-site form posts and that requires CORS for scripts. */
export const CSRF_HEADER = "x-pagehall-request";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF protection for state-changing API requests: they need the custom header
 * and an `Origin` that matches the instance URL. Before the instance URL is configured during
 * setup, the origin must match the host the request was sent to.
 */
export function isCsrfSafe(request: FastifyRequest, instanceUrl: string): boolean {
  if (SAFE_METHODS.has(request.method)) return true;
  if (request.headers[CSRF_HEADER] !== "1") return false;
  const origin = request.headers.origin;
  if (!origin) return false;
  const expected = instanceUrl || `${request.protocol}://${request.host}`;
  return origin === expected;
}
