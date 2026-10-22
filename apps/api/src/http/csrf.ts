import type { FastifyRequest } from "fastify";

export const CSRF_HEADER = "x-lunedo-request";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function ownOrigin(request: FastifyRequest): string {
  return `${request.protocol}://${request.host}`;
}

export function changesState(request: FastifyRequest): boolean {
  return !SAFE_METHODS.has(request.method);
}

export function isCsrfSafe(request: FastifyRequest, allowedOrigins: readonly string[]): boolean {
  if (!changesState(request)) return true;
  if (request.headers[CSRF_HEADER] !== "1") return false;
  const origin = request.headers.origin;
  return origin !== undefined && allowedOrigins.includes(origin);
}
