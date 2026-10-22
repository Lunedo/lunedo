import { createHash } from "node:crypto";
import { PassThrough, pipeline, type Readable } from "node:stream";
import yauzl from "yauzl";
import { ImportFormatError } from "../errors.js";
import { ByteLimit, type ByteSource } from "./bytes.js";

export interface ZipLimits {
  readonly maxEntries: number;
  readonly maxTotalBytes: number;
  readonly maxEntryBytes: number;
  readonly maxRatio: number;
  readonly ratioThresholdBytes: number;
  readonly maxNameBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 500_000,
  maxTotalBytes: 200 * 1024 ** 3,
  maxEntryBytes: 20 * 1024 ** 3,
  maxRatio: 200,
  ratioThresholdBytes: 1024 * 1024,
  maxNameBytes: 1024,
};

export type ZipProblem =
  | { readonly code: "duplicateEntry"; readonly name: string }
  | { readonly code: "skippedEntry"; readonly name: string; readonly reason: "directory" };

export interface ZipEntryLocation {
  readonly offset: number;
  readonly size: number;
  readonly compressedSize: number;
  readonly method: number;
  readonly flags: number;
  readonly crc32: number;
}

export interface ZipEntry {
  readonly index: number;
  readonly name: string;
  readonly size: number;
  readonly compressedSize: number;
  readonly location: ZipEntryLocation;
  open(): Promise<Readable>;
}

const UNIX_HOST = 3;
const FILE_TYPE_MASK = 0o170000;
const SYMBOLIC_LINK = 0o120000;
const STORED = 0;
const DEFLATED = 8;

class SourceReader extends yauzl.RandomAccessReader {
  constructor(private readonly source: ByteSource) {
    super();
  }

  override _readStreamForRange(start: number, end: number): Readable {
    const output = new PassThrough();
    this.source.read(start, end).then(
      (stream) => {
        stream.on("error", (error) => output.destroy(error));
        stream.pipe(output);
      },
      (error: unknown) => output.destroy(error as Error),
    );
    return output;
  }
}

function invalid(code: string, message: string): ImportFormatError {
  return new ImportFormatError(code, message);
}

export function normalizeEntryName(raw: string, limits: Pick<ZipLimits, "maxNameBytes">): string {
  if (Buffer.byteLength(raw, "utf8") > limits.maxNameBytes) {
    throw invalid("unsafeEntryName", "A file name in the archive is longer than the limit.");
  }
  if ([...raw].some((character) => (character.codePointAt(0) ?? 0) < 0x20)) {
    throw invalid("unsafeEntryName", "A file name in the archive contains control characters.");
  }
  const name = raw.replaceAll("\\", "/").replace(/^(?:\.\/)+/, "");
  if (name.startsWith("/")) throw invalid("unsafeEntryName", "A file in the archive has an absolute path.");
  if (/^[A-Za-z]:/.test(name)) throw invalid("unsafeEntryName", "A file in the archive has a drive letter.");
  const segments = name.split("/");
  const directory = name.endsWith("/");
  const parts = directory ? segments.slice(0, -1) : segments;
  for (const segment of parts) {
    if (segment === "..")
      throw invalid("unsafeEntryName", "A file in the archive points outside the archive.");
    if (segment === "." || segment === "") {
      throw invalid("unsafeEntryName", "A file in the archive has an empty or relative path segment.");
    }
  }
  return name;
}

function isSymbolicLink(entry: yauzl.Entry): boolean {
  const host = entry.versionMadeBy >> 8;
  if (host !== UNIX_HOST) return false;
  return ((entry.externalFileAttributes >>> 16) & FILE_TYPE_MASK) === SYMBOLIC_LINK;
}

function nameKey(name: string): string {
  return createHash("sha256").update(name).digest("base64");
}

function locationOf(entry: yauzl.Entry): ZipEntryLocation {
  return {
    offset: entry.relativeOffsetOfLocalHeader,
    size: entry.uncompressedSize,
    compressedSize: entry.compressedSize,
    method: entry.compressionMethod,
    flags: entry.generalPurposeBitFlag,
    crc32: entry.crc32,
  };
}

async function openLimited(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
  const stream = await zip.openReadStreamPromise(entry);
  const limit = new ByteLimit(
    entry.uncompressedSize,
    "archiveTooLarge",
    "A file in the archive is larger than its directory states.",
  );
  pipeline(stream, limit, () => {});
  return limit;
}

export class ZipArchive {
  readonly #source: ByteSource;
  readonly #limits: ZipLimits;

  private constructor(source: ByteSource, limits: ZipLimits) {
    this.#source = source;
    this.#limits = limits;
  }

