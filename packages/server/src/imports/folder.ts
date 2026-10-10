import { constants, createReadStream } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { ImportError } from "./errors.js";
import type { ByteSource } from "./formats/bytes.js";

export interface FolderFile {
  readonly name: string;
  readonly size: number;
  readonly modifiedAt: string;
}

const MAX_LISTED = 500;
const NAME = /^[^/\\\0]{1,255}$/;

function notAvailable(): ImportError {
  return new ImportError("importFolderUnavailable", "The import folder does not exist or cannot be read.");
}

function fileMissing(): ImportError {
  return new ImportError(
    "importFileUnavailable",
    "The file is no longer in the import folder, is not a regular file, or cannot be read.",
  );
}

export function isSafeFolderName(name: string): boolean {
  return NAME.test(name) && name !== "." && name !== ".." && !name.startsWith(".");
}

export class ImportFolder {
  constructor(readonly directory: string) {}

  async list(): Promise<FolderFile[]> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(this.directory, { withFileTypes: true });
    } catch {
      throw notAvailable();
    }
    const files: FolderFile[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !isSafeFolderName(entry.name)) continue;
      try {
        const stats = await lstat(path.join(this.directory, entry.name));
        if (!stats.isFile()) continue;
        files.push({ name: entry.name, size: stats.size, modifiedAt: stats.mtime.toISOString() });
      } catch {}
      if (files.length >= MAX_LISTED) break;
    }
    return files.sort((a, b) => a.name.localeCompare(b.name));
  }

  async open(name: string): Promise<ByteSource & { readonly modifiedAt: string }> {
    if (!isSafeFolderName(name)) throw fileMissing();
    const directory = await realpath(this.directory).catch(() => {
      throw notAvailable();
    });
    const target = path.join(directory, name);
    if (path.dirname(target) !== directory) throw fileMissing();
    const before = await lstat(target).catch(() => {
      throw fileMissing();
    });
    if (!before.isFile()) throw fileMissing();
    const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(() => {
      throw fileMissing();
    });
    const stats = await handle.stat();
    if (!stats.isFile() || stats.ino !== before.ino || stats.dev !== before.dev) {
      await handle.close();
      throw fileMissing();
    }
    return {
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      async read(start, end): Promise<Readable> {
        return createReadStream("", { fd: handle.fd, start, end: end - 1, autoClose: false });
      },
      async close() {
        await handle.close();
      },
    };
  }
}
