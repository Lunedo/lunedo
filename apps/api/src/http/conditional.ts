import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

export function answerConditionally<T>(request: FastifyRequest, reply: FastifyReply, body: T): T | "" {
  const etag = `"${createHash("sha256").update(JSON.stringify(body)).digest("base64url").slice(0, 27)}"`;
  reply.header("etag", etag);
  reply.header("cache-control", "private, no-cache");
  const sent = request.headers["if-none-match"];
  if (
    typeof sent === "string" &&
    sent.split(",").some((value) => value.trim().replace(/^W\//, "") === etag)
  ) {
    reply.status(304);
    return "";
  }
  return body;
}
