import type { AttachmentContent, ByteRange, FileService } from "@pagehall/server";
import { contentDisposition } from "@pagehall/server";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ProblemException } from "../http/problems.js";

export const FILE_CONTENT_SECURITY_POLICY =
  "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'";

export function parseRange(header: string | undefined, size: number): ByteRange | null | "invalid" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return "invalid";
  if (size === 0) return "invalid";
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (suffix === 0) return "invalid";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (start > end || start >= size) return "invalid";
  return { start, end };
}

export async function sendAttachment(
  request: FastifyRequest,
  reply: FastifyReply,
  files: FileService,
  content: AttachmentContent,
  options: { inline: boolean; crossOrigin: boolean },
) {
  const etag = `"${content.digest || content.fileId}"`;
  reply.header("content-type", content.contentType);
  reply.header("x-content-type-options", "nosniff");
  reply.header("content-security-policy", FILE_CONTENT_SECURITY_POLICY);
  reply.header("cross-origin-resource-policy", options.crossOrigin ? "cross-origin" : "same-origin");
  reply.header("referrer-policy", "no-referrer");
  reply.header(
    "content-disposition",
    contentDisposition(options.inline && content.inline ? "inline" : "attachment", content.name),
  );
  reply.header("cache-control", "private, no-cache");
  reply.header("etag", etag);
  reply.header("accept-ranges", "bytes");
  if (request.headers["if-none-match"] === etag) {
    reply.status(304);
    return "";
  }
  const range = parseRange(request.headers.range, content.size);
  if (range === "invalid") {
    reply.header("content-range", `bytes */${content.size}`);
    throw new ProblemException("rangeNotSatisfiable", "The requested range lies outside the file");
  }
  if (range) {
    reply.status(206);
    reply.header("content-range", `bytes ${range.start}-${range.end}/${content.size}`);
    reply.header("content-length", String(range.end - range.start + 1));
    return files.read(content.fileId, range);
  }
  reply.header("content-length", String(content.size));
  return files.read(content.fileId);
}
