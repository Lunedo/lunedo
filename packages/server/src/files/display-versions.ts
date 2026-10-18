import { Readable } from "node:stream";
import { sql } from "drizzle-orm";
import sharp from "sharp";
import type { Database, Executor } from "../database/database.js";
import type { Logger } from "../logging/logger.js";
import type { AttachmentContent } from "./attachments.js";
import {
  DISPLAY_VERSION_TYPES,
  type FileService,
  FileTooLargeError,
  MAX_DISPLAY_VERSION_PIXELS,
} from "./files.js";
import type { DisplayVersionSize } from "./schema.js";
import { MEGABYTE } from "./settings.js";

export const DISPLAY_VERSION_EDGES: Readonly<Record<DisplayVersionSize, number>> = {
  display: 2048,
  preview: 400,
};

export const MAX_DISPLAY_VERSION_SOURCE_BYTES = 256 * MEGABYTE;
export const MAX_DISPLAY_VERSION_ATTEMPTS = 3;
const ENCODE_TIMEOUT_SECONDS = 5 * 60;
const WEBP_QUALITY = 80;
const QUEUE_BATCH = 500;

sharp.cache(false);

function isAnimatedPng(data: Buffer): boolean {
  const animation = data.indexOf("acTL", 8, "latin1");
  return animation >= 0 && animation < data.indexOf("IDAT", 8, "latin1");
}

export type DisplayVersionOutcome = "done" | "none" | "tooLarge" | "failed" | "skipped";

export interface DisplayVersionFile {
  fileId: string;
  size: number;
  contentType: string;
}

interface Rendered {
  size: DisplayVersionSize;
  data: Buffer;
  width: number;
  height: number;
}

export class DisplayVersionService {
  readonly #database: Database;
  readonly #files: FileService;
  readonly #logger: Logger;

  constructor(options: { database: Database; files: FileService; logger: Logger }) {
    this.#database = options.database;
    this.#files = options.files;
    this.#logger = options.logger;
  }

  async find(
    sourceFileId: string,
    size: DisplayVersionSize,
    executor: Executor = this.#database,
  ): Promise<DisplayVersionFile | null> {
    const result = await executor.execute<{
      file_id: string;
      size: string | number;
      content_type: string;
    }>(sql`
      select d.file_id, f.size, f.content_type from display_versions d
      join stored_files f on f.id = d.file_id and f.state = 'ready'
      where d.source_file_id = ${sourceFileId} and d.size = ${size}`);
    const row = result.rows[0];
    return row ? { fileId: row.file_id, size: Number(row.size), contentType: row.content_type } : null;
  }

  async apply(
    content: AttachmentContent,
    size: DisplayVersionSize | undefined,
  ): Promise<AttachmentContent | null> {
    if (size === undefined || content.preview !== "image") return content;
    if (content.tooLargeForPreview) return null;
    const version = await this.find(content.fileId, size);
    if (!version) return content;
    return {
      ...content,
      fileId: version.fileId,
      size: version.size,
      contentType: version.contentType,
      name: `${content.name.replace(/\.[^./\\]*$/, "")}.webp`,
      displaySize: size,
    };
  }

