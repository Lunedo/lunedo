import type { Hmac } from "node:crypto";
import { pipeline as chain, type Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import type { EncryptedStream, EncryptedStreamOwner } from "../crypto/encrypted-stream.js";
import type { KeyRingHolder } from "../crypto/key-ring-holder.js";
import {
  createChunkDecryptStream,
  createDecryptStream,
  createEncryptStream,
  DEFAULT_CHUNK_SIZE,
  encryptedChunkOffset,
  encryptedChunkSize,
  masterStreamKeys,
  rewrapStreamHeader,
  STREAM_HEADER_LENGTH,
  streamMasterKeyVersion,
} from "../crypto/stream.js";
import type { Database, Executor } from "../database/database.js";
import type { Logger } from "../logging/logger.js";
import type { ValueSigner } from "../sharing/signer.js";
import type { StorageUsage } from "../storage/usage.js";
import { type DetectedType, detectType, SNIFF_BYTES } from "./sniff.js";
import type { ByteRange, FileStore } from "./store.js";

export class FileTooLargeError extends Error {
  override name = "FileTooLargeError";

  constructor(readonly limit: number) {
    super(`The file is larger than ${limit} bytes`);
  }
}

export interface StoredFile {
  id: string;
  size: number;
  digest: string;
  type: DetectedType;
}

const CONTENT_DIGEST_PURPOSE = "file-content";

const COMPLETE = sql`state <> 'pending'`;

class Inspector extends Transform {
  readonly #limit: number;
  readonly #mac: Hmac;
  head: Buffer[] = [];
  headLength = 0;
  size = 0;

  constructor(limit: number, mac: Hmac) {
    super();
    this.#limit = limit;
    this.#mac = mac;
  }

  digest(): Buffer {
    return this.#mac.digest();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.size += chunk.length;
    if (this.size > this.#limit) {
      callback(new FileTooLargeError(this.#limit));
      return;
    }
    if (this.headLength < SNIFF_BYTES) {
      const part = chunk.subarray(0, SNIFF_BYTES - this.headLength);
      this.head.push(Buffer.from(part));
      this.headLength += part.length;
    }
    this.#mac.update(chunk);
    callback(null, chunk);
  }
}

function associatedData(fileId: string): Buffer {
  return Buffer.from(`pagehall-file:${fileId}`, "utf8");
}

function storageKey(fileId: string): string {
  const compact = fileId.replace(/-/g, "");
  return `${compact.slice(-2)}/${compact.slice(-4, -2)}/${fileId}`;
}

export class FileService {
  readonly #database: Database;
  readonly #store: FileStore;
  readonly #keyRing: KeyRingHolder;
  readonly #logger: Logger;
  readonly #signer: ValueSigner;
  readonly #usage: StorageUsage | undefined;

  constructor(options: {
    database: Database;
    store: FileStore;
    keyRing: KeyRingHolder;
    logger: Logger;
    signer: ValueSigner;
    usage?: StorageUsage;
  }) {
    this.#database = options.database;
    this.#store = options.store;
    this.#keyRing = options.keyRing;
    this.#logger = options.logger;
    this.#signer = options.signer;
    this.#usage = options.usage;
  }

  get store(): FileStore {
    return this.#store;
  }

  #keys() {
    return masterStreamKeys(() => this.#keyRing.ring);
  }

  async write(body: Readable, options: { name: string; maxBytes: number }): Promise<StoredFile> {
    const id = uuidv7();
    const key = storageKey(id);
    const version = this.#keyRing.ring.currentVersion;
    const mac = await this.#signer.mac(CONTENT_DIGEST_PURPOSE);
    await this.#database.execute(sql`
      insert into stored_files (id, storage_key, master_key_version, state) values (${id}, ${key}, ${version}, 'pending')`);
    const inspector = new Inspector(options.maxBytes, mac);
    const encrypt = createEncryptStream(this.#keys(), {
      chunkSize: DEFAULT_CHUNK_SIZE,
      associatedData: associatedData(id),
    });
    let keyVersion: number;
    let counted = 0;
    try {
      let failure: Error | null = null;
      const encrypted = chain(body, inspector, encrypt, (error) => {
        failure = error ?? null;
      });
      const stored = await this.#store.write(key, encrypted).catch((error: unknown) => {
        throw failure ?? error;
      });
      await this.#usage?.add(stored);
      counted = stored;
      if (failure) throw failure;
      keyVersion = await this.#rewrapIfOutdated(key, version);
    } catch (error) {
      await this.#discard(id, key, counted);
      throw error;
    }
    const head = Buffer.concat(inspector.head);
    const type = detectType(head, { name: options.name, truncated: inspector.size > head.length });
    const digest = inspector.digest();
    await this.#database.execute(sql`
      update stored_files set size = ${inspector.size}, content_digest = ${digest},
        content_type = ${type.contentType}, master_key_version = ${keyVersion}, state = 'stored', updated_at = now()
      where id = ${id}`);
    return { id, size: inspector.size, digest: digest.toString("hex"), type };
  }

  async #rewrapIfOutdated(key: string, version: number): Promise<number> {
    const current = this.#keyRing.ring.currentVersion;
    if (version === current) return version;
    const header = await this.#readHead(key);
    const used = streamMasterKeyVersion(header);
    if (used === undefined) throw new Error("The stored file has no valid encryption header");
    if (used === current) return used;
    const rewrapped = rewrapStreamHeader(header, this.#keys());
    await this.#store.replaceHead(key, rewrapped);
    return streamMasterKeyVersion(rewrapped) ?? current;
  }

  async reuse(tx: Executor, file: StoredFile, spaceId: string): Promise<string> {
    const result = await tx.execute<{ id: string }>(sql`
      select f.id from stored_files f
      where f.content_digest = ${Buffer.from(file.digest, "hex")} and f.size = ${file.size}
        and f.content_type = ${file.type.contentType} and f.state = 'ready' and f.id <> ${file.id}
        and exists (
          select 1 from attachment_versions v join attachments a on a.id = v.attachment_id
          join tree_items t on t.id = a.item_id
          where v.file_id = f.id and t.space_id = ${spaceId})
      order by f.id limit 1
      for update of f`);
    const used = result.rows[0]?.id ?? file.id;
    const claimed = await tx.execute(sql`
      update stored_files
      set state = case when id = ${used} then 'ready'::stored_file_state else 'orphaned'::stored_file_state end,
        updated_at = now()
      where id = ${file.id} and state = 'stored'
      returning id`);
    if (claimed.rows.length === 0) throw new Error("The uploaded file was removed before it was saved");
    return used;
  }

  async commit(tx: Executor, fileId: string): Promise<void> {
    const claimed = await tx.execute(sql`
      update stored_files set state = 'ready', updated_at = now() where id = ${fileId} and state = 'stored'
      returning id`);
    if (claimed.rows.length === 0) throw new Error("The uploaded file was removed before it was saved");
  }

  async #discard(id: string, key: string, stored: number): Promise<void> {
    try {
      await this.#store.delete(key);
      await this.#usage?.add(-stored);
      await this.#database.execute(sql`delete from stored_files where id = ${id} and state = 'pending'`);
    } catch (error) {
      this.#logger.warn({ err: error, fileId: id }, "Removing an incomplete upload failed");
    }
  }

  async #row(executor: Executor, fileId: string): Promise<{ storage_key: string; size: number }> {
    const result = await executor.execute<{ storage_key: string; size: string | number }>(
      sql`select storage_key, size from stored_files where id = ${fileId} and state = 'ready'`,
    );
    const row = result.rows[0];
    if (!row) throw new Error("The stored file does not exist");
    return { storage_key: row.storage_key, size: Number(row.size) };
  }

  async read(fileId: string, range?: ByteRange): Promise<Readable> {
    const row = await this.#row(this.#database, fileId);
    if (!range || row.size === 0) {
      const source = await this.#store.read(row.storage_key);
      return source.pipe(createDecryptStream(this.#keys(), { associatedData: associatedData(fileId) }));
    }
    const head = await this.#readHead(row.storage_key);
    const chunkSize = encryptedChunkSize(head);
    const firstChunk = Math.floor(range.start / chunkSize);
    const lastChunk = Math.floor(range.end / chunkSize);
    const totalChunks = Math.max(1, Math.ceil(row.size / chunkSize));
    const reachesEnd = lastChunk >= totalChunks - 1;
    const from = encryptedChunkOffset(chunkSize, firstChunk);
    const encryptedSize = await this.#store.size(row.storage_key);
    const to = reachesEnd ? (encryptedSize ?? 0) - 1 : encryptedChunkOffset(chunkSize, lastChunk + 1) - 1;
    const source = await this.#store.read(row.storage_key, { start: from, end: to });
    const decrypt = createChunkDecryptStream(this.#keys(), head, {
      associatedData: associatedData(fileId),
      firstChunk,
      partial: !reachesEnd,
    });
    let skip = range.start - firstChunk * chunkSize;
    let remaining = range.end - range.start + 1;
    const slice = new Transform({
      transform(chunk: Buffer, _encoding, callback: TransformCallback) {
        let part = chunk;
        if (skip > 0) {
          const dropped = Math.min(skip, part.length);
          part = part.subarray(dropped);
          skip -= dropped;
        }
        if (remaining <= 0) {
          callback();
          return;
        }
        if (part.length > remaining) part = part.subarray(0, remaining);
        remaining -= part.length;
        callback(null, part);
      },
    });
    return source.pipe(decrypt).pipe(slice);
  }

  #readHead(key: string): Promise<Buffer> {
    return readStoredHead(this.#store, key);
  }

  async readAll(fileId: string, maxBytes: number): Promise<Buffer> {
    const parts: Buffer[] = [];
    let size = 0;
    const source = await this.read(fileId);
    for await (const chunk of source) {
      size += (chunk as Buffer).length;
      if (size > maxBytes) {
        source.destroy();
        throw new FileTooLargeError(maxBytes);
      }
      parts.push(chunk as Buffer);
    }
    return Buffer.concat(parts);
  }

  async deleteOrphaned(limit = 200): Promise<number> {
    const result = await this.#database.execute<{ id: string; storage_key: string }>(sql`
      select id, storage_key from stored_files
      where state = 'orphaned' or (state in ('pending', 'stored') and updated_at < now() - interval '1 day')
      order by updated_at limit ${limit}`);
    await this.#database.execute(sql`
      update stored_files f set state = 'ready', updated_at = now()
      where f.state = 'orphaned' and exists (select 1 from attachment_versions v where v.file_id = f.id)`);
    let removed = 0;
    for (const row of result.rows) {
      const claimed = await this.#database.execute(sql`
        update stored_files set state = 'orphaned', updated_at = now() where id = ${row.id}
          and (state = 'orphaned' or (state in ('pending', 'stored') and updated_at < now() - interval '1 day'))
          and not exists (select 1 from attachment_versions v where v.file_id = ${row.id})
        returning id`);
      if (claimed.rows.length === 0) continue;
      const stored = (await this.#store.size(row.storage_key)) ?? 0;
      await this.#store.delete(row.storage_key);
      await this.#usage?.add(-stored);
      await this.#database.execute(sql`delete from stored_files where id = ${row.id}`);
      removed += 1;
    }
    return removed;
  }

  streamOwner(): EncryptedStreamOwner {
    return fileStreamOwner(this.#store);
  }

  async verify(fileId: string): Promise<void> {
    await pipeline(
      await this.read(fileId),
      new Transform({ transform: (_chunk, _encoding, done) => done() }),
    );
  }
}

export function fileStreamOwner(store: FileStore): EncryptedStreamOwner {
  const readHead = (key: string) => readStoredHead(store, key);
  return {
    name: "attachments",
    versions: async (context) => {
      const result = await context.database.execute<{ version: number; count: string }>(sql`
        select master_key_version as version, count(*) as count from stored_files
        where master_key_version is not null and ${COMPLETE} group by master_key_version`);
      return Object.fromEntries(result.rows.map((row) => [Number(row.version), Number(row.count)]));
    },
    async *streams(context, targetVersion) {
      let after = "00000000-0000-0000-0000-000000000000";
      for (;;) {
        const rows = await context.database.execute<{ id: string; storage_key: string }>(sql`
          select id, storage_key from stored_files
          where ${COMPLETE} and id > ${after}
            and master_key_version is distinct from ${targetVersion ?? null}
          order by id limit 100`);
        if (rows.rows.length === 0) return;
        for (const row of rows.rows) {
          after = row.id;
          const record = async (header: Buffer) => {
            await context.database.execute(sql`
              update stored_files set master_key_version = ${streamMasterKeyVersion(header) ?? null},
                updated_at = now()
              where id = ${row.id}`);
          };
          const stream: EncryptedStream = {
            id: row.id,
            async readHeader() {
              const header = await readHead(row.storage_key);
              await record(header);
              return header;
            },
            async writeHeader(header: Buffer) {
              await store.replaceHead(row.storage_key, header);
              await record(header);
            },
          };
          yield stream;
        }
      }
    },
  };
}

async function readStoredHead(store: FileStore, key: string): Promise<Buffer> {
  const stream = await store.read(key, { start: 0, end: STREAM_HEADER_LENGTH - 1 });
  const parts: Buffer[] = [];
  for await (const chunk of stream) parts.push(chunk as Buffer);
  return Buffer.concat(parts);
}
