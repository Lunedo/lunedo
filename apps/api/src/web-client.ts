import path from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

const SERVER_PREFIXES = ["/api/", "/health/"];

export const PREVIEW_CONTENT_SECURITY_POLICY = [
  "sandbox allow-scripts",
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src blob: data:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "frame-ancestors 'self'",
].join("; ");

export const PRINT_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "frame-ancestors 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/**
 * Serves the built web client. Unknown paths outside the API return the
 * single-page application so that client-side routes can be reloaded.
 */
export async function registerWebClient(fastify: FastifyInstance, root: string): Promise<void> {
  await fastify.register(fastifyStatic, {
    root: path.resolve(root),
    wildcard: false,
    index: false,
    immutable: true,
    maxAge: "1y",
    setHeaders: (response, filePath) => {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        response.header("access-control-allow-origin", "*");
      } else {
        response.header("cache-control", "no-cache");
      }
      if (path.basename(filePath) === "print.html") {
        response.header("content-security-policy", PRINT_CONTENT_SECURITY_POLICY);
        response.header("x-content-type-options", "nosniff");
        response.header("referrer-policy", "no-referrer");
      }
      if (path.basename(filePath) === "preview.html") {
        response.header("content-security-policy", PREVIEW_CONTENT_SECURITY_POLICY);
        response.header("x-content-type-options", "nosniff");
        response.header("referrer-policy", "no-referrer");
      }
    },
  });

  fastify.get("/*", (request, reply) => {
    const pathname = request.url.split("?")[0] ?? "/";
    if (SERVER_PREFIXES.some((prefix) => `${pathname}/`.startsWith(prefix))) {
      return reply.callNotFound();
    }
    return reply.header("cache-control", "no-cache").sendFile("index.html");
  });
}
