import { Readable } from "node:stream";
import {
  type CopiedAttachment,
  type DocumentJson,
  documentAttachments,
  rewriteFileReferences,
} from "@pagehall/editor-schema";
import { MAX_SCENE_BYTES } from "@pagehall/editor-schema/scene";
import { uuidv7 } from "@pagehall/shared";
import { type SQL, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import { readDrawingUpload, sanitizerSlots } from "../diagrams/markup.js";
import { type AttachmentContent, previewOf } from "../files/attachments.js";
import { type FileService, FileTooLargeError, type StoredFile } from "../files/files.js";
import { cleanFileName, fileNameKey } from "../files/names.js";
import { MEGABYTE } from "../files/settings.js";
import { detectType, SNIFF_BYTES } from "../files/sniff.js";
import { actorIdOf, SpaceError } from "../spaces/common.js";
import type { StorageService } from "../storage/storage.js";
import { readText } from "../whiteboards/common.js";
import { drawingFileNames } from "../whiteboards/drawings.js";
import { attachmentScenes, copyDrawingScenes, sceneImageIds } from "../whiteboards/scene-copies.js";
import { sanitizeSvg } from "../whiteboards/svg.js";

export const TEMPLATE_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);
export const TEMPLATE_IMAGE_MAX_BYTES = 5 * MEGABYTE;

export interface TemplateFile {
  id: string;
  templateId: string;
  name: string;
  size: number;
  contentType: string;
}

export interface AdoptedFiles {
  document: DocumentJson;
  adopted: number;
  missing: number;
}

type FileRow = {
  id: string;
  template_id: string;
  name: string;
  size: string | number;
  content_type: string;
  file_id: string;
};

function toFile(row: FileRow): TemplateFile {
  return {
    id: row.id,
    templateId: row.template_id,
    name: row.name,
    size: Number(row.size),
    contentType: row.content_type,
  };
}

export function uniqueFileName(name: string, taken: Set<string>): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  let candidate = name;
  for (let attempt = 2; taken.has(fileNameKey(candidate)); attempt += 1) {
    const suffix = ` (${attempt})`;
    candidate = `${base.slice(0, 255 - extension.length - suffix.length)}${suffix}${extension}`;
  }
  taken.add(fileNameKey(candidate));
  return candidate;
}

export function templateImageBytes(bytes: Buffer, name: string): { bytes: Buffer; contentType: string } {
  const head = bytes.subarray(0, SNIFF_BYTES);
  const type = detectType(head, { name, truncated: bytes.length > head.length }).contentType;
  if (!TEMPLATE_IMAGE_TYPES.has(type)) {
    throw new SpaceError(
      "unsupportedTemplateFile",
      "Templates can hold PNG, JPEG, GIF, WebP and SVG images only. Choose an image in one of these formats.",
    );
  }
  if (type !== "image/svg+xml") return { bytes, contentType: type };
  return { bytes: Buffer.from(sanitizeSvg(bytes.toString("utf8")), "utf8"), contentType: type };
}

export class TemplateFileService {
  readonly #database: Database;
  readonly #files: FileService;
  readonly #storage: StorageService;

  constructor(options: { database: Database; files: FileService; storage: StorageService }) {
    this.#database = options.database;
    this.#files = options.files;
    this.#storage = options.storage;
  }

  get files(): FileService {
    return this.#files;
  }

  async list(templateId: string, executor: Executor = this.#database): Promise<TemplateFile[]> {
    const result = await executor.execute<FileRow>(sql`
      select tf.id, tf.template_id, tf.name, f.size, f.content_type, tf.file_id
      from template_files tf join stored_files f on f.id = tf.file_id
      where tf.template_id = ${templateId}
      order by lower(tf.name), tf.id`);
    return result.rows.map(toFile);
  }

