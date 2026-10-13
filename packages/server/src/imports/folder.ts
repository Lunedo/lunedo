import { constants, createReadStream, type Dirent } from "node:fs";
import { lstat, open, readdir, realpath, stat } from "node:fs/promises";
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
const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function notAvailable(): ImportError {
  return new ImportError("importFolderUnavailable", "The import folder does not exist or cannot be read.");
}

function fileMissing(): ImportError {
  return new ImportError(
    "importFileUnavailable",
    "The file is no longer in the import folder, is not a regular file, or cannot be read.",
  );
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

export function isSafeFolderName(name: string): boolean {
  return NAME.test(name) && name !== "." && name !== ".." && !name.startsWith(".");
}

export function isSafeFolderKey(key: string): boolean {
  return KEY.test(key);
}

export class ImportFolder {
  constructor(readonly root: string) {}

  pathFor(key: string): string {
    if (!isSafeFolderKey(key)) throw notAvailable();
    return path.join(this.root, key);
  }

  async #directory(key: string): Promise<string | null> {
    if (!isSafeFolderKey(key)) throw notAvailable();
    const root = await realpath(this.root).catch(() => {
      throw notAvailable();
    });
    const directory = path.join(root, key);
    if (path.dirname(directory) !== root) throw notAvailable();
    let stats: import("node:fs").Stats;
    try {
      stats = await lstat(directory);
    } catch (error) {
      if (isMissing(error)) return null;
      throw notAvailable();
    }
    if (!stats.isDirectory()) throw notAvailable();
    return directory;
  }

  async list(key: string): Promise<FolderFile[]> {
    const directory = await this.#directory(key);
    if (directory === null) return [];
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      throw notAvailable();
    }
    const files: FolderFile[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !isSafeFolderName(entry.name)) continue;
      try {
        const stats = await lstat(path.join(directory, entry.name));
        if (!stats.isFile()) continue;
        files.push({ name: entry.name, size: stats.size, modifiedAt: stats.mtime.toISOString() });
      } catch {}
      if (files.length >= MAX_LISTED) break;
    }
    return files.sort((a, b) => a.name.localeCompare(b.name));
  }

  async open(key: string, name: string): Promise<ByteSource & { readonly modifiedAt: string }> {
    if (!isSafeFolderName(name)) throw fileMissing();
    const directory = await this.#directory(key);
    if (directory === null) throw fileMissing();
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
    const resolved = await realpath(target).catch(() => null);
    const after = resolved === null ? null : await stat(resolved).catch(() => null);
    if (
      !stats.isFile() ||
      stats.ino !== before.ino ||
      stats.dev !== before.dev ||
      resolved !== target ||
      after?.ino !== stats.ino ||
      after.dev !== stats.dev
    ) {
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
