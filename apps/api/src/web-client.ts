import path from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

const SERVER_PREFIXES = ["/api/", "/health/"];

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
      if (!filePath.includes(`${path.sep}assets${path.sep}`)) {
        response.header("cache-control", "no-cache");
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
