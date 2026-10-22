import type { AttachmentContent, ByteRange, DisplayVersionSize, FileService } from "@lunedo/server";
import { contentDisposition } from "@lunedo/server";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ProblemException } from "../http/problems.js";

export const FILE_CONTENT_SECURITY_POLICY =
  "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'";

export const imageSizeSchema = z
  .enum(["original", "display", "preview"])
  .default("original")
  .transform((value): DisplayVersionSize | undefined => (value === "original" ? undefined : value))
  .describe(
    "Size of an image. `display` sends a version whose longest edge is at most 2048 pixels, `preview` one of at most 400 pixels, both as WebP without metadata. The original is sent while no such version exists, for images that are already small enough, and for every other type. Images above 100 megapixels get no smaller version and answer `imageTooLarge`.",
  );

export const IMAGE_TOO_LARGE_DETAIL =
  "The image has more pixels than a smaller version can be made from; open it in full size instead";

export function sized(content: AttachmentContent | null): AttachmentContent {
  if (!content) throw new ProblemException("imageTooLarge", IMAGE_TOO_LARGE_DETAIL);
  return content;
}

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
  options: { inline: boolean; crossOrigin: boolean; staged?: boolean },
) {
  const etag = `"${content.versionId}${content.displaySize ? `-${content.displaySize}` : ""}"`;
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
    return files.read(content.fileId, range, { staged: options.staged ?? false });
  }
  reply.header("content-length", String(content.size));
  return files.read(content.fileId, undefined, { staged: options.staged ?? false });
}
