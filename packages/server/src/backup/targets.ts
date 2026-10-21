import { randomBytes, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import { isIP } from "node:net";
import path from "node:path";
import { PassThrough, Readable, type Writable } from "node:stream";
import {
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import {
  checkAddress,
  guardedLookup,
  isCertificateError,
  OutboundError,
  type OutboundPolicy,
} from "../outbound/guarded-request.js";
import {
  type BackupDestination,
  BackupError,
  type BackupHeader,
  type BackupSource,
  MAX_HEADER_BYTES,
  parseBackupHeader,
} from "./archive.js";
import { parseBackupName } from "./naming.js";

export interface StoredBackup {
  name: string;
  size: number;
}

export interface TargetCapacity {
  free: number;
  total: number;
}

export interface BackupTarget {
  readonly kind: "local" | "s3";
  readonly description: string;
  location(name: string): string;
  destination(name: string): BackupDestination;
  list(): Promise<StoredBackup[]>;
  readHeader(name: string): Promise<BackupHeader>;
  source(name: string): Promise<BackupSource>;
  delete(name: string): Promise<void>;
  capacity(): Promise<TargetCapacity | null>;
  removeIncomplete(): Promise<void>;
  test(): Promise<void>;
}

export const targetFailures = [
  "notFound",
  "permission",
  "readOnly",
  "full",
  "dns",
  "blockedAddress",
  "insecureAddress",
  "connection",
  "tls",
  "credentials",
  "bucket",
  "mismatch",
  "other",
] as const;
export type TargetFailure = (typeof targetFailures)[number];
export type TargetStep = "write" | "read" | "delete" | "list";

const FAILURE_TEXTS: Record<TargetFailure, string> = {
  notFound: "The directory does not exist in the container. Create it or mount the volume there.",
  permission:
    "Pagehall is not allowed to do this. Give the container user, or the access key, write, read, list and delete permission.",
  readOnly: "The file system is mounted read-only. Mount it writable.",
  full: "The target is full. Free up space or choose another target.",
  dns: "The host name of the endpoint could not be resolved. Check the endpoint address.",
  blockedAddress:
    "The endpoint is in a private network. Add its address to PAGEHALL_OUTBOUND_ALLOWED_NETWORKS if it is meant to be reached.",
  insecureAddress: "Public endpoints need HTTPS. Use an https:// address.",
  connection: "The endpoint could not be reached. Check the address, the port and the firewall.",
  tls: "The TLS certificate of the endpoint is not trusted. Check the certificate or the endpoint address.",
  credentials: "The access key or the secret key was not accepted. Check both keys.",
  bucket: "The bucket does not exist or is in another region. Check the bucket name and the region.",
  mismatch: "The test object came back changed. Check the storage service.",
  other: "The storage service refused the request. Check the settings and the logs of the service.",
};

const STEP_TEXTS: Record<TargetStep, string> = {
  write: "Writing to the backup target",
  read: "Reading from the backup target",
  delete: "Deleting from the backup target",
  list: "Listing the backup target",
};

export class BackupTargetError extends Error {
  override name = "BackupTargetError";
  readonly blockedAddress: string | null;

  constructor(
    readonly failure: TargetFailure,
    readonly step: TargetStep,
    options?: { cause?: unknown },
  ) {
    super(`${STEP_TEXTS[step]} failed: ${FAILURE_TEXTS[failure]}`, options);
    this.blockedAddress = failure === "blockedAddress" ? blockedAddressOf(options?.cause) : null;
  }

  get allowedNetwork(): string | null {
    if (this.blockedAddress === null) return null;
    return `${this.blockedAddress}/${isIP(this.blockedAddress) === 6 ? 128 : 32}`;
  }

  get explanation(): string {
    if (this.blockedAddress === null) return this.message;
    return `${STEP_TEXTS[this.step]} failed: The endpoint resolves to ${this.blockedAddress}, which is in a private network. If Pagehall should reach it, add ${this.allowedNetwork} or the subnet of its network to PAGEHALL_OUTBOUND_ALLOWED_NETWORKS and restart Pagehall.`;
  }
}

function blockedAddressOf(error: unknown): string | null {
  for (const cause of causes(error)) {
    if (cause instanceof OutboundError && cause.reason === "blockedAddress") return cause.address;
  }
  return null;
}

const TEST_CONTENT = "Pagehall backup target test\n";
const PARTIAL = /^pagehall-backup-.+\.phbak\.[0-9a-f-]{36}\.partial$/;

function localFailure(error: unknown): TargetFailure {
  switch ((error as NodeJS.ErrnoException).code) {
    case "ENOENT":
    case "ENOTDIR":
      return "notFound";
    case "EACCES":
    case "EPERM":
      return "permission";
    case "EROFS":
      return "readOnly";
    case "ENOSPC":
    case "EDQUOT":
      return "full";
    default:
      return "other";
  }
}

async function guardLocal<T>(step: TargetStep, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof BackupTargetError || error instanceof BackupError) throw error;
    throw new BackupTargetError(localFailure(error), step, { cause: error });
  }
}

