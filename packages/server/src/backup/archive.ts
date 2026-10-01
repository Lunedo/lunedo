import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, type Dirent } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import tar from "tar-stream";
import { z } from "zod";
import { type KeyRing, keyFingerprint } from "../crypto/key-ring.js";
import {
  backupKeyFingerprint,
  backupStreamKeys,
  createDecryptStream,
  createEncryptStream,
  DEFAULT_CHUNK_SIZE,
} from "../crypto/stream.js";
import type { Logger } from "../logging/logger.js";
import type { DatabaseArchiver } from "./postgres.js";

/*
 * Backup file layout:
 *
 *   0   magic "PHBK"            4 bytes
 *   4   format version           uint16, big endian
 *   6   header length n          uint32, big endian
 *   10  header                   n bytes of UTF-8 JSON, not encrypted
 *   10+n encrypted stream        stream format of the crypto module under the backup key;
 *                                every chunk authenticates bytes 0 to 10+n
 *
 * Inside the stream: a gzip-compressed tar archive whose last entry is manifest.json.
 */
export const BACKUP_FORMAT_VERSION = 1;
const MAGIC = Buffer.from("PHBK");
const PREFIX_LENGTH = 10;
const MAX_HEADER_LENGTH = 64 * 1024;
const CIPHER = "AES-256-GCM";
const DATABASE_ENTRY = "database.dump";
const FILES_PREFIX = "files/";
const CONFIG_PREFIX = "config/";
const MANIFEST_ENTRY = "manifest.json";

const headerSchema = z.object({
  pagehallVersion: z.string(),
  schemaVersion: z.string(),
  createdAt: z.iso.datetime(),
  key: z.object({
    version: z.int().positive(),
    fingerprint: z.string().regex(/^[0-9a-f]{16}$/),
  }),
  /** Master key versions that encrypted data in the backup needs, by fingerprint. */
  masterKeys: z.array(
    z.object({ version: z.int().positive(), fingerprint: z.string().regex(/^[0-9a-f]{16}$/) }),
  ),
  cipher: z.string(),
  chunkSize: z.int().positive(),
});

export type BackupHeader = z.infer<typeof headerSchema>;

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

const ENTRY_TYPE_NAMES: Record<string, string> = {
  symlink: "a symbolic link",
  link: "a hard link",
  "character-device": "a device file",
  "block-device": "a device file",
  fifo: "a named pipe",
  directory: "a directory",
};

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

export function encodeBackupHeader(header: BackupHeader, formatVersion = BACKUP_FORMAT_VERSION): Buffer {
  const json = Buffer.from(JSON.stringify(header), "utf8");
  const prefix = Buffer.alloc(PREFIX_LENGTH);
  MAGIC.copy(prefix, 0);
  prefix.writeUInt16BE(formatVersion, 4);
  prefix.writeUInt32BE(json.length, 6);
  return Buffer.concat([prefix, json]);
}

/** Reads the unencrypted header without touching the rest of the file. */
export async function readBackupHeader(input: string): Promise<{ header: BackupHeader; bytes: Buffer }> {
  const file = await open(input, "r");
  try {
    const prefix = Buffer.alloc(PREFIX_LENGTH);
    const { bytesRead } = await file.read(prefix, 0, PREFIX_LENGTH, 0);
    if (bytesRead < PREFIX_LENGTH || !prefix.subarray(0, 4).equals(MAGIC)) {
      throw new BackupError(`${input} is not a Pagehall backup`);
    }
    const formatVersion = prefix.readUInt16BE(4);
    if (formatVersion !== BACKUP_FORMAT_VERSION) {
      throw new BackupError(
        `The backup uses format version ${formatVersion}, which this Pagehall version cannot read. Restore it with the Pagehall version that created it or a newer one.`,
      );
    }
    const length = prefix.readUInt32BE(6);
    if (length > MAX_HEADER_LENGTH) throw new BackupError("The backup header is damaged");
    const json = Buffer.alloc(length);
    const read = await file.read(json, 0, length, PREFIX_LENGTH);
    if (read.bytesRead < length) throw new BackupError("The backup header is damaged");
    let parsed: unknown;
    try {
      parsed = JSON.parse(json.toString("utf8"));
    } catch {
      throw new BackupError("The backup header is damaged");
    }
    const header = headerSchema.safeParse(parsed);
    if (!header.success) throw new BackupError("The backup header is damaged");
    return { header: header.data, bytes: Buffer.concat([prefix, json]) };
  } finally {
    await file.close();
  }
}

