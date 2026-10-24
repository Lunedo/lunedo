import { randomUUID } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import {
  access,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { generateToken, hashToken, isWellFormedToken } from "../auth/tokens.js";
import {
  BackupError,
  type BackupHeader,
  type BackupSource,
  checkBackupHeader,
  readBackupHeader,
  restoreBackup,
} from "../backup/archive.js";
import { type DatabaseArchiver, PostgresArchiver } from "../backup/postgres.js";
import { pauseBackupsAfterRestore } from "../backup/restored.js";
import { S3BackupTarget, type S3TargetConfig } from "../backup/targets.js";
import { formatKeyEntry, type KeyRing, KeyRingError, parseKeyRing } from "../crypto/key-ring.js";
import type { KeyRingHolder } from "../crypto/key-ring-holder.js";
import type { Database } from "../database/database.js";
import { type NotificationListener, notify } from "../database/notifications.js";
import type { DatabasePool } from "../database/pool.js";
import type { FileStore } from "../files/store.js";
import type { Logger } from "../logging/logger.js";
import type { OutboundPolicy } from "../outbound/guarded-request.js";

export const RESTART_CHANNEL = "lunedo_restart";
export const UPLOAD_CHUNK_MAX_BYTES = 8 * 1024 * 1024;

const STATUS_FILE = "setup-restore.json";
const UPLOAD_PREFIX = ".upload-";
const BACKUP_EXTENSION = ".ldbak";
const STATUS_VISIBLE_MS = 24 * 60 * 60 * 1000;

export type RestoreStepId = "download" | "verify" | "database" | "files" | "migrations";
export type RestoreStepState = "waiting" | "running" | "done" | "failed";
export type RestoreFailure =
  | "backupKey"
  | "masterKeys"
  | "invalidBackup"
  | "source"
  | "restore"
  | "migrations"
  | "interrupted";

export interface RestoreStatus {
  state: "running" | "done" | "failed";
  backup: string;
  steps: { id: RestoreStepId; state: RestoreStepState }[];
  failure: { code: RestoreFailure; message: string } | null;
  startedAt: string;
  finishedAt: string | null;
}

interface StoredStatus extends RestoreStatus {
  id: string;
  tokenHash: string;
}

export interface BackupEntry {
  name: string;
  size: number;
  createdAt: string | null;
  lunedoVersion: string | null;
  scope: "all" | "database" | null;
  readable: boolean;
}

export interface S3SourceInput {
  endpoint: string | null;
  region: string;
  bucket: string;
  prefix: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export type RestoreSourceInput =
  | { type: "directory"; directory?: string | undefined; name: string }
  | { type: "upload"; name: string }
  | ({ type: "s3"; name: string } & S3SourceInput);

export interface StartRestoreInput {
  source: RestoreSourceInput;
  backupKey: string;
  masterKeys: string;
}

export interface UploadState {
  id: string;
  name: string;
  size: number;
  received: number;
  complete: boolean;
  file: string | null;
}

export class SetupRestoreError extends Error {
  override name = "SetupRestoreError";

  constructor(
    readonly code:
      | "directoryNotReadable"
      | "backupNotFound"
      | "uploadNotFound"
      | "uploadOffset"
      | "uploadTooLarge"
      | "notEnoughSpace"
      | "restoreRunning"
      | "invalidKeys",
    message: string,
  ) {
    super(message);
  }
}

export interface SetupRestoreOptions {
  backupDir: string;
  workDir: string;
  filesDir: string;
  databaseUrl: string;
  objectStore?: FileStore | undefined;
  policy: OutboundPolicy;
  keys: {
    provider: "env" | "file";
    masterKeysPath: string;
    backupKeysPath: string | null;
  };
  keyRing: KeyRingHolder;
  pool: DatabasePool;
  database: Database;
  knownSchemaVersions: readonly string[];
  migrate: () => Promise<void>;
  archiver?: (databaseUrl: string) => DatabaseArchiver;
  s3Target?: (config: S3TargetConfig) => Pick<S3BackupTarget, "list" | "readHeader" | "source">;
  logger: Logger;
}

function statusPath(workDir: string): string {
  return path.join(workDir, STATUS_FILE);
}

function uploadPaths(backupDir: string, id: string) {
  return {
    data: path.join(backupDir, `${UPLOAD_PREFIX}${id}.part`),
    meta: path.join(backupDir, `${UPLOAD_PREFIX}${id}.json`),
  };
}

function backupFileName(name: string): string {
  const base = path
    .basename(name)
    .replace(/[^\w.-]+/g, "-")
    .replace(/^[.-]+/, "");
  const stem = base.toLowerCase().endsWith(BACKUP_EXTENSION) ? base.slice(0, -BACKUP_EXTENSION.length) : base;
  return `${stem || "backup"}${BACKUP_EXTENSION}`;
}

function isUploadId(id: string): boolean {
  return /^[0-9a-f-]{36}$/.test(id);
}

export function parseKeyInput(text: string, variable: "LUNEDO_MASTER_KEYS" | "LUNEDO_BACKUP_KEY"): KeyRing {
  const line = text
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${variable}=`));
  const value = (line ? line.slice(variable.length + 1) : text).trim().replace(/^["']|["']$/g, "");
  if (/^[A-Za-z0-9+/=_-]{40,}$/.test(value) && !value.includes(":")) return parseKeyRing(`1:${value}`);
  return parseKeyRing(value);
}

function ringText(ring: KeyRing): string {
  return `${ring.versions.map((version) => formatKeyEntry(version, ring.get(version).use())).join("\n")}\n`;
}

async function writeSecretFile(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { mode: 0o600, flag: "wx" });
  await rename(temporary, file);
}

async function headerEntry(
  name: string,
  size: number,
  read: () => Promise<BackupHeader>,
): Promise<BackupEntry> {
  try {
    const header = await read();
    return {
      name,
      size,
      createdAt: header.createdAt,
      lunedoVersion: header.lunedoVersion,
      scope: header.scope ?? "all",
      readable: true,
    };
  } catch {
    return { name, size, createdAt: null, lunedoVersion: null, scope: null, readable: false };
  }
}

function newestFirst(entries: BackupEntry[]): BackupEntry[] {
  return entries.sort(
    (a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || a.name.localeCompare(b.name),
  );
}

export class SetupRestoreService {
  readonly #options: SetupRestoreOptions;
  #active: StoredStatus | null = null;
  #busy = false;

  constructor(options: SetupRestoreOptions) {
    this.#options = options;
  }

  async #freeBytes(directory: string): Promise<number> {
    const stats = await statfs(directory);
    return stats.bavail * stats.bsize;
  }

  async #readableDirectory(directory: string | undefined): Promise<string> {
    const requested = directory?.trim() || this.#options.backupDir;
    if (!path.isAbsolute(requested)) {
      throw new SetupRestoreError("directoryNotReadable", "Give the directory as an absolute path");
    }
    try {
      const resolved = await realpath(requested);
      if (!(await stat(resolved)).isDirectory()) throw new Error("not a directory");
      await access(resolved, constants.R_OK | constants.X_OK);
      return resolved;
    } catch {
      throw new SetupRestoreError(
        "directoryNotReadable",
        `${requested} is not a directory Lunedo can read on this server`,
      );
    }
  }

  async listDirectory(
    directory?: string,
  ): Promise<{ directory: string; freeBytes: number; backups: BackupEntry[] }> {
    const resolved = await this.#readableDirectory(directory);
    const entries = await readdir(resolved, { withFileTypes: true });
    const backups: BackupEntry[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith(".")) continue;
      if (!entry.name.toLowerCase().endsWith(BACKUP_EXTENSION)) continue;
      const file = path.join(resolved, entry.name);
      const size = (await stat(file)).size;
      backups.push(await headerEntry(entry.name, size, async () => (await readBackupHeader(file)).header));
    }
    return {
      directory: resolved,
      freeBytes: await this.#freeBytes(this.#options.backupDir),
      backups: newestFirst(backups),
    };
  }

  #s3(input: S3SourceInput) {
    const config: S3TargetConfig = {
      endpoint: input.endpoint,
      region: input.region,
      bucket: input.bucket,
      prefix: input.prefix,
      forcePathStyle: input.forcePathStyle,
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
    };
    return this.#options.s3Target?.(config) ?? new S3BackupTarget(config, this.#options.policy);
  }

  async listS3(input: S3SourceInput): Promise<BackupEntry[]> {
    const target = this.#s3(input);
    const stored = await target.list();
    return newestFirst(
      await Promise.all(
        stored.map((backup) => headerEntry(backup.name, backup.size, () => target.readHeader(backup.name))),
      ),
    );
  }

  async startUpload(input: { name: string; size: number }): Promise<UploadState> {
    await mkdir(this.#options.backupDir, { recursive: true });
    if (input.size > (await this.#freeBytes(this.#options.backupDir))) {
      throw new SetupRestoreError(
        "notEnoughSpace",
        `The backup needs ${input.size} bytes, but the backup directory has less free space`,
      );
    }
    const id = randomUUID();
    const paths = uploadPaths(this.#options.backupDir, id);
    await writeFile(paths.data, "", { mode: 0o600, flag: "wx" });
    await writeFile(paths.meta, JSON.stringify({ name: backupFileName(input.name), size: input.size }), {
      mode: 0o600,
      flag: "wx",
    });
    return {
      id,
      name: backupFileName(input.name),
      size: input.size,
      received: 0,
      complete: false,
      file: null,
    };
  }

  async upload(id: string): Promise<UploadState> {
    if (!isUploadId(id)) throw new SetupRestoreError("uploadNotFound", "The upload does not exist");
    const paths = uploadPaths(this.#options.backupDir, id);
    let meta: { name: string; size: number; file?: string };
    try {
      meta = JSON.parse(await readFile(paths.meta, "utf8")) as typeof meta;
    } catch {
      throw new SetupRestoreError("uploadNotFound", "The upload does not exist");
    }
    if (meta.file) {
      return { id, name: meta.name, size: meta.size, received: meta.size, complete: true, file: meta.file };
    }
    const received = (await stat(paths.data)).size;
    return { id, name: meta.name, size: meta.size, received, complete: false, file: null };
  }

  async appendUpload(id: string, offset: number, chunk: Readable): Promise<UploadState> {
    const state = await this.upload(id);
    if (state.complete || offset !== state.received) {
      chunk.resume();
      throw new SetupRestoreError("uploadOffset", `The upload continues at byte ${state.received}`);
    }
    const paths = uploadPaths(this.#options.backupDir, id);
    const handle = await open(paths.data, "r+");
    let written = 0;
    try {
      for await (const part of chunk) {
        const buffer = part as Buffer;
        if (
          written + buffer.length > UPLOAD_CHUNK_MAX_BYTES ||
          offset + written + buffer.length > state.size
        ) {
          throw new SetupRestoreError(
            "uploadTooLarge",
            "The part is larger than allowed or than the announced file",
          );
        }
        await handle.write(buffer, 0, buffer.length, offset + written);
        written += buffer.length;
      }
      await handle.truncate(offset + written);
      await handle.sync();
    } catch (error) {
      await handle.truncate(offset);
      throw error;
    } finally {
      await handle.close();
    }
    const received = offset + written;
    if (received < state.size) return { ...state, received };
    const file = await this.#availableName(state.name);
    await rename(paths.data, path.join(this.#options.backupDir, file));
    await writeFile(paths.meta, JSON.stringify({ name: state.name, size: state.size, file }), {
      mode: 0o600,
    });
    this.#options.logger.info({ file, size: state.size }, "Backup uploaded during the setup");
    return { ...state, received, complete: true, file };
  }

  async #availableName(name: string): Promise<string> {
    const stem = name.slice(0, -BACKUP_EXTENSION.length);
    for (let attempt = 0; ; attempt++) {
      const candidate = attempt === 0 ? name : `${stem}-${attempt}${BACKUP_EXTENSION}`;
      try {
        await stat(path.join(this.#options.backupDir, candidate));
      } catch {
        return candidate;
      }
    }
  }

  async status(token: string): Promise<RestoreStatus | null> {
    if (!isWellFormedToken(token)) return null;
    const stored = this.#active ?? (await this.#readStatus());
    if (!stored || stored.tokenHash !== hashToken(token).toString("hex")) return null;
    const { id: _id, tokenHash: _hash, ...status } = stored;
    return status;
  }

  async #readStatus(): Promise<StoredStatus | null> {
    try {
      const stored = JSON.parse(await readFile(statusPath(this.#options.workDir), "utf8")) as StoredStatus;
      const finished = stored.finishedAt ? Date.parse(stored.finishedAt) : Date.now();
      if (Date.now() - finished > STATUS_VISIBLE_MS) return null;
      if (stored.state === "running") {
        return {
          ...stored,
          state: "failed",
          steps: stored.steps.map((step) => (step.state === "running" ? { ...step, state: "failed" } : step)),
          failure: {
            code: "interrupted",
            message: "The restore was interrupted, for example by a restart of Lunedo",
          },
        };
      }
      return stored;
    } catch {
      return null;
    }
  }

  async #save(status: StoredStatus): Promise<void> {
    await mkdir(this.#options.workDir, { recursive: true, mode: 0o700 });
    await writeSecretFile(statusPath(this.#options.workDir), JSON.stringify(status));
  }

  #keys(input: StartRestoreInput): { backupKeys: KeyRing; masterKeys: KeyRing } {
    let backupKeys: KeyRing;
    let masterKeys: KeyRing;
    try {
      backupKeys = parseKeyInput(input.backupKey, "LUNEDO_BACKUP_KEY");
    } catch (error) {
      throw new SetupRestoreError(
        "invalidKeys",
        `The backup key is not valid: ${(error as KeyRingError).message}`,
      );
    }
    try {
      masterKeys = parseKeyInput(input.masterKeys, "LUNEDO_MASTER_KEYS");
    } catch (error) {
      throw new SetupRestoreError(
        "invalidKeys",
        `The master key file is not valid: ${(error as KeyRingError).message}`,
      );
    }
    return { backupKeys, masterKeys };
  }

  async #source(
    source: RestoreSourceInput,
  ): Promise<{ name: string; local: string | null; remote: BackupSource | null }> {
    if (source.type === "s3") {
      return { name: source.name, local: null, remote: await this.#s3(source).source(source.name) };
    }
    const directory =
      source.type === "upload" ? this.#options.backupDir : await this.#readableDirectory(source.directory);
    const file = path.join(directory, path.basename(source.name));
    try {
      if (!(await stat(file)).isFile()) throw new Error("not a file");
    } catch {
      throw new SetupRestoreError("backupNotFound", `${source.name} does not exist in ${directory}`);
    }
    return { name: path.basename(source.name), local: file, remote: null };
  }

  async start(input: StartRestoreInput): Promise<string> {
    if (this.#busy) throw new SetupRestoreError("restoreRunning", "A restore is already running");
    this.#busy = true;
    try {
      if ((await this.#readStatusRaw())?.state === "running") {
        throw new SetupRestoreError("restoreRunning", "A restore is already running");
      }
      const keys = this.#keys(input);
      const source = await this.#source(input.source);
      const token = generateToken();
      const status: StoredStatus = {
        id: randomUUID(),
        tokenHash: hashToken(token).toString("hex"),
        state: "running",
        backup: source.name,
        steps: [
          ...(source.remote ? [{ id: "download" as const, state: "waiting" as const }] : []),
          { id: "verify", state: "waiting" },
          { id: "database", state: "waiting" },
          { id: "files", state: "waiting" },
          { id: "migrations", state: "waiting" },
        ],
        failure: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
      };
      this.#active = status;
      await this.#save(status);
      this.#options.logger.info(
        { backup: source.name, source: input.source.type },
        "Restore during the setup started",
      );
      void this.#run(status, source, keys).finally(() => {
        this.#busy = false;
      });
      return token;
    } catch (error) {
      this.#busy = false;
      throw error;
    }
  }

  async #readStatusRaw(): Promise<StoredStatus | null> {
    try {
      return JSON.parse(await readFile(statusPath(this.#options.workDir), "utf8")) as StoredStatus;
    } catch {
      return null;
    }
  }

  async #step(status: StoredStatus, id: RestoreStepId, state: RestoreStepState): Promise<void> {
    status.steps = status.steps.map((step) => (step.id === id ? { ...step, state } : step));
    await this.#save(status);
  }

  async #download(status: StoredStatus, name: string, remote: BackupSource): Promise<string> {
    await this.#step(status, "download", "running");
    await mkdir(this.#options.backupDir, { recursive: true });
    const target = path.join(this.#options.backupDir, await this.#availableName(backupFileName(name)));
    const partial = `${target}.${randomUUID()}.partial`;
    try {
      await pipeline(await remote.open(0), createWriteStream(partial, { mode: 0o600 }));
      await rename(partial, target);
    } finally {
      await rm(partial, { force: true });
      await remote.close();
    }
    await this.#step(status, "download", "done");
    return target;
  }

  async #run(
    status: StoredStatus,
    source: { name: string; local: string | null; remote: BackupSource | null },
    keys: { backupKeys: KeyRing; masterKeys: KeyRing },
  ): Promise<void> {
    const { logger } = this.#options;
    let current: RestoreStepId = source.remote ? "download" : "verify";
    try {
      const file = source.remote
        ? await this.#download(status, source.name, source.remote)
        : (source.local ?? "");
      current = "verify";
      await this.#step(status, "verify", "running");
      const { header } = await readBackupHeader(file);
      checkBackupHeader(header, {
        backupKeys: keys.backupKeys,
        knownSchemaVersions: this.#options.knownSchemaVersions,
        masterKeys: keys.masterKeys,
      });
      if (this.#options.keys.provider === "env") {
        checkBackupHeader(header, {
          backupKeys: keys.backupKeys,
          knownSchemaVersions: this.#options.knownSchemaVersions,
          masterKeys: this.#options.keyRing.ring,
        });
      }
      const archiver =
        this.#options.archiver?.(this.#options.databaseUrl) ??
        new PostgresArchiver({ databaseUrl: this.#options.databaseUrl });
      await restoreBackup({
        input: file,
        backupKeys: keys.backupKeys,
        masterKeys: keys.masterKeys,
        database: archiver,
        filesDir: this.#options.filesDir,
        objectStore: this.#options.objectStore,
        force: true,
        markRestoredIn: this.#options.workDir,
        knownSchemaVersions: this.#options.knownSchemaVersions,
        logger,
        onProgress: (stage) => {
          const next: Record<typeof stage, [RestoreStepId, RestoreStepId | null]> = {
            verified: ["verify", "database"],
            database: ["database", "files"],
            files: ["files", null],
          };
          const [done, following] = next[stage];
          status.steps = status.steps.map((step) =>
            step.id === done
              ? { ...step, state: "done" }
              : step.id === following
                ? { ...step, state: "running" }
                : step,
          );
          if (following) current = following;
          void this.#save(status);
        },
      });
      await this.#installKeys(keys);
      current = "migrations";
      await this.#step(status, "migrations", "running");
      await this.#options.migrate();
      await pauseBackupsAfterRestore(this.#options.workDir, this.#options.database, logger);
      await this.#step(status, "migrations", "done");
      status.state = "done";
      status.finishedAt = new Date().toISOString();
      await this.#save(status);
      logger.info(
        { backup: source.name, schemaVersion: header.schemaVersion },
        "Restore during the setup completed",
      );
      await notify(this.#options.pool, RESTART_CHANNEL, "restored");
    } catch (error) {
      const code: RestoreFailure =
        current === "migrations"
          ? "migrations"
          : current === "download"
            ? "source"
            : error instanceof BackupError && /backup key/.test(error.message)
              ? "backupKey"
              : error instanceof BackupError && /master key/.test(error.message)
                ? "masterKeys"
                : current === "verify"
                  ? "invalidBackup"
                  : "restore";
      status.steps = status.steps.map((step) => (step.id === current ? { ...step, state: "failed" } : step));
      status.state = "failed";
      status.failure = { code, message: (error as Error).message };
      status.finishedAt = new Date().toISOString();
      await this.#save(status).catch(() => {});
      logger.error({ err: error, backup: source.name, step: current }, "Restore during the setup failed");
    }
  }

  async #installKeys(keys: { backupKeys: KeyRing; masterKeys: KeyRing }): Promise<void> {
    if (this.#options.keys.provider === "file") {
      await writeSecretFile(this.#options.keys.masterKeysPath, ringText(keys.masterKeys));
      await this.#options.keyRing.reload();
      await this.#options.keyRing.announce(this.#options.pool);
    }
    if (this.#options.keys.backupKeysPath) {
      await writeSecretFile(this.#options.keys.backupKeysPath, ringText(keys.backupKeys));
    }
  }
}

export async function restartWhenRestored(
  listener: Pick<NotificationListener, "listen">,
  logger: Logger,
  stop: () => void = () => process.kill(process.pid, "SIGTERM"),
): Promise<void> {
  await listener.listen(RESTART_CHANNEL, () => {
    logger.warn("A backup was restored during the setup; Lunedo restarts to load it");
    stop();
  });
}