function checkName(name: string): void {
  if (!parseBackupName(name)) throw new BackupError(`${name} is not the name of a Pagehall backup`);
}

export class LocalBackupTarget implements BackupTarget {
  readonly kind = "local" as const;
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
  }

  get description(): string {
    return this.#dir;
  }

  location(name: string): string {
    checkName(name);
    return path.join(this.#dir, name);
  }

  destination(name: string): BackupDestination {
    const output = this.location(name);
    const partial = `${output}.${randomUUID()}.partial`;
    return {
      open: () => createWriteStream(partial, { mode: 0o600 }),
      commit: async () => {
        const handle = await open(partial, "r+");
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(partial, output);
      },
      abort: () => rm(partial, { force: true }),
    };
  }

  async list(): Promise<StoredBackup[]> {
    return guardLocal("list", async () => {
      const entries = await readdir(this.#dir, { withFileTypes: true });
      const backups: StoredBackup[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !parseBackupName(entry.name)) continue;
        backups.push({ name: entry.name, size: (await stat(path.join(this.#dir, entry.name))).size });
      }
      return backups;
    });
  }

  async readHeader(name: string): Promise<BackupHeader> {
    const file = this.location(name);
    return guardLocal("read", async () => {
      const handle = await open(file, "r");
      try {
        const start = Buffer.alloc(MAX_HEADER_BYTES);
        const { bytesRead } = await handle.read(start, 0, start.length, 0);
        return (await parseBackupHeader(name, start.subarray(0, bytesRead))).header;
      } finally {
        await handle.close();
      }
    });
  }

  async source(name: string): Promise<BackupSource> {
    const file = this.location(name);
    const handle = await guardLocal("read", () => open(file, "r"));
    return {
      name,
      readHeader: async () => {
        const start = Buffer.alloc(MAX_HEADER_BYTES);
        const { bytesRead } = await handle.read(start, 0, start.length, 0);
        return parseBackupHeader(name, start.subarray(0, bytesRead));
      },
      open: async (start) => handle.createReadStream({ start, autoClose: false }),
      close: () => handle.close(),
    };
  }

  async delete(name: string): Promise<void> {
    const file = this.location(name);
    await guardLocal("delete", () => rm(file));
  }

  async capacity(): Promise<TargetCapacity> {
    const stats = await guardLocal("list", () => statfs(this.#dir));
    return { free: stats.bavail * stats.bsize, total: stats.blocks * stats.bsize };
  }

  async removeIncomplete(): Promise<void> {
    await guardLocal("delete", async () => {
      for (const entry of await readdir(this.#dir)) {
        if (PARTIAL.test(entry)) await rm(path.join(this.#dir, entry), { force: true });
      }
    });
  }

  async test(): Promise<void> {
    const name = `.pagehall-target-test-${randomBytes(6).toString("hex")}`;
    const file = path.join(this.#dir, name);
    await guardLocal("write", async () => {
      if (!(await stat(this.#dir)).isDirectory()) throw Object.assign(new Error(), { code: "ENOTDIR" });
      await writeFile(file, TEST_CONTENT, { mode: 0o600, flag: "wx" });
    });
    try {
      const read = await guardLocal("read", () => readFile(file, "utf8"));
      if (read !== TEST_CONTENT) throw new BackupTargetError("mismatch", "read");
    } finally {
      await guardLocal("delete", () => rm(file));
    }
  }
}

export async function sameVolume(first: string, second: string): Promise<boolean> {
  try {
    const [a, b] = await Promise.all([stat(first), stat(second)]);
    return a.dev === b.dev;
  } catch {
    return false;
  }
}

export interface S3TargetConfig {
  endpoint: string | null;
  region: string;
  bucket: string;
  prefix: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

const CREDENTIAL_CODES = new Set([
  "InvalidAccessKeyId",
  "SignatureDoesNotMatch",
  "InvalidSecurity",
  "InvalidToken",
  "ExpiredToken",
  "AuthorizationHeaderMalformed",
  "InvalidClientTokenId",
]);
const BUCKET_CODES = new Set(["NoSuchBucket", "PermanentRedirect", "IllegalLocationConstraintException"]);
const CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "TimeoutError",
  "RequestTimeout",
]);

function causes(error: unknown): unknown[] {
  const chain: unknown[] = [];
  for (let current: unknown = error; current && chain.length < 6; ) {
    chain.push(current);
    current = typeof current === "object" && "cause" in current ? current.cause : undefined;
  }
  return chain;
}

export function s3Failure(error: unknown): TargetFailure {
  for (const cause of causes(error)) {
    if (cause instanceof OutboundError) {
      if (cause.reason === "blockedAddress") return "blockedAddress";
      if (cause.reason === "insecureAddress") return "insecureAddress";
      if (cause.reason === "unresolvable") return "dns";
      return "connection";
    }
    const code = (cause as NodeJS.ErrnoException).code ?? "";
    const name = (cause as { name?: string }).name ?? "";
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns";
    if (isCertificateError(code) || code.startsWith("ERR_TLS") || code.startsWith("ERR_SSL")) return "tls";
    if (CONNECTION_CODES.has(code) || CONNECTION_CODES.has(name)) return "connection";
    if (CREDENTIAL_CODES.has(name) || CREDENTIAL_CODES.has(code)) return "credentials";
    if (BUCKET_CODES.has(name) || BUCKET_CODES.has(code)) return "bucket";
    if (name === "AccessDenied" || name === "Forbidden" || name === "AllAccessDisabled") return "permission";
    const status = (cause as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 403) return "permission";
    if (status === 301) return "bucket";
  }
  return "other";
}

function guardS3<T>(step: TargetStep, action: () => Promise<T>): Promise<T> {
  return action().catch((error: unknown) => {
    if (error instanceof BackupTargetError || error instanceof BackupError) throw error;
    throw new BackupTargetError(s3Failure(error), step, { cause: error });
  });
}

const PART_SIZE = 8 * 1024 * 1024;

export class S3BackupTarget implements BackupTarget {
  readonly kind = "s3" as const;
  readonly #client: S3Client;
  readonly #config: S3TargetConfig;

  constructor(config: S3TargetConfig, policy: OutboundPolicy) {
    this.#config = config;
    const secure = config.endpoint === null || new URL(config.endpoint).protocol === "https:";
    if (config.endpoint) {
      const host = new URL(config.endpoint).hostname.replace(/^\[|\]$/g, "");
      if (isIP(host) !== 0) {
        try {
          checkAddress(policy, host, secure);
        } catch (error) {
          throw new BackupTargetError(s3Failure(error), "write", { cause: error });
        }
      }
    }
    this.#client = new S3Client({
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      maxAttempts: 3,
      requestHandler: {
        connectionTimeout: 10_000,
        requestTimeout: 120_000,
        httpAgent: new HttpAgent({ keepAlive: true, lookup: guardedLookup(policy, false) }),
        httpsAgent: new HttpsAgent({ keepAlive: true, lookup: guardedLookup(policy, true) }),
      },
    });
  }

  get description(): string {
    return `s3://${this.#config.bucket}/${this.#config.prefix}`;
  }

  #key(name: string): string {
    checkName(name);
    return `${this.#config.prefix}${name}`;
  }

  location(name: string): string {
    return `s3://${this.#config.bucket}/${this.#key(name)}`;
  }

  destination(name: string): BackupDestination {
    const key = this.#key(name);
    let upload: Upload | undefined;
    let done: Promise<unknown> | undefined;
    return {
      open: (): Writable => {
        const body = new PassThrough();
        upload = new Upload({
          client: this.#client,
          params: { Bucket: this.#config.bucket, Key: key, Body: body },
          queueSize: 2,
          partSize: PART_SIZE,
          leavePartsOnError: false,
        });
        done = upload.done();
        done.catch((error: unknown) =>
          body.destroy(new BackupTargetError(s3Failure(error), "write", { cause: error })),
        );
        return body;
      },
      commit: async () => {
        await guardS3("write", async () => {
          await done;
        });
      },
      abort: async () => {
        await upload?.abort().catch(() => undefined);
        await done?.catch(() => undefined);
        await this.#abortUploads(key).catch(() => undefined);
      },
    };
  }

  async #abortUploads(key: string | null): Promise<void> {
    let keyMarker: string | undefined;
    let uploadMarker: string | undefined;
    do {
      const page = await this.#client.send(
        new ListMultipartUploadsCommand({
          Bucket: this.#config.bucket,
          Prefix: key ?? this.#config.prefix,
          ...(keyMarker ? { KeyMarker: keyMarker } : {}),
          ...(uploadMarker ? { UploadIdMarker: uploadMarker } : {}),
        }),
      );
      for (const pending of page.Uploads ?? []) {
        if (!pending.Key || !pending.UploadId) continue;
        const name = pending.Key.slice(this.#config.prefix.length);
        if (!parseBackupName(name) || (key !== null && pending.Key !== key)) continue;
        await this.#client.send(
          new AbortMultipartUploadCommand({
            Bucket: this.#config.bucket,
            Key: pending.Key,
            UploadId: pending.UploadId,
          }),
        );
      }
      keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
      uploadMarker = page.IsTruncated ? page.NextUploadIdMarker : undefined;
    } while (keyMarker);
  }

  async list(): Promise<StoredBackup[]> {
    return guardS3("list", async () => {
      const backups: StoredBackup[] = [];
      let token: string | undefined;
      do {
        const page = await this.#client.send(
          new ListObjectsV2Command({
            Bucket: this.#config.bucket,
            Prefix: this.#config.prefix,
            ...(token ? { ContinuationToken: token } : {}),
          }),
        );
        for (const object of page.Contents ?? []) {
          const name = object.Key?.slice(this.#config.prefix.length) ?? "";
          if (parseBackupName(name)) backups.push({ name, size: object.Size ?? 0 });
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return backups;
    });
  }

  async #get(key: string, range: string, ifMatch?: string): Promise<{ body: Readable; etag: string | null }> {
    const result = await this.#client.send(
      new GetObjectCommand({
        Bucket: this.#config.bucket,
        Key: key,
        Range: range,
        ...(ifMatch ? { IfMatch: ifMatch } : {}),
      }),
    );
    const body = result.Body;
    if (!body) throw new BackupError("The backup object has no content");
    return {
      body: body instanceof Readable ? body : Readable.fromWeb(body.transformToWebStream() as never),
      etag: result.ETag ?? null,
    };
  }

  async #start(key: string): Promise<{ bytes: Buffer; etag: string | null }> {
    const { body, etag } = await this.#get(key, `bytes=0-${MAX_HEADER_BYTES - 1}`);
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(chunk as Buffer);
    return { bytes: Buffer.concat(chunks), etag };
  }

  async readHeader(name: string): Promise<BackupHeader> {
    const key = this.#key(name);
    const { bytes } = await guardS3("read", () => this.#start(key));
    return (await parseBackupHeader(name, bytes)).header;
  }

  async source(name: string): Promise<BackupSource> {
    const key = this.#key(name);
    const first = await guardS3("read", () => this.#start(key));
    const etag = first.etag ?? undefined;
    return {
      name,
      readHeader: async () => {
        const again = await guardS3("read", () => this.#start(key));
        if (etag && again.etag !== etag) throw new BackupError("The backup changed while it was being read");
        return parseBackupHeader(name, again.bytes);
      },
      open: async (start) => (await guardS3("read", () => this.#get(key, `bytes=${start}-`, etag))).body,
      close: async () => {},
    };
  }

  async delete(name: string): Promise<void> {
    const key = this.#key(name);
    await guardS3("delete", () =>
      this.#client.send(new DeleteObjectCommand({ Bucket: this.#config.bucket, Key: key })),
    );
  }

  async capacity(): Promise<null> {
    return null;
  }

  async removeIncomplete(): Promise<void> {
    await guardS3("delete", () => this.#abortUploads(null));
  }

  async test(): Promise<void> {
    const key = `${this.#config.prefix}.pagehall-target-test-${randomBytes(6).toString("hex")}`;
    await guardS3("write", () =>
      this.#client.send(new PutObjectCommand({ Bucket: this.#config.bucket, Key: key, Body: TEST_CONTENT })),
    );
    try {
      const { body } = await guardS3("read", () => this.#get(key, `bytes=0-${TEST_CONTENT.length - 1}`));
      const chunks: Buffer[] = [];
      for await (const chunk of body) chunks.push(chunk as Buffer);
      if (Buffer.concat(chunks).toString("utf8") !== TEST_CONTENT)
        throw new BackupTargetError("mismatch", "read");
      await guardS3("list", () =>
        this.#client.send(
          new ListObjectsV2Command({ Bucket: this.#config.bucket, Prefix: this.#config.prefix, MaxKeys: 1 }),
        ),
      );
    } finally {
      await guardS3("delete", () =>
        this.#client.send(new DeleteObjectCommand({ Bucket: this.#config.bucket, Key: key })),
      );
    }
  }

  destroy(): void {
    this.#client.destroy();
  }
}

export async function ensureDirectory(dir: string): Promise<void> {
  await guardLocal("write", () => mkdir(dir, { recursive: true, mode: 0o700 }));
}