/**
 * Checks a header against this installation before any data is read. Each failure tells
 * the administrator what to do.
 */
export function checkBackupHeader(
  header: BackupHeader,
  options: {
    backupKeys: KeyRing;
    knownSchemaVersions: readonly string[];
    /** Checked when given; `null` means this instance has no master key ring. */
    masterKeys?: KeyRing | null;
  },
): void {
  if (header.cipher !== CIPHER) {
    throw new BackupError(
      `The backup is encrypted with ${header.cipher}, which this Pagehall version does not support. Restore it with the Pagehall version that created it or a newer one.`,
    );
  }
  if (!options.knownSchemaVersions.includes(header.schemaVersion)) {
    throw new BackupError(
      `The backup was created by Pagehall ${header.pagehallVersion} with schema version ${header.schemaVersion}, which is newer than this Pagehall version supports. Update Pagehall to version ${header.pagehallVersion} or newer and run the command again.`,
    );
  }
  const { version, fingerprint } = header.key;
  if (!options.backupKeys.has(version)) {
    throw new BackupError(
      `The backup is encrypted with backup key version ${version} (fingerprint ${fingerprint}), which is not configured. Add this key version to PAGEHALL_BACKUP_KEY or to the backup-keys file in the secrets directory and run the command again.`,
    );
  }
  const configured = backupKeyFingerprint(options.backupKeys.get(version)).toString("hex");
  if (configured !== fingerprint) {
    throw new BackupError(
      `The backup is encrypted with backup key version ${version} (fingerprint ${fingerprint}), but the configured key version ${version} has fingerprint ${configured}. Configure the key the backup was created with.`,
    );
  }
  if (options.masterKeys === undefined) return;
  const copyKeys =
    "Copy the master key ring of the instance the backup comes from (master-keys in its secrets directory, or PAGEHALL_MASTER_KEYS) to this instance and run the restore again.";
  for (const required of header.masterKeys) {
    if (!options.masterKeys?.has(required.version)) {
      throw new BackupError(
        `The backup contains data encrypted with master key version ${required.version} (fingerprint ${required.fingerprint}), which is not available on this instance. ${copyKeys}`,
      );
    }
    const available = keyFingerprint("master", options.masterKeys.get(required.version));
    if (available !== required.fingerprint) {
      throw new BackupError(
        `The backup contains data encrypted with master key version ${required.version} (fingerprint ${required.fingerprint}), but master key version ${required.version} of this instance has fingerprint ${available}. ${copyKeys}`,
      );
    }
  }
}

export interface BackupArchiveWriter {
  header: BackupHeader;
  pack: tar.Pack;
  /** Resolves when the archive has been finalized and written. */
  finished: Promise<void>;
}

