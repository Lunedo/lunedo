import { createHash } from "node:crypto";
import { PassThrough, type Readable, Transform, type TransformCallback } from "node:stream";
import { uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database, Executor } from "../database/database.js";
import { type FileService, FileTooLargeError } from "../files/files.js";
import { cleanFileName } from "../files/names.js";
import { MEGABYTE } from "../files/settings.js";
import type { SettingsService } from "../settings/service.js";
import { actorIdOf } from "../spaces/common.js";
import type { StorageService } from "../storage/storage.js";
import { ImportError } from "./errors.js";
import { type BundledFile, type ByteBundle, type ByteSource, bundleOf } from "./formats/bytes.js";
import { maxOrganizationSetting, maxUploadSetting } from "./settings.js";

export const UPLOAD_PART_BYTES = 16 * MEGABYTE;
const UPLOAD_LIFETIME_DAYS = 7;
const SHA256 = /^[0-9a-f]{64}$/;

export interface UploadPart {
  readonly number: number;
  readonly size: number;
}

export interface ImportUpload {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly size: number;
  readonly partSize: number;
  readonly partCount: number;
  readonly parts: readonly UploadPart[];
  readonly complete: boolean;
  readonly expiresAt: Date;
}

type UploadRow = Record<string, unknown> & {
  id: string;
  organization_id: string;
  created_by: string | null;
  name: string;
  size: string | number;
  part_size: number;
  complete: boolean;
  digest: string | null;
  expires_at: Date | string;
};

export class UploadTooLargeError extends ImportError {
  constructor(readonly maxBytes: number) {
    super("uploadTooLarge", `The file is larger than ${Math.floor(maxBytes / MEGABYTE)} MB.`, { maxBytes });
  }
}

export class OrganizationImportLimitError extends ImportError {
  constructor(usedBytes: number, maxBytes: number) {
    super(
      "organizationImportLimit",
      `The imports of this organization use ${Math.ceil(usedBytes / MEGABYTE)} of ${Math.floor(maxBytes / MEGABYTE)} MB. Delete drafts, discard or accept earlier imports, or ask the instance administrators to raise the limit.`,
      { maxBytes, usedBytes },
    );
  }
}

export async function importStorageUsed(executor: Executor, organizationId: string): Promise<number> {
  const result = await executor.execute<{ used: string | number | null }>(sql`
    select coalesce((select sum(size) from import_uploads where organization_id = ${organizationId}), 0)
      + coalesce((select sum(staged_bytes) from imports where organization_id = ${organizationId}
          and state not in ('accepted', 'discarded', 'stopped', 'superseded')), 0) as used`);
  return Number(result.rows[0]?.used ?? 0);
}

