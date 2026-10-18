export const SNIFF_BYTES = 64 * 1024;

export type PreviewKind =
  | "image"
  | "pdf"
  | "video"
  | "audio"
  | "text"
  | "code"
  | "markdown"
  | "csv"
  | "svg"
  | "word"
  | "excel"
  | "none";

export interface DetectedType {
  contentType: string;
}

const OCTET_STREAM: DetectedType = { contentType: "application/octet-stream" };

function startsWith(bytes: Buffer, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Buffer, offset: number, length: number): string {
  return bytes.subarray(offset, offset + length).toString("latin1");
}

function binary(head: Buffer): DetectedType | null {
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { contentType: "image/png" };
  }
  if (startsWith(head, [0xff, 0xd8, 0xff])) return { contentType: "image/jpeg" };
  if (ascii(head, 0, 6) === "GIF87a" || ascii(head, 0, 6) === "GIF89a") {
    return { contentType: "image/gif" };
  }
  if (startsWith(head, [0x49, 0x49, 0x2a, 0x00]) || startsWith(head, [0x4d, 0x4d, 0x00, 0x2a])) {
    return { contentType: "image/tiff" };
  }
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WEBP") {
    return { contentType: "image/webp" };
  }
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WAVE") {
    return { contentType: "audio/wav" };
  }
  if (ascii(head, 4, 4) === "ftyp") {
    const brand = ascii(head, 8, 4);
    if (brand === "avif" || brand === "avis") return { contentType: "image/avif" };
    if (["heic", "heix", "heim", "heis", "hevc", "hevx"].includes(brand))
      return { contentType: "image/heic" };
    if (brand === "mif1" || brand === "msf1") return { contentType: "image/heif" };
    if (["M4A ", "M4B "].includes(brand)) return { contentType: "audio/mp4" };
    if (brand === "qt  ") return { contentType: "video/quicktime" };
    return { contentType: "video/mp4" };
  }
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) {
    const window = head.subarray(0, 64).toString("latin1");
    return window.includes("webm") ? { contentType: "video/webm" } : { contentType: "video/x-matroska" };
  }
  if (ascii(head, 0, 4) === "OggS") {
    const window = head.subarray(0, 128).toString("latin1");
    return window.includes("theora") || window.includes("\x80theora")
      ? { contentType: "video/ogg" }
      : { contentType: "audio/ogg" };
  }
  if (ascii(head, 0, 3) === "ID3" || startsWith(head, [0xff, 0xfb]) || startsWith(head, [0xff, 0xf3])) {
    return { contentType: "audio/mpeg" };
  }
  if (ascii(head, 0, 4) === "fLaC") return { contentType: "audio/flac" };
  if (ascii(head, 0, 5) === "%PDF-") return { contentType: "application/pdf" };
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) {
    const names = head.toString("latin1");
    if (names.includes("word/")) {
      return { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
    }
    if (names.includes("xl/")) {
      return { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
    }
    if (names.includes("ppt/")) {
      return { contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" };
    }
    return { contentType: "application/zip" };
  }
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return { contentType: "application/x-cfb" };
  }
  if (startsWith(head, [0x42, 0x4d]) && head.length > 14 && head.readUInt32LE(2) > 14) {
    return { contentType: "image/bmp" };
  }
  return null;
}

function decodeText(head: Buffer, truncated: boolean): string | null {
  if (head.includes(0)) return null;
  let bytes = head;
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) bytes = bytes.subarray(3);
  if (truncated) {
    let end = bytes.length;
    for (let back = 1; back <= 3 && end - back >= 0; back += 1) {
      const byte = bytes[end - back] ?? 0;
      if ((byte & 0xc0) === 0xc0) {
        end -= back;
        break;
      }
      if ((byte & 0x80) === 0) break;
    }
    bytes = bytes.subarray(0, end);
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const control = [...text].filter((character) => {
      const code = character.charCodeAt(0);
      return code < 32 && code !== 9 && code !== 10 && code !== 13 && code !== 12;
    }).length;
    return control > text.length / 100 ? null : text;
  } catch {
    return null;
  }
}

function extensionOf(name: string): string {
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(name);
  return match?.[1]?.toLowerCase() ?? "";
}

function textual(text: string, name: string): DetectedType {
  const start = text.trimStart().slice(0, 1024).toLowerCase();
  const svg =
    /<svg[\s>]/.test(start) &&
    (start.startsWith("<svg") || start.startsWith("<?xml") || start.startsWith("<!--"));
  if (svg) return { contentType: "image/svg+xml" };
  const markup =
    start.startsWith("<!doctype html") ||
    /<(html|head|body|script|iframe|object|embed|meta|link|style)[\s>/]/.test(text.toLowerCase());
  const extension = extensionOf(name);
  if (!markup && (extension === "md" || extension === "markdown")) {
    return { contentType: "text/markdown; charset=utf-8" };
  }
  if (!markup && (extension === "csv" || extension === "tsv"))
    return { contentType: "text/csv; charset=utf-8" };
  return { contentType: "text/plain; charset=utf-8" };
}

export function detectType(head: Buffer, options: { name: string; truncated: boolean }): DetectedType {
  const found = binary(head);
  if (found) return found;
  const text = decodeText(head, options.truncated);
  return text === null ? OCTET_STREAM : textual(text, options.name);
}

const PREVIEW_LIMITS: Partial<Record<PreviewKind, number>> = {
  text: 5 * 1024 * 1024,
  code: 5 * 1024 * 1024,
  markdown: 5 * 1024 * 1024,
  csv: 20 * 1024 * 1024,
  svg: 5 * 1024 * 1024,
  word: 50 * 1024 * 1024,
  excel: 50 * 1024 * 1024,
};

export function previewAllowed(kind: PreviewKind, size: number): boolean {
  if (kind === "none") return false;
  const limit = PREVIEW_LIMITS[kind];
  return limit === undefined || size <= limit;
}
