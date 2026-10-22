import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, type Dirent } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform, type Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import tar from "tar-stream";
import { z } from "zod";
import { KeyRing, keyFingerprint, SecretKey } from "../crypto/key-ring.js";
import {
  backupKeyFingerprint,
  backupStreamKeys,
  createDecryptStream,
  createEncryptStream,
  DEFAULT_CHUNK_SIZE,
  type StreamKeys,
} from "../crypto/stream.js";
import { ATTACHMENTS_DIRECTORY, type FileStore } from "../files/store.js";
import type { Logger } from "../logging/logger.js";
import type { DatabaseArchiver } from "./postgres.js";
import {
  hasRestoreMarker,
  RESTORE_ENTRIES,
  RESTORE_STAGING,
  removeRestoreMarker,
  writeRestoredMarker,
  writeRestoreMarker,
} from "./restore-marker.js";

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
export const backupScopes = ["all", "database"] as const;
export type BackupScope = (typeof backupScopes)[number];
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
  scope: z.enum(backupScopes).optional(),
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
    return await readHeaderFrom(input, (buffer, position) => file.read(buffer, 0, buffer.length, position));
  } finally {
    await file.close();
  }
}

export const MAX_HEADER_BYTES = PREFIX_LENGTH + MAX_HEADER_LENGTH;

async function readHeaderFrom(
  name: string,
  read: (buffer: Buffer, position: number) => Promise<{ bytesRead: number }>,
): Promise<{ header: BackupHeader; bytes: Buffer }> {
  const prefix = Buffer.alloc(PREFIX_LENGTH);
  const { bytesRead } = await read(prefix, 0);
  if (bytesRead < PREFIX_LENGTH || !prefix.subarray(0, 4).equals(MAGIC)) {
    throw new BackupError(`${name} is not a Pagehall backup`);
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
  const rest = await read(json, PREFIX_LENGTH);
  if (rest.bytesRead < length) throw new BackupError("The backup header is damaged");
  let parsed: unknown;
  try {
    parsed = JSON.parse(json.toString("utf8"));
  } catch {
    throw new BackupError("The backup header is damaged");
  }
  const header = headerSchema.safeParse(parsed);
  if (!header.success) throw new BackupError("The backup header is damaged");
  return { header: header.data, bytes: Buffer.concat([prefix, json]) };
}

export function parseBackupHeader(
  name: string,
  start: Buffer,
): Promise<{ header: BackupHeader; bytes: Buffer }> {
  return readHeaderFrom(name, async (buffer, position) => ({
    bytesRead: position >= start.length ? 0 : start.copy(buffer, 0, position),
  }));
}

export interface BackupSource {
  readonly name: string;
  readHeader(): Promise<{ header: BackupHeader; bytes: Buffer }>;
  open(start: number): Promise<Readable>;
  close(): Promise<void>;
}

export async function openBackupFile(input: string): Promise<BackupSource> {
  const handle = await open(input, "r");
  return {
    name: input,
    readHeader: () =>
      readHeaderFrom(input, (buffer, position) => handle.read(buffer, 0, buffer.length, position)),
    open: async (start) => handle.createReadStream({ start, autoClose: false }),
    close: () => handle.close(),
  };
}

async function withSource<T>(input: string | BackupSource, use: (source: BackupSource) => Promise<T>) {
  const source = typeof input === "string" ? await openBackupFile(input) : input;
  try {
    return await use(source);
  } finally {
    if (typeof input === "string") await source.close();
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
  output: string | Writable;
  backupKeys: KeyRing;
  masterKeys: BackupHeader["masterKeys"];
  pagehallVersion: string;
  schemaVersion: string;
  scope?: BackupScope;
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
    ...(options.scope === "database" ? { scope: "database" as const } : {}),
  };
  const headerBytes = encodeBackupHeader(header);
  const pack = tar.pack();
  const output =
    typeof options.output === "string" ? createWriteStream(options.output, { mode: 0o600 }) : options.output;
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
      if (dir === root && RESTORE_ENTRIES.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) files.push(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  await visit(root);
  return files.sort();
}

/** True when the file store holds no files; entries of an earlier restore do not count. */
async function isEmptyFileStore(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).every((entry) => RESTORE_ENTRIES.has(entry));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

export interface BackupDestination {
  open(): Writable;
  commit(): Promise<void>;
  abort(): Promise<void>;
}

export function fileDestination(output: string): BackupDestination {
  const partial = `${output}.${randomUUID()}.partial`;
  return {
    open: () => createWriteStream(partial, { mode: 0o600 }),
    commit: () => rename(partial, output),
    abort: () => rm(partial, { force: true }),
  };
}

export const STAGED_DUMP = /^backup-[0-9a-f-]{36}\.dump\.enc$/;

function ephemeralStreamKeys(): StreamKeys {
  return backupStreamKeys(new KeyRing(new Map([[1, new SecretKey(randomBytes(32))]])));
}

export interface CreateBackupOptions {
  output: string | BackupDestination;
  stagingDir: string;
  backupKeys: KeyRing;
  /** Master key versions used by encrypted data in the database and the file store. */
  masterKeys: BackupHeader["masterKeys"];
  database: DatabaseArchiver;
  filesDir: string;
  objectStore?: FileStore | undefined;
  scope?: BackupScope | undefined;
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
  const destination = typeof options.output === "string" ? fileDestination(options.output) : options.output;
  const staged = path.join(options.stagingDir, `backup-${randomUUID()}.dump.enc`);
  const stagingKeys = ephemeralStreamKeys();
  const entries: BackupManifest["entries"] = [];
  let committed = false;
  try {
    await mkdir(options.stagingDir, { recursive: true, mode: 0o700 });
    let dumpSize = 0;
    await pipeline(
      options.database.dump(),
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          dumpSize += chunk.length;
          callback(null, chunk);
        },
      }),
      createEncryptStream(stagingKeys),
      createWriteStream(staged, { mode: 0o600, flags: "wx" }),
    );

    const scope = options.scope ?? "all";
    const { header, pack, finished } = openBackupArchive({
      output: destination.open(),
      backupKeys: options.backupKeys,
      masterKeys: options.masterKeys,
      pagehallVersion: options.pagehallVersion,
      schemaVersion: options.schemaVersion,
      scope,
    });
    finished.catch(() => {});

    const add = async (name: string, source: Readable | [Readable, Transform], size: number) => {
      const hasher = new Hasher();
      const entry = pack.entry({ name, size, mode: 0o600, mtime: new Date(0) });
      await pipeline([...(Array.isArray(source) ? source : [source]), hasher, entry]);
      entries.push({ path: name, size: hasher.size, sha256: hasher.digest() });
    };

    await add(DATABASE_ENTRY, [createReadStream(staged), createDecryptStream(stagingKeys)], dumpSize);
    for (const file of scope === "all" ? await listFiles(options.filesDir) : []) {
      const full = path.join(options.filesDir, ...file.split("/"));
      await add(`${FILES_PREFIX}${file}`, createReadStream(full), (await stat(full)).size);
    }
    if (options.objectStore && scope === "all") {
      for await (const object of options.objectStore.list()) {
        await add(
          `${FILES_PREFIX}${ATTACHMENTS_DIRECTORY}/${object.key}`,
          await options.objectStore.read(object.key),
          object.size,
        );
      }
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
    await destination.commit();
    committed = true;
    options.logger.info({ entries: entries.length, schemaVersion: options.schemaVersion }, "Backup created");
    return manifest;
  } finally {
    await rm(staged, { force: true });
    if (!committed) await destination.abort();
  }
}