  static async open(source: ByteSource, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Promise<ZipArchive> {
    const archive = new ZipArchive(source, limits);
    const zip = await archive.#openZip();
    zip.close();
    return archive;
  }

  async #openZip(): Promise<yauzl.ZipFile> {
    let zip: yauzl.ZipFile;
    try {
      zip = await yauzl.fromRandomAccessReaderPromise(new SourceReader(this.#source), this.#source.size, {
        lazyEntries: true,
        autoClose: false,
        decodeStrings: false,
        validateEntrySizes: true,
        strictFileNames: false,
      });
    } catch {
      throw invalid("notAnArchive", "The file is not a readable ZIP archive.");
    }
    if (zip.entryCount > this.#limits.maxEntries) {
      zip.close();
      throw invalid("tooManyEntries", `The archive has more than ${this.#limits.maxEntries} files.`);
    }
    return zip;
  }

  async openAt(location: ZipEntryLocation): Promise<Readable> {
    const limits = this.#limits;
    if (location.size > limits.maxEntryBytes) {
      throw invalid("archiveTooLarge", "A file in the archive is larger than the limit.");
    }
    if (location.method !== STORED && location.method !== DEFLATED) {
      throw invalid("unsupportedCompression", "The archive uses a compression method Lunedo cannot read.");
    }
    if (
      location.size > limits.ratioThresholdBytes &&
      location.size > Math.max(location.compressedSize, 1) * limits.maxRatio
    ) {
      throw invalid("compressionRatio", "A file in the archive is compressed more than real exports are.");
    }
    const zip = await this.#openZip();
    const entry = Object.assign(Object.create(yauzl.Entry.prototype) as yauzl.Entry, {
      relativeOffsetOfLocalHeader: location.offset,
      uncompressedSize: location.size,
      compressedSize: location.compressedSize,
      compressionMethod: location.method,
      generalPurposeBitFlag: location.flags,
      crc32: location.crc32,
    });
    if (entry.isEncrypted()) {
      zip.close();
      throw invalid("encryptedEntry", "The archive contains encrypted files.");
    }
    try {
      const stream = await openLimited(zip, entry);
      stream.once("close", () => zip.close());
      return stream;
    } catch (error) {
      zip.close();
      throw error;
    }
  }

  async check(
    onProblem: (problem: ZipProblem) => void = () => {},
  ): Promise<{ entries: number; bytes: number }> {
    let entries = 0;
    let bytes = 0;
    for await (const entry of this.entries(onProblem)) {
      entries += 1;
      bytes += entry.size;
    }
    return { entries, bytes };
  }

  async *entries(onProblem: (problem: ZipProblem) => void = () => {}, from = 0): AsyncGenerator<ZipEntry> {
    const limits = this.#limits;
    const current = await this.#openZip();
    try {
      const seen = new Set<string>();
      let total = 0;
      let index = -1;
      for await (const entry of current.eachEntry()) {
        index += 1;
        const raw = yauzl.getFileNameLowLevel(
          entry.generalPurposeBitFlag,
          entry.fileNameRaw ?? Buffer.from(entry.fileName),
          entry.extraFields,
          false,
        );
        const name = normalizeEntryName(raw, limits);
        if (isSymbolicLink(entry)) {
          throw invalid("unsafeEntryName", "The archive contains a symbolic link.");
        }
        if (name.endsWith("/")) {
          if (index >= from) onProblem({ code: "skippedEntry", name, reason: "directory" });
          continue;
        }
        if (entry.isEncrypted()) throw invalid("encryptedEntry", "The archive contains encrypted files.");
        if (entry.compressionMethod !== STORED && entry.compressionMethod !== DEFLATED) {
          throw invalid(
            "unsupportedCompression",
            "The archive uses a compression method Lunedo cannot read.",
          );
        }
        const key = nameKey(name);
        if (seen.has(key)) {
          if (index >= from) onProblem({ code: "duplicateEntry", name });
          continue;
        }
        seen.add(key);
        if (entry.uncompressedSize > limits.maxEntryBytes) {
          throw invalid("archiveTooLarge", "A file in the archive is larger than the limit.");
        }
        total += entry.uncompressedSize;
        if (total > limits.maxTotalBytes) {
          throw invalid("archiveTooLarge", "The archive expands to more than the limit.");
        }
        if (
          entry.uncompressedSize > limits.ratioThresholdBytes &&
          entry.uncompressedSize > Math.max(entry.compressedSize, 1) * limits.maxRatio
        ) {
          throw invalid(
            "compressionRatio",
            "A file in the archive is compressed more than real exports are.",
          );
        }
        if (index < from) continue;
        yield {
          index,
          name,
          size: entry.uncompressedSize,
          compressedSize: entry.compressedSize,
          location: locationOf(entry),
          open: () => openLimited(current, entry),
        };
      }
    } finally {
      current.close();
    }
  }
}
