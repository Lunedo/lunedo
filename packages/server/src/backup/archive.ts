import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, type Dirent } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import tar from "tar-stream";
import { z } from "zod";
import type { SecretKey } from "../crypto/key-ring.js";
import { backupStreamKeys, createDecryptStream, createEncryptStream } from "../crypto/stream.js";
import type { Logger } from "../logging/logger.js";
import type { DatabaseArchiver } from "./postgres.js";

export const BACKUP_FORMAT_VERSION = 1;
const DATABASE_ENTRY = "database.dump";
const FILES_PREFIX = "files/";
const CONFIG_PREFIX = "config/";
const MANIFEST_ENTRY = "manifest.json";

const manifestSchema = z.object({
  format: z.literal(BACKUP_FORMAT_VERSION),
  pagehallVersion: z.string(),
  schemaVersion: z.string(),
  createdAt: z.iso.datetime(),
  entries: z.array(
    z.object({
      path: z.string(),
      size: z.number().int().nonnegative(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  ),
});

export type BackupManifest = z.infer<typeof manifestSchema>;

export class BackupError extends Error {
  override name = "BackupError";
}

/** Rejects absolute paths, parent references and anything else that could escape a directory. */
export function isSafeRelativePath(name: string): boolean {
  if (name === "" || name.startsWith("/") || name.includes("\\") || name.includes("\0")) return false;
  return name.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function isKnownEntry(name: string): boolean {
  if (name === DATABASE_ENTRY) return true;
  for (const prefix of [FILES_PREFIX, CONFIG_PREFIX]) {
    if (name.startsWith(prefix)) return isSafeRelativePath(name.slice(prefix.length));
  }
  return false;
}

class Hasher extends Transform {
  readonly hash = createHash("sha256");
  size = 0;

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: () => void) {
    this.hash.update(chunk);
    this.size += chunk.length;
    this.push(chunk);
    callback();
  }

  digest(): string {
    return this.hash.digest("hex");
  }
}

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (dir: string) => {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) files.push(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  await visit(root);
  return files.sort();
}

async function isEmptyDirectory(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).length === 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

export interface CreateBackupOptions {
  output: string;
  backupKey: SecretKey;
  database: DatabaseArchiver;
  filesDir: string;
  /** Configuration files to include, by name. They must not contain the master or backup key. */
  config: Record<string, string>;
  pagehallVersion: string;
  schemaVersion: string;
  logger: Logger;
}

/**
 * Writes an encrypted backup of the database, the file store and the configuration.
 * The archive is streamed; only the database dump is staged on disk, because tar
 * needs its size in advance.
 */
export async function createBackup(options: CreateBackupOptions): Promise<BackupManifest> {
  const partial = `${options.output}.${randomUUID()}.partial`;
  const staged = `${options.output}.${randomUUID()}.dump`;
  const entries: BackupManifest["entries"] = [];
  try {
    await pipeline(options.database.dump(), createWriteStream(staged, { mode: 0o600 }));

    const pack = tar.pack();
    const written = pipeline(
      pack,
      createGzip(),
      createEncryptStream(backupStreamKeys(options.backupKey)),
      createWriteStream(partial, { mode: 0o600 }),
    );

    const add = async (name: string, source: Readable, size: number) => {
      const hasher = new Hasher();
      const entry = pack.entry({ name, size, mode: 0o600, mtime: new Date(0) });
      await pipeline(source, hasher, entry);
      entries.push({ path: name, size: hasher.size, sha256: hasher.digest() });
    };

    await add(DATABASE_ENTRY, createReadStream(staged), (await stat(staged)).size);
    for (const file of await listFiles(options.filesDir)) {
      const full = path.join(options.filesDir, ...file.split("/"));
      await add(`${FILES_PREFIX}${file}`, createReadStream(full), (await stat(full)).size);
    }
    for (const [name, content] of Object.entries(options.config)) {
      if (!isSafeRelativePath(name)) throw new BackupError(`Invalid configuration entry name ${name}`);
      const bytes = Buffer.from(content, "utf8");
      await add(`${CONFIG_PREFIX}${name}`, Readable.from([bytes]), bytes.length);
    }

    const manifest: BackupManifest = {
      format: BACKUP_FORMAT_VERSION,
      pagehallVersion: options.pagehallVersion,
      schemaVersion: options.schemaVersion,
      createdAt: new Date().toISOString(),
      entries,
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
    pack.entry(
      { name: MANIFEST_ENTRY, size: manifestBytes.length, mode: 0o600, mtime: new Date(0) },
      manifestBytes,
    );
    pack.finalize();
    await written;
    await rename(partial, options.output);
    options.logger.info({ entries: entries.length, schemaVersion: options.schemaVersion }, "Backup created");
    return manifest;
  } finally {
    await rm(staged, { force: true });
    await rm(partial, { force: true });
  }
}

type EntryHandler = (name: string, content: Readable) => Promise<void>;

/** Decrypts and reads an archive, checks every entry against the manifest and returns it. */
async function readArchive(
  input: string,
  backupKey: SecretKey,
  handle: EntryHandler,
): Promise<BackupManifest> {
  const extract = tar.extract();
  const reading = pipeline(
    createReadStream(input),
    createDecryptStream(backupStreamKeys(backupKey)),
    createGunzip(),
    extract,
  );
  const seen: BackupManifest["entries"] = [];
  let manifest: BackupManifest | undefined;
  try {
    for await (const entry of extract) {
      const name = entry.header.name;
      if (manifest) throw new BackupError("The backup contains data after its manifest");
      if (entry.header.type !== "file") throw new BackupError(`Unexpected entry type for ${name}`);
      if (name === MANIFEST_ENTRY) {
        const chunks: Buffer[] = [];
        for await (const chunk of entry) chunks.push(chunk as Buffer);
        const parsed = manifestSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        if (!parsed.success) throw new BackupError("The backup manifest is invalid");
        manifest = parsed.data;
        continue;
      }
      if (!isKnownEntry(name)) throw new BackupError(`Unexpected entry ${name} in the backup`);
      const hasher = new Hasher();
      await handle(name, entry.pipe(hasher));
      seen.push({ path: name, size: hasher.size, sha256: hasher.digest() });
    }
    await reading;
  } catch (error) {
    reading.catch(() => {});
    throw error;
  }
  if (!manifest) throw new BackupError("The backup has no manifest; it may be truncated");
  const expected = new Map(manifest.entries.map((entry) => [entry.path, entry]));
  if (expected.size !== manifest.entries.length || seen.length !== manifest.entries.length) {
    throw new BackupError("The backup entries do not match the manifest");
  }
  for (const entry of seen) {
    const listed = expected.get(entry.path);
    if (!listed || listed.size !== entry.size || listed.sha256 !== entry.sha256) {
      throw new BackupError(`Checksum mismatch for ${entry.path}`);
    }
  }
  return manifest;
}

async function drain(content: Readable): Promise<void> {
  for await (const _chunk of content);
}

/** Checks decryption, the manifest and all checksums without restoring anything. */
export async function verifyBackup(options: {
  input: string;
  backupKey: SecretKey;
}): Promise<BackupManifest> {
  return readArchive(options.input, options.backupKey, (_name, content) => drain(content));
}

export interface RestoreBackupOptions {
  input: string;
  backupKey: SecretKey;
  database: DatabaseArchiver;
  filesDir: string;
  /** Where configuration files from the backup are written; skipped when not set. */
  configDir?: string | undefined;
  /** Overwrite a database or file store that is not empty. */
  force: boolean;
  /** Schema versions this Pagehall version knows; newer backups are refused. */
  knownSchemaVersions: readonly string[];
  logger: Logger;
}

/**
 * Restores a backup into an empty instance. The whole backup is verified first; a
 * non-empty database or file store is only overwritten with `force`.
 */
export async function restoreBackup(options: RestoreBackupOptions): Promise<BackupManifest> {
  const manifest = await verifyBackup(options);
  if (!options.knownSchemaVersions.includes(manifest.schemaVersion)) {
    throw new BackupError(
      `The backup has schema version ${manifest.schemaVersion}, which this Pagehall version does not know; restore it with the version that created it or a newer one`,
    );
  }

  const databaseEmpty = await options.database.isEmpty();
  const filesEmpty = await isEmptyDirectory(options.filesDir);
  if (!options.force && (!databaseEmpty || !filesEmpty)) {
    throw new BackupError(
      `Restore refused: the ${!databaseEmpty ? "database" : "file store"} is not empty. Use --force to overwrite it`,
    );
  }
  if (!databaseEmpty) await options.database.clear();
  if (!filesEmpty) {
    for (const entry of await readdir(options.filesDir)) {
      await rm(path.join(options.filesDir, entry), { recursive: true, force: true });
    }
  }
  await mkdir(options.filesDir, { recursive: true });

  await readArchive(options.input, options.backupKey, async (name, content) => {
    if (name === DATABASE_ENTRY) {
      await options.database.restore(content);
    } else if (name.startsWith(FILES_PREFIX)) {
      const target = path.join(options.filesDir, ...name.slice(FILES_PREFIX.length).split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await pipeline(content, createWriteStream(target, { mode: 0o600 }));
    } else if (name.startsWith(CONFIG_PREFIX) && options.configDir) {
      const target = path.join(options.configDir, ...name.slice(CONFIG_PREFIX.length).split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await pipeline(content, createWriteStream(target, { mode: 0o600 }));
    } else {
      await drain(content);
    }
  });
  options.logger.info(
    { schemaVersion: manifest.schemaVersion, entries: manifest.entries.length },
    "Backup restored",
  );
  return manifest;
}