type EntryHandler = (name: string, content: Readable) => Promise<void>;

interface ReadOptions {
  input: string | BackupSource;
  backupKeys: KeyRing;
  knownSchemaVersions: readonly string[];
  masterKeys?: KeyRing | null;
}

/**
 * Checks the header, then decrypts and reads the archive, checks every entry against the
 * manifest and returns it.
 */
async function readArchive(
  source: BackupSource,
  options: ReadOptions,
  handle: EntryHandler,
): Promise<{ manifest: BackupManifest; header: BackupHeader; bytes: Buffer }> {
  const { header, bytes } = await source.readHeader();
  checkBackupHeader(header, options);

  const extract = tar.extract();
  const reading = pipeline(
    await source.open(bytes.length),
    createDecryptStream(backupStreamKeys(options.backupKeys), { associatedData: bytes }),
    createGunzip(),
    extract,
  );
  // A failure also ends the current entry, so the handler rejects; until it does, the
  // rejection of the pipeline must not count as unhandled.
  reading.catch(() => {});
  const seen: BackupManifest["entries"] = [];
  let manifest: BackupManifest | undefined;
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
    if (!isKnownEntry(name) || (header.scope === "database" && name.startsWith(FILES_PREFIX))) {
      throw new BackupError(`Restore refused: the backup entry ${name} is outside the restore targets`);
    }
    const hasher = new Hasher();
    await handle(name, entry.pipe(hasher));
    seen.push({ path: name, size: hasher.size, sha256: hasher.digest() });
  }
  await reading;
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
  return { manifest, header, bytes };
}

async function drain(content: Readable): Promise<void> {
  for await (const _chunk of content);
}

/** Checks the header, decryption, the manifest and all checksums without restoring anything. */
export async function verifyBackup(options: ReadOptions): Promise<BackupManifest> {
  return withSource(options.input, async (source) => {
    const { manifest } = await readArchive(source, options, (_name, content) => drain(content));
    return manifest;
  });
}

export interface RestoreBackupOptions extends ReadOptions {
  /** The master key ring of this instance, or `null` when it has none. */
  masterKeys: KeyRing | null;
  database: DatabaseArchiver;
  filesDir: string;
  objectStore?: FileStore | undefined;
  /** Where configuration files from the backup are written; skipped when not set. */
  configDir?: string | undefined;
  /** Overwrite a database or file store that is not empty. */
  force: boolean;
  markRestoredIn?: string | undefined;
  logger: Logger;
}

