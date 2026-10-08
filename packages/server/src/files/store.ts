import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { FileStorageConfig } from "../config/load.js";

export interface ByteRange {
  start: number;
  end: number;
}

export interface StoredObject {
  key: string;
  size: number;
}

export interface FileStore {
  readonly kind: "local" | "s3";
  write(key: string, body: Readable): Promise<number>;
  read(key: string, range?: ByteRange): Promise<Readable>;
  size(key: string): Promise<number | null>;
  delete(key: string): Promise<void>;
  list(prefix?: string): AsyncIterable<StoredObject>;
  replaceHead(key: string, head: Buffer): Promise<void>;
}

const KEY_PATTERN = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

export function assertObjectKey(key: string): void {
  const valid =
    KEY_PATTERN.test(key) &&
    key.length <= 200 &&
    key.split("/").every((part) => part !== "." && part !== "..");
  if (!valid) throw new Error("Invalid object key");
}

export const ATTACHMENTS_DIRECTORY = "attachments";

export class LocalFileStore implements FileStore {
  readonly kind = "local" as const;
  readonly #root: string;

  constructor(filesDir: string) {
    this.#root = path.join(filesDir, ATTACHMENTS_DIRECTORY);
  }

  #path(key: string): string {
    assertObjectKey(key);
    return path.join(this.#root, ...key.split("/"));
  }

  async write(key: string, body: Readable): Promise<number> {
    const target = this.#path(key);
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.partial`;
    let size = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback: TransformCallback) {
        size += chunk.length;
        callback(null, chunk);
      },
    });
    try {
      await pipeline(body, counter, createWriteStream(temporary, { mode: 0o600, flags: "wx" }));
      const handle = await open(temporary, "r+");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    return size;
  }

  async read(key: string, range?: ByteRange): Promise<Readable> {
    const file = this.#path(key);
    await stat(file);
    return createReadStream(file, range ? { start: range.start, end: range.end } : {});
  }

  async size(key: string): Promise<number | null> {
    try {
      return (await stat(this.#path(key))).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.#path(key), { force: true });
  }

  async *list(prefix = ""): AsyncIterable<StoredObject> {
    const walk = async function* (directory: string, relative: string): AsyncIterable<StoredObject> {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const key = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) yield* walk(path.join(directory, entry.name), key);
        else if (entry.isFile() && !entry.name.endsWith(".partial") && key.startsWith(prefix)) {
          yield { key, size: (await stat(path.join(directory, entry.name))).size };
        }
      }
    };
    yield* walk(this.#root, "");
  }

  async replaceHead(key: string, head: Buffer): Promise<void> {
    const handle = await open(this.#path(key), "r+");
    try {
      await handle.write(head, 0, head.length, 0);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}

export class S3FileStore implements FileStore {
  readonly kind = "s3" as const;
  readonly #client: S3Client;
  readonly #bucket: string;
  readonly #prefix: string;

  constructor(config: Extract<FileStorageConfig, { kind: "s3" }>) {
    this.#bucket = config.bucket;
    this.#prefix = config.prefix;
    this.#client = new S3Client({
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      ...(config.accessKeyId && config.secretAccessKey
        ? {
            credentials: {
              accessKeyId: config.accessKeyId.reveal(),
              secretAccessKey: config.secretAccessKey.reveal(),
            },
          }
        : {}),
    });
  }

  #name(key: string): string {
    assertObjectKey(key);
    return `${this.#prefix}${ATTACHMENTS_DIRECTORY}/${key}`;
  }

  async write(key: string, body: Readable): Promise<number> {
    let size = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback: TransformCallback) {
        size += chunk.length;
        callback(null, chunk);
      },
    });
    const upload = new Upload({
      client: this.#client,
      params: { Bucket: this.#bucket, Key: this.#name(key), Body: counter },
      queueSize: 2,
      partSize: 8 * 1024 * 1024,
    });
    const piping = pipeline(body, counter);
    const uploading = upload.done();
    try {
      await Promise.all([piping, uploading]);
    } catch (error) {
      await upload.abort().catch(() => undefined);
      await Promise.allSettled([piping, uploading]);
      throw error;
    }
    return size;
  }

  async read(key: string, range?: ByteRange): Promise<Readable> {
    const result = await this.#client.send(
      new GetObjectCommand({
        Bucket: this.#bucket,
        Key: this.#name(key),
        ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
      }),
    );
    const body = result.Body;
    if (!body) throw new Error("The object has no content");
    return body instanceof Readable ? body : Readable.fromWeb(body.transformToWebStream() as never);
  }

  async size(key: string): Promise<number | null> {
    try {
      const head = await this.#client.send(
        new HeadObjectCommand({ Bucket: this.#bucket, Key: this.#name(key) }),
      );
      return head.ContentLength ?? 0;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: this.#name(key) }));
  }

  async *list(prefix = ""): AsyncIterable<StoredObject> {
    const base = `${this.#prefix}${ATTACHMENTS_DIRECTORY}/`;
    let token: string | undefined;
    do {
      const page = await this.#client.send(
        new ListObjectsV2Command({
          Bucket: this.#bucket,
          Prefix: `${base}${prefix}`,
          ...(token ? { ContinuationToken: token } : {}),
        }),
      );
      for (const object of page.Contents ?? []) {
        if (!object.Key) continue;
        yield { key: object.Key.slice(base.length), size: object.Size ?? 0 };
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }

  async replaceHead(key: string, head: Buffer): Promise<void> {
    const source = await this.read(key);
    let replaced = 0;
    const swap = new Transform({
      transform(chunk: Buffer, _encoding, callback: TransformCallback) {
        if (replaced < head.length) {
          const take = Math.min(head.length - replaced, chunk.length);
          head.copy(chunk, 0, replaced, replaced + take);
          replaced += take;
        }
        callback(null, chunk);
      },
    });
    await this.write(key, source.pipe(swap));
  }
}

export function createFileStore(config: FileStorageConfig, filesDir: string): FileStore {
  return config.kind === "s3" ? new S3FileStore(config) : new LocalFileStore(filesDir);
}