export async function lockImportStorage(executor: Executor, organizationId: string): Promise<void> {
  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`pagehall.importStorage:${organizationId}`}, 0))`,
  );
}

export async function releaseUploads(
  executor: Executor,
  input: { importId: string; uploadId: string | null; days: number; keepEarlier?: boolean },
): Promise<void> {
  const expiry = sql`now() + make_interval(days => ${input.days})`;
  await executor.execute(sql`
    update import_uploads set expires_at = ${input.keepEarlier ? sql`least(expires_at, ${expiry})` : expiry}
    where id = ${input.uploadId}
      or id in (select upload_id from import_files where import_id = ${input.importId})`);
}

export function cleanUploadName(name: string): string {
  const cleaned = cleanFileName(name);
  if (!cleaned) {
    throw new ImportError("invalidFileName", "The file needs a name.");
  }
  return cleaned;
}

class Hashing extends Transform {
  readonly hash = createHash("sha256");

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.hash.update(chunk);
    callback(null, chunk);
  }
}

export function combinedDigest(partDigests: readonly string[]): string {
  const hash = createHash("sha256");
  for (const digest of partDigests) hash.update(digest);
  return hash.digest("hex");
}

export class UploadService {
  readonly #database: Database;
  readonly #files: FileService;
  readonly #settings: SettingsService;
  readonly #authorization: AuthorizationService;
  readonly #storage: StorageService;

  constructor(options: {
    database: Database;
    files: FileService;
    settings: SettingsService;
    authorization: AuthorizationService;
    storage: StorageService;
  }) {
    this.#database = options.database;
    this.#files = options.files;
    this.#settings = options.settings;
    this.#authorization = options.authorization;
    this.#storage = options.storage;
  }

  async maxBytes(): Promise<number> {
    return (await this.#settings.get(maxUploadSetting, {})) * MEGABYTE;
  }

  async organizationMaxBytes(): Promise<number> {
    return (await this.#settings.get(maxOrganizationSetting, {})) * MEGABYTE;
  }

  async requireRoom(executor: Executor, organizationId: string, bytes: number): Promise<void> {
    const limit = await this.organizationMaxBytes();
    const used = await importStorageUsed(executor, organizationId);
    if (used + bytes > limit) throw new OrganizationImportLimitError(used, limit);
  }

  async create(
    actor: Principal,
    organizationId: string,
    input: { name: string; size: number },
  ): Promise<ImportUpload> {
    await this.#authorization.require(actor, "organization.imports.manage", {
      type: "organization",
      id: organizationId,
    });
    const name = cleanUploadName(input.name);
    if (!Number.isSafeInteger(input.size) || input.size <= 0) {
      throw new ImportError("invalidUpload", "The file is empty.");
    }
    const limit = await this.maxBytes();
    if (input.size > limit) throw new UploadTooLargeError(limit);
    await this.#storage.requireLargeWrite(input.size);
    const row = await this.#database.transaction(async (tx) => {
      await lockImportStorage(tx, organizationId);
      await this.requireRoom(tx, organizationId, input.size);
      const result = await tx.execute<UploadRow>(sql`
        insert into import_uploads (id, organization_id, created_by, name, size, part_size, expires_at)
        values (${uuidv7()}, ${organizationId}, ${actorIdOf(actor)}, ${name}, ${input.size}, ${UPLOAD_PART_BYTES},
          now() + make_interval(days => ${UPLOAD_LIFETIME_DAYS}))
        returning *`);
      return result.rows[0];
    });
    if (!row) throw new Error("The upload was not created");
    return this.#toUpload(row, []);
  }

  async get(actor: Principal, uploadId: string): Promise<ImportUpload> {
    const row = await this.#owned(actor, uploadId);
    return this.#toUpload(row, await this.#parts(uploadId));
  }

  async putPart(
    actor: Principal,
    uploadId: string,
    number: number,
    input: { body: Readable; sha256: string; contentLength?: number | undefined },
  ): Promise<UploadPart> {
    const row = await this.#owned(actor, uploadId);
    if (row.complete) throw new ImportError("uploadComplete", "The upload is already complete.");
    const size = Number(row.size);
    const count = Math.ceil(size / row.part_size);
    if (!Number.isInteger(number) || number < 1 || number > count) {
      throw new ImportError("invalidUploadPart", `The part number must be between 1 and ${count}.`);
    }
    const expected = number === count ? size - (count - 1) * row.part_size : row.part_size;
    const sha256 = input.sha256.toLowerCase();
    if (!SHA256.test(sha256))
      throw new ImportError("invalidUploadPart", "The part checksum is not a SHA-256 value.");
    if (input.contentLength !== undefined && input.contentLength !== expected) {
      input.body.resume();
      throw new ImportError("invalidUploadPart", `The part must be exactly ${expected} bytes long.`);
    }
    try {
      await this.#storage.requireLargeWrite(expected);
    } catch (error) {
      input.body.resume();
      throw error;
    }
    const hashing = new Hashing();
    input.body.on("error", (error) => hashing.destroy(error));
    input.body.pipe(hashing);
    let stored: Awaited<ReturnType<FileService["write"]>>;
    try {
      stored = await this.#files.write(hashing, { name: `import-part-${number}`, maxBytes: expected });
    } catch (error) {
      if (error instanceof FileTooLargeError) {
        throw new ImportError("invalidUploadPart", `The part must be exactly ${expected} bytes long.`);
      }
      throw error;
    }
    const digest = hashing.hash.digest("hex");
    if (stored.size !== expected || digest !== sha256) {
      await this.#database.execute(sql`update stored_files set state = 'orphaned' where id = ${stored.id}`);
      throw new ImportError(
        "uploadChecksumMismatch",
        stored.size !== expected
          ? `The part must be exactly ${expected} bytes long.`
          : "The part arrived damaged; its checksum does not match.",
      );
    }
    await this.#database.transaction(async (tx) => {
      await tx.execute(sql`select id from import_uploads where id = ${uploadId} for update`);
      await tx.execute(
        sql`delete from import_upload_parts where upload_id = ${uploadId} and number = ${number}`,
      );
      await this.#files.commit(tx, stored.id);
      await tx.execute(sql`
        insert into import_upload_parts (upload_id, number, file_id, size, sha256)
        values (${uploadId}, ${number}, ${stored.id}, ${stored.size}, ${digest})`);
      await tx.execute(sql`
        update import_uploads set expires_at = now() + make_interval(days => ${UPLOAD_LIFETIME_DAYS}), updated_at = now()
        where id = ${uploadId}`);
    });
    return { number, size: stored.size };
  }

  async complete(actor: Principal, uploadId: string, input: { sha256: string }): Promise<ImportUpload> {
    const row = await this.#owned(actor, uploadId);
    const parts = await this.#partRows(uploadId);
    const count = Math.ceil(Number(row.size) / row.part_size);
    if (parts.length !== count || parts.some((part, index) => part.number !== index + 1)) {
      throw new ImportError("uploadIncomplete", "Some parts of the file are missing. Continue the upload.", {
        missing: count - parts.length,
      });
    }
    const verified: string[] = [];
    for (const part of parts) {
      const hash = createHash("sha256");
      for await (const chunk of await this.#files.read(part.file_id)) hash.update(chunk as Buffer);
      verified.push(hash.digest("hex"));
    }
    const digest = combinedDigest(verified);
    const stored = parts.map((part) => part.sha256);
    if (digest !== input.sha256.toLowerCase() || combinedDigest(stored) !== digest) {
      throw new ImportError(
        "uploadChecksumMismatch",
        "The uploaded file does not match the file on your computer. Upload it again.",
      );
    }
    await this.#database.execute(sql`
      update import_uploads set complete = true, digest = ${digest}, updated_at = now() where id = ${uploadId}`);
    return this.#toUpload(
      { ...row, complete: true, digest },
      parts.map((part) => ({ number: part.number, size: part.size })),
    );
  }

  async remove(actor: Principal, uploadId: string): Promise<void> {
    await this.#owned(actor, uploadId);
    await this.#database.execute(sql`
      delete from import_uploads u where u.id = ${uploadId}
        and not exists (select 1 from imports i where i.state not in ('draft', 'ready')
          and (i.upload_id = u.id
            or exists (select 1 from import_files f where f.import_id = i.id and f.upload_id = u.id)))`);
  }

  async source(uploadId: string): Promise<ByteSource> {
    const result = await this.#database.execute<UploadRow>(
      sql`select * from import_uploads where id = ${uploadId} and complete`,
    );
    const row = result.rows[0];
    if (!row) throw new ImportError("uploadIncomplete", "The upload is not complete.");
    const parts = await this.#partRows(uploadId);
    const files = this.#files;
    const partSize = row.part_size;
    return {
      size: Number(row.size),
      async read(start, end): Promise<Readable> {
        const output = new PassThrough();
        (async () => {
          let position = start;
          while (position < end) {
            const index = Math.floor(position / partSize);
            const part = parts[index];
            if (!part) throw new ImportError("uploadIncomplete", "A part of the upload is missing.");
            const offset = position - index * partSize;
            const last = Math.min(end - index * partSize, part.size) - 1;
            const stream = await files.read(part.file_id, { start: offset, end: last });
            for await (const chunk of stream) {
              if (!output.write(chunk)) await new Promise((resolve) => output.once("drain", resolve));
            }
            position = index * partSize + last + 1;
          }
          output.end();
        })().catch((error: unknown) => output.destroy(error as Error));
        return output;
      },
      async close() {},
    };
  }

  async bundle(importId: string): Promise<ByteBundle> {
    const result = await this.#database.execute<{ id: string; name: string; complete: boolean }>(sql`
      select u.id, u.name, u.complete from import_files f join import_uploads u on u.id = f.upload_id
      where f.import_id = ${importId} order by f.position`);
    if (result.rows.length === 0) throw new ImportError("fileMissing", "Choose the files first.");
    if (result.rows.some((row) => !row.complete)) {
      throw new ImportError("uploadIncomplete", "The upload is not complete.");
    }
    const files: BundledFile[] = [];
    for (const row of result.rows) files.push({ name: row.name, source: await this.source(row.id) });
    return bundleOf(files);
  }

  async removeExpired(limit = 50): Promise<number> {
    const result = await this.#database.execute<{ id: string }>(sql`
      delete from import_uploads u
      where u.id in (
        select u2.id from import_uploads u2
        where u2.expires_at < now()
          and not exists (
            select 1 from imports i where (i.upload_id = u2.id
                or exists (select 1 from import_files f where f.import_id = i.id and f.upload_id = u2.id))
              and (i.state in ('analyzing', 'ready', 'running', 'held', 'stopping', 'review', 'accepting', 'discarding')
                or (i.file_expires_at is not null and i.file_expires_at > now())))
        limit ${limit})
      returning u.id`);
    return result.rows.length;
  }

  async #owned(actor: Principal, uploadId: string): Promise<UploadRow> {
    const result = await this.#database.execute<UploadRow>(
      sql`select * from import_uploads where id = ${uploadId}`,
    );
    const row = result.rows[0];
    if (!row || row.created_by !== actorIdOf(actor)) {
      throw new ImportError("uploadNotFound", "The upload does not exist.");
    }
    await this.#authorization.require(actor, "organization.imports.manage", {
      type: "organization",
      id: row.organization_id,
    });
    return row;
  }

  async #partRows(uploadId: string) {
    const result = await this.#database.execute<{
      number: number;
      size: number;
      file_id: string;
      sha256: string;
    }>(sql`
      select number, size, file_id, sha256 from import_upload_parts where upload_id = ${uploadId} order by number`);
    return result.rows;
  }

  async #parts(uploadId: string): Promise<UploadPart[]> {
    return (await this.#partRows(uploadId)).map((part) => ({ number: part.number, size: part.size }));
  }

  #toUpload(row: UploadRow, parts: readonly UploadPart[]): ImportUpload {
    const size = Number(row.size);
    return {
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      size,
      partSize: row.part_size,
      partCount: Math.ceil(size / row.part_size),
      parts,
      complete: row.complete,
      expiresAt: new Date(row.expires_at),
    };
  }
}