  async content(templateId: string, fileId: string): Promise<AttachmentContent | null> {
    const result = await this.#database.execute<FileRow>(sql`
      select tf.id, tf.template_id, tf.name, f.size, f.content_type, tf.file_id
      from template_files tf join stored_files f on f.id = tf.file_id and f.state = 'ready'
      where tf.template_id = ${templateId} and tf.id = ${fileId}`);
    const row = result.rows[0];
    if (!row) return null;
    return {
      attachmentId: row.id,
      fileId: row.file_id,
      name: row.name,
      size: Number(row.size),
      contentType: row.content_type,
      ...previewOf(row.content_type, row.name),
      version: 1,
      versionId: row.id,
    };
  }

  async store(bytes: Buffer, name: string, maxBytes: number): Promise<StoredFile> {
    return this.#files.write(Readable.from([bytes]), { name, maxBytes, attachment: true });
  }

  async attach(
    tx: Transaction,
    input: { templateId: string; stored: StoredFile; name: string; actorId: string | null },
  ): Promise<string> {
    await this.#files.commit(tx, input.stored.id);
    const id = uuidv7();
    await tx.execute(sql`
      insert into template_files (id, template_id, file_id, name, created_by)
      values (${id}, ${input.templateId}, ${input.stored.id}, ${input.name}, ${input.actorId})`);
    return id;
  }

  async release(stored: StoredFile): Promise<void> {
    await this.#database.execute(sql`
      update stored_files set state = 'orphaned', updated_at = now()
      where id = ${stored.id} and state = 'stored'`);
  }

  async upload(
    actor: Principal,
    templateId: string,
    input: { name: string; body: Readable; contentLength?: number | undefined },
  ): Promise<TemplateFile> {
    const name = cleanFileName(input.name);
    if (!name) {
      input.body.resume();
      throw new SpaceError("invalidFileName", "The file needs a name");
    }
    if (input.contentLength !== undefined && input.contentLength > TEMPLATE_IMAGE_MAX_BYTES) {
      input.body.resume();
      throw new FileTooLargeError(TEMPLATE_IMAGE_MAX_BYTES);
    }
    try {
      await this.#storage.requireUpload();
    } catch (error) {
      input.body.resume();
      throw error;
    }
    const bytes = await readDrawingUpload(actor, input.body, TEMPLATE_IMAGE_MAX_BYTES);
    const stored = await sanitizerSlots.run(actor, async () =>
      this.store(templateImageBytes(bytes, name).bytes, name, TEMPLATE_IMAGE_MAX_BYTES),
    );
    try {
      const id = await this.#database.transaction(async (tx) => {
        const template = await tx.execute(
          sql`select id from page_templates where id = ${templateId} for update`,
        );
        if (template.rows.length === 0)
          throw new SpaceError("templateNotFound", "The template does not exist");
        return this.attach(tx, { templateId, stored, name, actorId: actorIdOf(actor) });
      });
      const file = (await this.list(templateId)).find((candidate) => candidate.id === id);
      if (!file) throw new Error("The template file was not stored");
      return file;
    } catch (error) {
      await this.release(stored);
      throw error;
    }
  }

  async adopt(
    tx: Transaction,
    input: { templateId: string; actorId: string | null; document: DocumentJson; source: SQL },
  ): Promise<AdoptedFiles> {
    const references = documentAttachments(input.document);
    const ids = [...new Set(references.map((reference) => reference.id))];
    if (ids.length === 0) return { document: input.document, adopted: 0, missing: 0 };
    const result = await tx.execute<{
      attachment_id: string;
      number: number;
      current: boolean;
      file_id: string;
      name: string;
    }>(sql`
      select a.id as attachment_id, v.number, v.id = a.current_version_id as current, v.file_id, v.name
      from attachments a join attachment_versions v on v.attachment_id = a.id
      join stored_files f on f.id = v.file_id and f.state = 'ready'
      join tree_items t on t.id = a.item_id join spaces s on s.id = t.space_id
      where a.id = any(${sql.param(ids)}::uuid[]) and a.deleted_at is null and ${input.source}`);
    const versions = new Map(result.rows.map((row) => [`${row.attachment_id}:${row.number}`, row]));
    const current = new Map(result.rows.filter((row) => row.current).map((row) => [row.attachment_id, row]));
    const adopted = new Map<string, string>();
    const resolve = (reference: CopiedAttachment) =>
      reference.version === null
        ? current.get(reference.id)
        : versions.get(`${reference.id}:${reference.version}`);
    for (const reference of references) {
      const row = resolve(reference);
      if (!row) continue;
      const key = `${row.attachment_id}:${row.number}`;
      if (adopted.has(key)) continue;
      const id = uuidv7();
      await tx.execute(sql`
        insert into template_files (id, template_id, file_id, name, created_by)
        values (${id}, ${input.templateId}, ${row.file_id}, ${row.name}, ${input.actorId})`);
      adopted.set(key, id);
    }
    const rewritten = rewriteFileReferences(input.document, (reference) => {
      const row = resolve(reference);
      const id = row ? adopted.get(`${row.attachment_id}:${row.number}`) : undefined;
      return id ? { id, version: reference.version === null ? null : 1 } : null;
    });
    const images = new Map<string, string | null>();
    const document = await copyDrawingScenes(rewritten.document, {
      read: (scene) => this.#text(tx, input.templateId, scene.id),
      image: async (sourceId) => {
        if (images.has(sourceId)) return images.get(sourceId) ?? null;
        const found = await tx.execute<{ file_id: string; name: string }>(sql`
          select v.file_id, v.name
          from attachments a join attachment_versions v on v.id = a.current_version_id
          join stored_files f on f.id = v.file_id and f.state = 'ready'
          join tree_items t on t.id = a.item_id join spaces s on s.id = t.space_id
          where a.id = ${sourceId} and a.deleted_at is null and ${input.source}`);
        const row = found.rows[0];
        const id = row ? uuidv7() : null;
        if (row && id) {
          await tx.execute(sql`
            insert into template_files (id, template_id, file_id, name, created_by)
            values (${id}, ${input.templateId}, ${row.file_id}, ${row.name}, ${input.actorId})`);
        }
        images.set(sourceId, id);
        return id;
      },
      write: async (blockId, scene, current) => {
        const name = drawingFileNames(blockId).scene;
        const stored = await this.store(scene, name, MAX_SCENE_BYTES);
        const id = await this.attach(tx, {
          templateId: input.templateId,
          stored,
          name,
          actorId: input.actorId,
        });
        return { id, version: current.version === null ? null : 1 };
      },
    });
    const kept = await this.keepOwn(tx, input.templateId, document);
    const takenOver = [...images.values()].filter((id) => id !== null).length;
    return {
      document: kept,
      adopted: adopted.size + takenOver,
      missing: rewritten.missing + images.size - takenOver,
    };
  }

  async #text(tx: Executor, templateId: string, fileId: string): Promise<string | null> {
    const result = await tx.execute<{ file_id: string }>(sql`
      select file_id from template_files where template_id = ${templateId} and id = ${fileId}`);
    const stored = result.rows[0]?.file_id;
    return stored
      ? readText(await this.#files.read(stored, undefined, { staged: true }), MAX_SCENE_BYTES)
      : null;
  }

  async keepOwn(tx: Transaction, templateId: string, document: DocumentJson): Promise<DocumentJson> {
    const own = new Set((await this.list(templateId, tx)).map((file) => file.id));
    const { document: kept } = rewriteFileReferences(document, (reference) =>
      own.has(reference.id) ? { id: reference.id, version: reference.version === null ? null : 1 } : null,
    );
    const used = [
      ...new Set([
        ...documentAttachments(kept).map((reference) => reference.id),
        ...(await sceneImageIds(kept, (scene) => this.#text(tx, templateId, scene.id))),
      ]),
    ];
    await tx.execute(sql`
      delete from template_files where template_id = ${templateId}
        and not (id = any(${sql.param(used)}::uuid[]))`);
    return kept;
  }

  async copyToPage(
    tx: Transaction,
    input: {
      templateId: string;
      itemId: string;
      live: boolean;
      actorId: string | null;
      document: DocumentJson;
    },
  ): Promise<DocumentJson> {
    if (!/^[0-9a-f-]{36}$/.test(input.templateId)) return input.document;
    const ids = [
      ...new Set([
        ...documentAttachments(input.document).map((reference) => reference.id),
        ...(await sceneImageIds(input.document, (scene) => this.#text(tx, input.templateId, scene.id))),
      ]),
    ];
    if (ids.length === 0) return input.document;
    const result = await tx.execute<{ id: string; name: string; file_id: string }>(sql`
      select tf.id, tf.name, tf.file_id from template_files tf
      join stored_files f on f.id = tf.file_id and f.state = 'ready'
      where tf.template_id = ${input.templateId} and tf.id = any(${sql.param(ids)}::uuid[])
      order by tf.id`);
    const existing = await tx.execute<{ name_key: string }>(
      sql`select name_key from attachments where item_id = ${input.itemId} and deleted_at is null`,
    );
    const taken = new Set(existing.rows.map((row) => row.name_key));
    const copied = new Map<string, string>();
    for (const row of result.rows) {
      const attachmentId = uuidv7();
      const versionId = uuidv7();
      const name = uniqueFileName(row.name, taken);
      await tx.execute(sql`
        insert into attachments (id, item_id, name, name_key, created_by)
        values (${attachmentId}, ${input.itemId}, ${name}, ${fileNameKey(name)}, ${input.actorId})`);
      await tx.execute(sql`
        insert into attachment_versions (id, attachment_id, number, file_id, name, uploaded_by, published_at)
        values (${versionId}, ${attachmentId}, 1, ${row.file_id}, ${name}, ${input.actorId},
          ${input.live ? sql`now()` : null})`);
      await tx.execute(sql`
        update attachments set current_version_id = ${versionId},
          published_version_id = ${input.live ? versionId : null}
        where id = ${attachmentId}`);
      copied.set(row.id, attachmentId);
    }
    const rewritten = rewriteFileReferences(input.document, (reference) => {
      const id = copied.get(reference.id);
      return id ? { id, version: reference.version === null ? null : 1 } : null;
    }).document;
    return copyDrawingScenes(
      rewritten,
      attachmentScenes(tx, this.#files, input.itemId, async (id) => copied.get(id) ?? null),
    );
  }

  async hasFiles(templateId: string): Promise<boolean> {
    if (!/^[0-9a-f-]{36}$/.test(templateId)) return false;
    const result = await this.#database.execute(
      sql`select 1 from template_files where template_id = ${templateId} limit 1`,
    );
    return result.rows.length > 0;
  }
}