  async queuePending(enqueue: (fileId: string) => Promise<void>): Promise<number> {
    let after = "00000000-0000-0000-0000-000000000000";
    let queued = 0;
    for (;;) {
      const result = await this.#database.execute<{ id: string }>(sql`
        select id from stored_files
        where display_version_state = 'pending' and state = 'ready' and id > ${after}
        order by id limit ${QUEUE_BATCH}`);
      for (const row of result.rows) {
        await enqueue(row.id);
        after = row.id;
        queued += 1;
      }
      if (result.rows.length < QUEUE_BATCH) return queued;
    }
  }

  async counts(): Promise<Record<"pending" | "done" | "none" | "failed", number>> {
    const result = await this.#database.execute<{ state: string; count: string | number }>(sql`
      select display_version_state as state, count(*) as count from stored_files
      where display_version_state is not null and state = 'ready' group by display_version_state`);
    const counts = { pending: 0, done: 0, none: 0, failed: 0 };
    for (const row of result.rows) {
      if (row.state in counts) counts[row.state as keyof typeof counts] = Number(row.count);
    }
    return counts;
  }

  async create(fileId: string, options: { lastAttempt: boolean }): Promise<DisplayVersionOutcome> {
    const claimed = await this.#database.execute<{
      attempts: number;
      content_type: string;
      size: string | number;
    }>(sql`
      update stored_files set display_version_attempts = display_version_attempts + 1
      where id = ${fileId} and state = 'ready' and display_version_state = 'pending'
      returning display_version_attempts as attempts, content_type, size`);
    const source = claimed.rows[0];
    if (!source) return "skipped";
    if (source.attempts > MAX_DISPLAY_VERSION_ATTEMPTS) {
      await this.#finish(fileId, "failed");
      this.#logger.warn(
        { fileId, attempts: source.attempts },
        "Display versions of an image failed for good",
      );
      return "failed";
    }
    if (!DISPLAY_VERSION_TYPES.has(source.content_type)) return this.#finish(fileId, "none");
    if (Number(source.size) > MAX_DISPLAY_VERSION_SOURCE_BYTES) {
      this.#logger.info({ fileId, size: Number(source.size) }, "Image too large for display versions");
      return this.#finish(fileId, "none");
    }
    try {
      const rendered = await this.#render(fileId);
      if (typeof rendered === "string") return this.#finish(fileId, rendered);
      return await this.#store(fileId, rendered);
    } catch (error) {
      if (!options.lastAttempt && source.attempts < MAX_DISPLAY_VERSION_ATTEMPTS) throw error;
      await this.#finish(fileId, "failed");
      this.#logger.warn({ err: error, fileId }, "Display versions of an image failed for good");
      return "failed";
    }
  }

  async #render(fileId: string): Promise<Rendered[] | "none" | "tooLarge"> {
    let input: Buffer;
    try {
      input = await this.#files.readAll(fileId, MAX_DISPLAY_VERSION_SOURCE_BYTES);
    } catch (error) {
      if (error instanceof FileTooLargeError) return "none";
      throw error;
    }
    const metadata = await sharp(input, { limitInputPixels: false }).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (width * height > MAX_DISPLAY_VERSION_PIXELS) {
      this.#logger.info({ fileId, width, height }, "Image has too many pixels for display versions");
      return "tooLarge";
    }
    if ((metadata.pages ?? 1) > 1 || isAnimatedPng(input)) return "none";
    const longest = Math.max(width, height);
    const rendered: Rendered[] = [];
    let source = input;
    for (const size of ["display", "preview"] as const) {
      const edge = DISPLAY_VERSION_EDGES[size];
      if (longest <= edge) continue;
      const output = await sharp(source, { limitInputPixels: MAX_DISPLAY_VERSION_PIXELS })
        .timeout({ seconds: ENCODE_TIMEOUT_SECONDS })
        .rotate()
        .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer({ resolveWithObject: true });
      rendered.push({ size, data: output.data, width: output.info.width, height: output.info.height });
      if (size === "display") source = output.data;
    }
    return rendered.length > 0 ? rendered : "none";
  }

  async #store(sourceFileId: string, rendered: Rendered[]): Promise<DisplayVersionOutcome> {
    const written: { size: DisplayVersionSize; id: string; width: number; height: number }[] = [];
    try {
      for (const version of rendered) {
        const stored = await this.#files.write(Readable.from([version.data]), {
          name: `${version.size}.webp`,
          maxBytes: version.data.length,
        });
        written.push({ size: version.size, id: stored.id, width: version.width, height: version.height });
      }
      const outcome = await this.#database.transaction(async (tx) => {
        const source = await tx.execute(sql`
          select id from stored_files
          where id = ${sourceFileId} and state = 'ready' and display_version_state = 'pending'
          for update`);
        if (source.rows.length === 0) return "skipped" as const;
        for (const version of written) {
          await this.#files.commit(tx, version.id);
          await tx.execute(sql`
            insert into display_versions (source_file_id, size, file_id, width, height)
            values (${sourceFileId}, ${version.size}, ${version.id}, ${version.width}, ${version.height})`);
        }
        await tx.execute(sql`
          update stored_files set display_version_state = 'done', updated_at = now() where id = ${sourceFileId}`);
        return "done" as const;
      });
      if (outcome === "skipped") await this.#release(written.map((version) => version.id));
      return outcome;
    } catch (error) {
      await this.#release(written.map((version) => version.id));
      throw error;
    }
  }

  async #release(fileIds: string[]): Promise<void> {
    if (fileIds.length === 0) return;
    await this.#database.execute(sql`
      update stored_files set state = 'orphaned', updated_at = now()
      where id = any(${sql.param(fileIds)}::uuid[]) and state in ('pending', 'stored')`);
  }

  async #finish(fileId: string, state: "none" | "tooLarge" | "failed"): Promise<DisplayVersionOutcome> {
    await this.#database.execute(sql`
      update stored_files set display_version_state = ${state}, updated_at = now()
      where id = ${fileId} and display_version_state = 'pending'`);
    return state;
  }
}
