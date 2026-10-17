import path from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

const SERVER_PREFIXES = ["/api/", "/health/", "/drawio/"];

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

export const DIAGRAM_CONTENT_SECURITY_POLICY = [
  "sandbox allow-scripts",
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src data: blob:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "frame-ancestors 'self'",
].join("; ");

export const DRAWIO_CONTENT_SECURITY_POLICY = [
  "sandbox allow-scripts allow-downloads",
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join("; ");

export function applicationContentSecurityPolicy(frameSources: readonly string[]): string {
  return `frame-src ${["'self'", ...frameSources].join(" ")}`;
}

function isDrawioFile(root: string, filePath: string): boolean {
  return path.relative(root, filePath).split(path.sep)[0] === "drawio";
}

/**
 * Serves the built web client. Unknown paths outside the API return the
 * single-page application so that client-side routes can be reloaded.
 */
export async function registerWebClient(
  fastify: FastifyInstance,
  root: string,
  frameSources: () => Promise<readonly string[]>,
): Promise<void> {
  let policy = applicationContentSecurityPolicy([]);
  const currentPolicy = async () => {
    try {
      policy = applicationContentSecurityPolicy(await frameSources());
    } catch (error) {
      fastify.log.warn({ err: error }, "The embed allowlist could not be read for the frame policy");
      policy = applicationContentSecurityPolicy([]);
    }
    return policy;
  };
  await fastify.register(fastifyStatic, {
    root: path.resolve(root),
    wildcard: false,
    index: false,
    immutable: true,
    maxAge: "1y",
    setHeaders: (response, filePath) => {
      if (isDrawioFile(path.resolve(root), filePath)) {
        response.header("access-control-allow-origin", "*");
        response.header("x-content-type-options", "nosniff");
        response.header("referrer-policy", "no-referrer");
        if (filePath.endsWith(".html"))
          response.header("content-security-policy", DRAWIO_CONTENT_SECURITY_POLICY);
        return;
      }
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        response.header("access-control-allow-origin", "*");
      } else {
        response.header("cache-control", "no-cache");
      }
      if (path.basename(filePath) === "index.html") response.header("content-security-policy", policy);
      if (path.basename(filePath) === "print.html") {
        response.header("content-security-policy", PRINT_CONTENT_SECURITY_POLICY);
        response.header("x-content-type-options", "nosniff");
        response.header("referrer-policy", "no-referrer");
      }
      if (path.basename(filePath) === "diagram.html") {
        response.header("content-security-policy", DIAGRAM_CONTENT_SECURITY_POLICY);
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

  fastify.get("/*", async (request, reply) => {
    const pathname = request.url.split("?")[0] ?? "/";
    if (SERVER_PREFIXES.some((prefix) => `${pathname}/`.startsWith(prefix))) {
      return reply.callNotFound();
    }
    await currentPolicy();
    return reply.header("cache-control", "no-cache").sendFile("index.html");
  });
}