/** Writes the header and opens the encrypted archive behind it. Callers add entries and finalize `pack`. */
export function openBackupArchive(options: {
  output: string;
  backupKeys: KeyRing;
  masterKeys: BackupHeader["masterKeys"];
  pagehallVersion: string;
  schemaVersion: string;
  chunkSize?: number;
}): BackupArchiveWriter {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const header: BackupHeader = {
    pagehallVersion: options.pagehallVersion,
    schemaVersion: options.schemaVersion,
    createdAt: new Date().toISOString(),
    key: {
      version: options.backupKeys.currentVersion,
      fingerprint: backupKeyFingerprint(options.backupKeys.current()).toString("hex"),
    },
    masterKeys: options.masterKeys,
    cipher: CIPHER,
    chunkSize,
  };
  const headerBytes = encodeBackupHeader(header);
  const pack = tar.pack();
  const output = createWriteStream(options.output, { mode: 0o600 });
  output.write(headerBytes);
  const finished = pipeline(
    pack,
    createGzip(),
    createEncryptStream(backupStreamKeys(options.backupKeys), { chunkSize, associatedData: headerBytes }),
    output,
  );
  return { header, pack, finished };
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
  backupKeys: KeyRing;
  /** Master key versions used by encrypted data in the database and the file store. */
  masterKeys: BackupHeader["masterKeys"];
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

    const { header, pack, finished } = openBackupArchive({
      output: partial,
      backupKeys: options.backupKeys,
      masterKeys: options.masterKeys,
      pagehallVersion: options.pagehallVersion,
      schemaVersion: options.schemaVersion,
    });

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
      pagehallVersion: header.pagehallVersion,
      schemaVersion: header.schemaVersion,
      createdAt: header.createdAt,
      entries,
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
    pack.entry(
      { name: MANIFEST_ENTRY, size: manifestBytes.length, mode: 0o600, mtime: new Date(0) },
      manifestBytes,
    );
    pack.finalize();
    await finished;
    await rename(partial, options.output);
    options.logger.info({ entries: entries.length, schemaVersion: options.schemaVersion }, "Backup created");
    return manifest;
  } finally {
    await rm(staged, { force: true });
    await rm(partial, { force: true });
  }
}

type EntryHandler = (name: string, content: Readable) => Promise<void>;

interface ReadOptions {
  input: string;
  backupKeys: KeyRing;
  knownSchemaVersions: readonly string[];
  masterKeys?: KeyRing | null;
}

/**
 * Checks the header, then decrypts and reads the archive, checks every entry against the
 * manifest and returns it.
 */
async function readArchive(options: ReadOptions, handle: EntryHandler): Promise<BackupManifest> {
  const { header, bytes } = await readBackupHeader(options.input);
  checkBackupHeader(header, options);

  const extract = tar.extract();
  const reading = pipeline(
    createReadStream(options.input, { start: bytes.length }),
    createDecryptStream(backupStreamKeys(options.backupKeys), { associatedData: bytes }),
    createGunzip(),
    extract,
  );
  const seen: BackupManifest["entries"] = [];
  let manifest: BackupManifest | undefined;
  try {
    for await (const entry of extract) {
      const name = entry.header.name;
      if (manifest) throw new BackupError("The backup contains data after its manifest");
      if (entry.header.type !== "file") {
        const kind = ENTRY_TYPE_NAMES[entry.header.type] ?? "an unsupported entry";
        throw new BackupError(`Restore refused: the backup entry ${name} is ${kind}`);
      }
      if (name === MANIFEST_ENTRY) {
        const chunks: Buffer[] = [];
        for await (const chunk of entry) chunks.push(chunk as Buffer);
        const parsed = manifestSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        if (!parsed.success) throw new BackupError("The backup manifest is invalid");
        manifest = parsed.data;
        continue;
      }
      if (!isKnownEntry(name)) {
        throw new BackupError(`Restore refused: the backup entry ${name} is outside the restore targets`);
      }
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
  if (
    manifest.schemaVersion !== header.schemaVersion ||
    manifest.pagehallVersion !== header.pagehallVersion ||
    manifest.createdAt !== header.createdAt
  ) {
    throw new BackupError("The backup manifest does not match its header");
  }
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

/** Checks the header, decryption, the manifest and all checksums without restoring anything. */
export async function verifyBackup(options: ReadOptions): Promise<BackupManifest> {
  return readArchive(options, (_name, content) => drain(content));
}

export interface RestoreBackupOptions extends ReadOptions {
  /** The master key ring of this instance, or `null` when it has none. */
  masterKeys: KeyRing | null;
  database: DatabaseArchiver;
  filesDir: string;
  /** Where configuration files from the backup are written; skipped when not set. */
  configDir?: string | undefined;
  /** Overwrite a database or file store that is not empty. */
  force: boolean;
  logger: Logger;
}

/**
 * Restores a backup into an empty instance. The whole backup is verified first; a
 * non-empty database or file store is only overwritten with `force`.
 */
export async function restoreBackup(options: RestoreBackupOptions): Promise<BackupManifest> {
  const manifest = await verifyBackup(options);

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

  await readArchive(options, async (name, content) => {
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
