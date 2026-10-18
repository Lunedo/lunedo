import { Readable } from "node:stream";
import yauzl from "yauzl";
import yazl from "yazl";
import {
  FILE_PATH,
  MAX_FILES_PER_UPLOAD,
  TEMPLATE_ENTRY_MAX_BYTES,
  TEMPLATE_MANIFEST,
  TEMPLATE_MANIFEST_MAX_BYTES,
  TEMPLATE_UPLOAD_MAX_BYTES,
  TemplateFileError,
} from "./format.js";

export interface TemplateArchive {
  manifest: Buffer;
  files: Map<string, Buffer>;
}

const UNIX_HOST = 3;
const FILE_TYPE_MASK = 0o170000;
const SYMBOLIC_LINK = 0o120000;
const REGULAR_FILE = 0o100000;
const STORED = 0;
const DEFLATED = 8;
const MAX_RATIO = 100;
const RATIO_THRESHOLD_BYTES = 64 * 1024;
const FIXED_TIME = new Date(Date.UTC(2000, 0, 1));
const MAX_MB = (bytes: number) => `${bytes / (1024 * 1024)} MB`;

function rejected(code: string, message: string): TemplateFileError {
  return new TemplateFileError(code, message);
}

export function isZip(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50;
}

function entryName(entry: yauzl.Entry): string {
  const raw = yauzl.getFileNameLowLevel(
    entry.generalPurposeBitFlag,
    entry.fileNameRaw ?? Buffer.from(entry.fileName),
    entry.extraFields,
    false,
  );
  if (raw.startsWith("/") || raw.startsWith("\\") || /^[A-Za-z]:/.test(raw)) {
    throw rejected(
      "unsafeTemplateArchive",
      `The archive contains a file with an absolute path: ${raw.slice(0, 200)}`,
    );
  }
  if (raw.split(/[/\\]/).some((segment) => segment === "..")) {
    throw rejected(
      "unsafeTemplateArchive",
      `The archive contains a path that leaves the archive: ${raw.slice(0, 200)}`,
    );
  }
  return raw;
}

function fileType(entry: yauzl.Entry): number | null {
  if (entry.versionMadeBy >> 8 !== UNIX_HOST) return null;
  return (entry.externalFileAttributes >>> 16) & FILE_TYPE_MASK;
}

async function readEntry(zip: yauzl.ZipFile, entry: yauzl.Entry, limit: number, total: { bytes: number }) {
  const stream = await zip.openReadStreamPromise(entry);
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const part = chunk as Buffer;
    size += part.length;
    total.bytes += part.length;
    if (size > limit) {
      stream.destroy();
      throw rejected("templateArchiveTooLarge", `A file in the archive is larger than ${MAX_MB(limit)}.`);
    }
    if (total.bytes > TEMPLATE_UPLOAD_MAX_BYTES) {
      stream.destroy();
      throw rejected(
        "templateArchiveTooLarge",
        `The archive unpacks to more than ${MAX_MB(TEMPLATE_UPLOAD_MAX_BYTES)}.`,
      );
    }
    if (size > RATIO_THRESHOLD_BYTES && size > Math.max(entry.compressedSize, 1) * MAX_RATIO) {
      stream.destroy();
      throw rejected(
        "templateArchiveCompression",
        `A file in the archive is compressed more than ${MAX_RATIO} to 1, which template files never are.`,
      );
    }
    parts.push(part);
  }
  return Buffer.concat(parts);
}

export async function readTemplateArchive(bytes: Buffer): Promise<TemplateArchive> {
  let zip: yauzl.ZipFile;
  try {
    zip = await yauzl.fromBufferPromise(bytes, {
      lazyEntries: true,
      autoClose: false,
      decodeStrings: false,
      validateEntrySizes: true,
      strictFileNames: false,
    });
  } catch {
    throw rejected("invalidTemplateFile", "The file is not a readable ZIP archive.");
  }
  try {
    if (zip.entryCount > MAX_FILES_PER_UPLOAD + 2) {
      throw rejected(
        "tooManyTemplateFiles",
        `The archive has ${zip.entryCount} entries; a template file holds template.json and at most ${MAX_FILES_PER_UPLOAD} files.`,
      );
    }
    const seen = new Set<string>();
    const total = { bytes: 0 };
    let manifest: Buffer | null = null;
    const files = new Map<string, Buffer>();
    for await (const entry of zip.eachEntry()) {
      const name = entryName(entry);
      const type = fileType(entry);
      if (type === SYMBOLIC_LINK)
        throw rejected("unsafeTemplateArchive", `The archive contains a link: ${name}`);
      if (name === "files/" && (type === null || type !== REGULAR_FILE)) continue;
      if (type !== null && type !== REGULAR_FILE && type !== 0) {
        throw rejected("unsafeTemplateArchive", `The archive contains something other than a file: ${name}`);
      }
      if (seen.has(name.toLowerCase())) {
        throw rejected("unsafeTemplateArchive", `The archive contains ${name} twice.`);
      }
      seen.add(name.toLowerCase());
      if (/\.(zip|jar|7z|rar|gz|tgz|tar|xz|bz2)$/i.test(name)) {
        throw rejected(
          "nestedTemplateArchive",
          `The archive contains another archive: ${name.slice(0, 200)}`,
        );
      }
      if (name !== TEMPLATE_MANIFEST && !FILE_PATH.test(name)) {
        throw rejected(
          "unexpectedTemplateEntry",
          `The archive may only contain template.json and files/<sha256>.<extension>; it contains ${name.slice(0, 200)}.`,
        );
      }
      if (entry.isEncrypted())
        throw rejected("unsafeTemplateArchive", "The archive contains encrypted files.");
      if (entry.compressionMethod !== STORED && entry.compressionMethod !== DEFLATED) {
        throw rejected(
          "unsafeTemplateArchive",
          "The archive uses a compression method Pagehall cannot read.",
        );
      }
      if (files.size >= MAX_FILES_PER_UPLOAD && name !== TEMPLATE_MANIFEST) {
        throw rejected("tooManyTemplateFiles", `The archive holds more than ${MAX_FILES_PER_UPLOAD} files.`);
      }
      const limit = name === TEMPLATE_MANIFEST ? TEMPLATE_MANIFEST_MAX_BYTES : TEMPLATE_ENTRY_MAX_BYTES;
      const content = await readEntry(zip, entry, limit, total);
      if (isZip(content)) {
        throw rejected(
          "nestedTemplateArchive",
          `The archive contains another archive: ${name.slice(0, 200)}`,
        );
      }
      if (name === TEMPLATE_MANIFEST) manifest = content;
      else files.set(name, content);
    }
    if (!manifest) throw rejected("invalidTemplateFile", "The archive has no template.json at its root.");
    return { manifest, files };
  } finally {
    zip.close();
  }
}

export async function writeTemplateArchive(
  manifest: string,
  files: ReadonlyMap<string, Buffer>,
): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  const options = { mtime: FIXED_TIME, mode: 0o100644 };
  zip.addBuffer(Buffer.from(manifest, "utf8"), TEMPLATE_MANIFEST, options);
  for (const path of [...files.keys()].sort()) {
    const content = files.get(path);
    if (content) zip.addBuffer(content, path, options);
  }
  zip.end();
  const parts: Buffer[] = [];
  for await (const chunk of Readable.from(zip.outputStream)) parts.push(chunk as Buffer);
  return Buffer.concat(parts);
}