/**
 * Restores a backup into an empty instance, or with `force` over an existing one.
 *
 * The files are extracted into a staging directory first, which also verifies the whole
 * backup. The database is then restored in a single transaction, and only after it has been
 * committed are the staged files moved into the file store. A marker in the file store
 * covers the time from the start of the database restore until the files are in place; the
 * application does not start while it exists. A failure before the database commit leaves
 * the instance as it was.
 */
export async function restoreBackup(options: RestoreBackupOptions): Promise<BackupManifest> {
  return withSource(options.input, (source) => restoreFrom(source, options));
}

async function restoreFrom(source: BackupSource, options: RestoreBackupOptions): Promise<BackupManifest> {
  const { header } = await source.readHeader();
  checkBackupHeader(header, options);
  const withFiles = header.scope !== "database";

  const databaseEmpty = await options.database.isEmpty();
  const filesEmpty =
    !withFiles ||
    ((await isEmptyFileStore(options.filesDir)) &&
      (!options.objectStore ||
        (await options.objectStore.list()[Symbol.asyncIterator]().next()).done === true));
  if (!options.force && (!databaseEmpty || !filesEmpty)) {
    throw new BackupError(
      `Restore refused: the ${!databaseEmpty ? "database" : "file store"} is not empty. Use --force to overwrite it`,
    );
  }

  const staging = path.join(options.filesDir, RESTORE_STAGING);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  let first: Awaited<ReturnType<typeof readArchive>>;
  try {
    first = await readArchive(source, options, async (name, content) => {
      if (!name.startsWith(FILES_PREFIX)) return drain(content);
      const target = path.join(staging, ...name.slice(FILES_PREFIX.length).split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await pipeline(content, createWriteStream(target, { mode: 0o600 }));
    });
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }

  const earlierRestoreIncomplete = await hasRestoreMarker(options.filesDir);
  await writeRestoreMarker(options.filesDir, source.name);
  let databaseRestored = false;
  try {
    if (!(await source.readHeader()).bytes.equals(first.bytes)) {
      throw new BackupError("The backup changed while it was being restored");
    }
    const second = await readArchive(source, options, async (name, content) => {
      if (name === DATABASE_ENTRY) {
        await options.database.restore(content, { replaceExisting: !databaseEmpty });
        databaseRestored = true;
      } else if (name.startsWith(CONFIG_PREFIX) && options.configDir) {
        const target = path.join(options.configDir, ...name.slice(CONFIG_PREFIX.length).split("/"));
        await mkdir(path.dirname(target), { recursive: true });
        await pipeline(content, createWriteStream(target, { mode: 0o600 }));
      } else {
        await drain(content);
      }
    });
    if (
      !second.bytes.equals(first.bytes) ||
      JSON.stringify(second.manifest) !== JSON.stringify(first.manifest)
    ) {
      throw new BackupError("The backup changed while it was being restored");
    }
    if (withFiles) {
      if (options.objectStore)
        await replaceObjects(options.objectStore, path.join(staging, ATTACHMENTS_DIRECTORY));
      await replaceFiles(options.filesDir, staging);
    } else {
      await rm(staging, { recursive: true, force: true });
    }
  } catch (error) {
    if (databaseRestored) {
      throw new BackupError(
        `The database was restored, but the restore did not complete: ${(error as Error).message}. Pagehall does not start until the restore is run again with --force.`,
        { cause: error },
      );
    }
    await rm(staging, { recursive: true, force: true });
    if (!earlierRestoreIncomplete) await removeRestoreMarker(options.filesDir);
    throw error;
  }
  if (options.markRestoredIn) await writeRestoredMarker(options.markRestoredIn);
  await removeRestoreMarker(options.filesDir);
  options.logger.info(
    { schemaVersion: first.manifest.schemaVersion, entries: first.manifest.entries.length },
    "Backup restored",
  );
  return first.manifest;
}

async function replaceObjects(store: FileStore, staged: string): Promise<void> {
  const keys = new Set<string>();
  for (const file of await listFiles(staged)) {
    keys.add(file);
    await store.write(file, createReadStream(path.join(staged, ...file.split("/"))));
  }
  for await (const object of store.list()) {
    if (!keys.has(object.key)) await store.delete(object.key);
  }
  await rm(staged, { recursive: true, force: true });
}

/** Replaces the content of the file store with the staged files. */
async function replaceFiles(filesDir: string, staging: string): Promise<void> {
  for (const entry of await readdir(filesDir)) {
    if (!RESTORE_ENTRIES.has(entry)) await rm(path.join(filesDir, entry), { recursive: true, force: true });
  }
  for (const entry of await readdir(staging)) {
    await rename(path.join(staging, entry), path.join(filesDir, entry));
  }
  await rm(staging, { recursive: true, force: true });
}
