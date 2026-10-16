import type { Readable } from "node:stream";
import { uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import { UNLIMITED } from "../settings/definition.js";
import type { SettingsService } from "../settings/service.js";
import { actorIdOf, auditScopeOf, SpaceError } from "../spaces/common.js";
import type { PeopleService } from "../spaces/people.js";
import { signalSpaceChange } from "../spaces/signals.js";
import type { StorageService } from "../storage/storage.js";
import { type FileService, FileTooLargeError } from "./files.js";
import { cleanFileName, fileNameKey } from "./names.js";
import { publishAttachments } from "./publication.js";
import { keepVersionsSetting, MEGABYTE, maxFileSizeSetting } from "./settings.js";
import type { PreviewKind } from "./sniff.js";

export class AttachmentError extends SpaceError {
  override name = "AttachmentError";
}

export type AttachmentView = "draft" | "published";

export type AttachmentDraftChange = "added" | "changed" | "deleted";

export interface AttachmentVersion {
  id: string;
  number: number;
  name: string;
  size: number;
  contentType: string;
  restoredFrom: number | null;
  kept: boolean;
  uploadedBy: { id: string; name: string | null } | null;
  uploadedAt: Date;
}

export interface Attachment {
  id: string;
  itemId: string;
  name: string;
  size: number;
  contentType: string;
  preview: PreviewKind;
  inline: boolean;
  version: number;
  versions: number;
  draft: AttachmentDraftChange | null;
  uploadedBy: { id: string; name: string | null } | null;
  uploadedAt: Date;
  createdAt: Date;
}

export interface AttachmentContent {
  attachmentId: string;
  fileId: string;
  name: string;
  size: number;
  contentType: string;
  preview: PreviewKind;
  inline: boolean;
  version: number;
  versionId: string;
}

const INLINE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "video/mp4",
  "video/webm",
  "video/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/flac",
]);

const CODE_EXTENSIONS =
  /\.(c|cc|cpp|cs|css|go|h|hpp|java|js|json|jsx|kt|lua|mjs|php|pl|ps1|py|rb|rs|scss|sh|sql|swift|toml|ts|tsx|xml|yaml|yml|html|htm|ini|conf|bat)$/i;

export function previewOf(contentType: string, name: string): { preview: PreviewKind; inline: boolean } {
  const type = contentType.split(";")[0]?.trim() ?? "";
  const inline = INLINE_TYPES.has(type);
  if (type.startsWith("image/") && inline) return { preview: "image", inline };
  if (type.startsWith("video/") && inline) return { preview: "video", inline };
  if (type.startsWith("audio/") && inline) return { preview: "audio", inline };
  if (type === "application/pdf") return { preview: "pdf", inline: false };
  if (type === "image/svg+xml") return { preview: "svg", inline: false };
  if (type === "text/markdown") return { preview: "markdown", inline: false };
  if (type === "text/csv") return { preview: "csv", inline: false };
  if (type === "text/plain") return { preview: CODE_EXTENSIONS.test(name) ? "code" : "text", inline: false };
  if (type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return { preview: "word", inline: false };
  }
  if (type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    return { preview: "excel", inline: false };
  }
  return { preview: "none", inline: false };
}

interface AttachmentRow {
  id: string;
  item_id: string;
  name: string;
  size: string | number;
  content_type: string;
  number: number;
  versions: string | number;
  draft: AttachmentDraftChange | null;
  uploaded_by: string | null;
  uploaded_at: Date | string;
  created_at: Date | string;
  [key: string]: unknown;
}

const MAX_ATTACHMENTS_LISTED = 1000;
const IN_DRAFT = sql`(a.deleted_at is null or a.published_version_id is not null)`;

export class AttachmentService {
  readonly #database: Database;
  readonly #files: FileService;
  readonly #settings: SettingsService;
  readonly #people: PeopleService;
  readonly #audit: AuditLog;
  readonly #storage: StorageService;

  constructor(options: {
    database: Database;
    files: FileService;
    settings: SettingsService;
    people: PeopleService;
    audit: AuditLog;
    storage: StorageService;
  }) {
    this.#database = options.database;
    this.#files = options.files;
    this.#settings = options.settings;
    this.#people = options.people;
    this.#audit = options.audit;
    this.#storage = options.storage;
  }

  get files(): FileService {
    return this.#files;
  }

  #select(view: AttachmentView) {
    if (view === "published") {
      return sql`
        select a.id, a.item_id, v.name, f.size, f.content_type, v.number,
          (select count(*) from attachment_versions av
            where av.attachment_id = a.id and av.published_at is not null) as versions,
          null as draft, v.uploaded_by, v.created_at as uploaded_at, a.created_at
        from attachments a join attachment_versions v on v.id = a.published_version_id
        join stored_files f on f.id = v.file_id
        where true`;
    }
    return sql`
      select a.id, a.item_id, v.name, f.size, f.content_type, v.number,
        (select count(*) from attachment_versions av where av.attachment_id = a.id) as versions,
        case when a.deleted_at is not null then 'deleted'
          when a.published_version_id is null then 'added'
          when a.published_version_id <> a.current_version_id then 'changed' end as draft,
        v.uploaded_by, v.created_at as uploaded_at, a.created_at
      from attachments a join attachment_versions v on v.id = a.current_version_id
      join stored_files f on f.id = v.file_id
      where ${IN_DRAFT}`;
  }

  async #toAttachments(viewer: Principal, rows: AttachmentRow[]): Promise<Attachment[]> {
    const names = await this.#people.visibleNames(
      viewer,
      rows.map((row) => row.uploaded_by).filter((id): id is string => id !== null),
    );
    return rows.map((row) => ({
      id: row.id,
      itemId: row.item_id,
      name: row.name,
      size: Number(row.size),
      contentType: row.content_type,
      ...previewOf(row.content_type, row.name),
      version: row.number,
      versions: Number(row.versions),
      draft: row.draft,
      uploadedBy: row.uploaded_by ? { id: row.uploaded_by, name: names.get(row.uploaded_by) ?? null } : null,
      uploadedAt: new Date(row.uploaded_at),
      createdAt: new Date(row.created_at),
    }));
  }

  async list(viewer: Principal, itemId: string, view: AttachmentView): Promise<Attachment[]> {
    const result = await this.#database.execute<AttachmentRow>(sql`
      ${this.#select(view)} and a.item_id = ${itemId}
      order by lower(v.name), a.id limit ${MAX_ATTACHMENTS_LISTED}`);
    return this.#toAttachments(viewer, result.rows);
  }

  async get(
    viewer: Principal,
    attachmentId: string,
    view: AttachmentView,
    executor: Executor = this.#database,
  ): Promise<Attachment | null> {
    const result = await executor.execute<AttachmentRow>(sql`
      ${this.#select(view)} and a.id = ${attachmentId}`);
    const rows = await this.#toAttachments(viewer, result.rows);
    return rows[0] ?? null;
  }

  async #location(executor: Executor, itemId: string) {
    const result = await executor.execute<{
      space_id: string;
      organization_id: string | null;
      kind: string;
      mode: string;
    }>(sql`
      select t.space_id, s.organization_id, t.kind, t.mode from tree_items t join spaces s on s.id = t.space_id
      where t.id = ${itemId}`);
    const row = result.rows[0];
    if (!row) throw new AttachmentError("itemNotFound", "The page does not exist");
    if (row.kind !== "page" && row.kind !== "blogPost") {
      throw new AttachmentError("invalidItem", "Files can be attached to pages and blog posts");
    }
    return row;
  }

  async #changed(
    tx: Transaction,
    itemId: string,
    location: { space_id: string; mode: string },
  ): Promise<void> {
    if (location.mode === "live") await publishAttachments(tx, itemId);
    await signalSpaceChange(tx, {
      spaceId: location.space_id,
      kind: location.mode === "live" ? "page" : "draft",
      itemId,
    });
  }

  async maxBytes(itemId: string): Promise<number> {
    const location = await this.#location(this.#database, itemId);
    const chain = location.organization_id ? { organization: location.organization_id } : {};
    return (await this.#settings.get(maxFileSizeSetting, chain)) * MEGABYTE;
  }

  async upload(
    actor: Principal,
    itemId: string,
    input: { name: string; body: Readable; contentLength?: number | undefined },
  ): Promise<Attachment> {
    const name = cleanFileName(input.name);
    if (!name) throw new AttachmentError("invalidFileName", "The file needs a name");
    const limit = await this.maxBytes(itemId);
    if (input.contentLength !== undefined && input.contentLength > limit) {
      input.body.resume();
      throw new FileTooLargeError(limit);
    }
    try {
      await this.#storage.requireUpload();
    } catch (error) {
      input.body.resume();
      throw error;
    }
    const stored = await this.#files.write(input.body, { name, maxBytes: limit });
    try {
      const attachmentId = await this.#database.transaction(async (tx) => {
        const location = await this.#location(tx, itemId);
        await tx.execute(sql`select id from tree_items where id = ${itemId} for update`);
        const key = fileNameKey(name);
        const existing = await tx.execute<{ id: string }>(sql`
          select id from attachments where item_id = ${itemId} and name_key = ${key} and deleted_at is null
          for update`);
        const id = existing.rows[0]?.id ?? uuidv7();
        if (!existing.rows[0]) {
          await tx.execute(sql`
            insert into attachments (id, item_id, name, name_key, created_by)
            values (${id}, ${itemId}, ${name}, ${key}, ${actorIdOf(actor)})`);
        }
        const fileId = await this.#files.reuse(tx, stored, location.space_id);
        await this.#addVersion(tx, actor, id, fileId, name, null);
        await this.#changed(tx, itemId, location);
        await this.#prune(tx, id, location);
        return id;
      });
      const attachment = await this.get(actor, attachmentId, "draft");
      if (!attachment) throw new Error("The attachment was not stored");
      return attachment;
    } catch (error) {
      await this.#database.execute(sql`
        update stored_files set state = 'orphaned', updated_at = now()
        where id = ${stored.id} and not exists (select 1 from attachment_versions v where v.file_id = ${stored.id})`);
      throw error;
    }
  }

  async #addVersion(
    tx: Transaction,
    actor: Principal,
    attachmentId: string,
    fileId: string,
    name: string,
    restoredFrom: number | null,
  ): Promise<number> {
    const next = await tx.execute<{ number: number }>(sql`
      select coalesce(max(number), 0) + 1 as number from attachment_versions where attachment_id = ${attachmentId}`);
    const number = Number(next.rows[0]?.number ?? 1);
    const versionId = uuidv7();
    await tx.execute(sql`
      insert into attachment_versions (id, attachment_id, number, file_id, name, restored_from, uploaded_by)
      values (${versionId}, ${attachmentId}, ${number}, ${fileId}, ${name}, ${restoredFrom}, ${actorIdOf(actor)})`);
    await tx.execute(sql`
      update attachments set current_version_id = ${versionId}, name = ${name}, updated_at = now()
      where id = ${attachmentId}`);
    return number;
  }

  async #prune(
    tx: Transaction,
    attachmentId: string,
    location: { space_id: string; organization_id: string | null },
  ): Promise<void> {
    const keep = await this.#settings.get(
      keepVersionsSetting,
      {
        ...(location.organization_id ? { organization: location.organization_id } : {}),
        space: location.space_id,
      },
      { executor: tx },
    );
    if (keep === UNLIMITED) return;
    await tx.execute(sql`
      delete from attachment_versions v
      where v.attachment_id = ${attachmentId} and not v.kept
        and v.id <> (select current_version_id from attachments where id = ${attachmentId})
        and v.id is distinct from (select published_version_id from attachments where id = ${attachmentId})
        and v.number not in (select number from attachment_versions
          where attachment_id = ${attachmentId} and not kept
          order by number desc limit ${keep})`);
  }

  async setKept(
    actor: Principal,
    attachmentId: string,
    number: number,
    kept: boolean,
  ): Promise<AttachmentVersion> {
    await this.#database.transaction(async (tx) => {
      const attachment = await tx.execute<{ item_id: string; name: string }>(sql`
        select item_id, name from attachments where id = ${attachmentId} and deleted_at is null for update`);
      const row = attachment.rows[0];
      if (!row) throw new AttachmentError("attachmentNotFound", "The file does not exist");
      const version = await tx.execute<{ kept: boolean }>(sql`
        select kept from attachment_versions where attachment_id = ${attachmentId} and number = ${number}`);
      const current = version.rows[0];
      if (!current) throw new AttachmentError("versionNotFound", "This version does not exist anymore");
      if (current.kept === kept) return;
      await tx.execute(sql`
        update attachment_versions set kept = ${kept}, updated_at = now()
        where attachment_id = ${attachmentId} and number = ${number}`);
      const location = await this.#location(tx, row.item_id);
      const page = await tx.execute<{ title: string }>(
        sql`select title from tree_items where id = ${row.item_id}`,
      );
      await this.#audit.record(tx, {
        name: kept ? "attachment.versionKept" : "attachment.versionReleased",
        actor,
        targetId: row.item_id,
        fields: {
          spaceId: location.space_id,
          title: page.rows[0]?.title ?? "",
          attachmentId,
          fileName: row.name,
          version: number,
        },
        scope: auditScopeOf({ organizationId: location.organization_id }),
      });
      await signalSpaceChange(tx, { spaceId: location.space_id, kind: "page", itemId: row.item_id });
    });
    const version = (await this.versions(actor, attachmentId, "draft")).find(
      (candidate) => candidate.number === number,
    );
    if (!version) throw new AttachmentError("versionNotFound", "This version does not exist anymore");
    return version;
  }

  async versions(
    viewer: Principal,
    attachmentId: string,
    view: AttachmentView,
  ): Promise<AttachmentVersion[]> {
    const result = await this.#database.execute<{
      id: string;
      number: number;
      name: string;
      size: string | number;
      content_type: string;
      restored_from: number | null;
      kept: boolean;
      uploaded_by: string | null;
      created_at: Date | string;
    }>(sql`
      select v.id, v.number, v.name, f.size, f.content_type, v.restored_from, v.kept, v.uploaded_by,
        v.created_at
      from attachment_versions v join stored_files f on f.id = v.file_id
      where v.attachment_id = ${attachmentId}
        ${
          view === "published"
            ? sql`and v.published_at is not null
                and exists (select 1 from attachments a where a.id = v.attachment_id and a.published_version_id is not null)`
            : sql``
        }
      order by v.number desc limit 500`);
    const names = await this.#people.visibleNames(
      viewer,
      result.rows.map((row) => row.uploaded_by).filter((id): id is string => id !== null),
    );
    return result.rows.map((row) => ({
      id: row.id,
      number: row.number,
      name: row.name,
      size: Number(row.size),
      contentType: row.content_type,
      restoredFrom: row.restored_from,
      kept: row.kept,
      uploadedBy: row.uploaded_by ? { id: row.uploaded_by, name: names.get(row.uploaded_by) ?? null } : null,
      uploadedAt: new Date(row.created_at),
    }));
  }

  async restoreVersion(actor: Principal, attachmentId: string, number: number): Promise<Attachment> {
    await this.#database.transaction(async (tx) => {
      const attachment = await tx.execute<{ item_id: string }>(sql`
        select item_id from attachments where id = ${attachmentId} and deleted_at is null for update`);
      const itemId = attachment.rows[0]?.item_id;
      if (!itemId) throw new AttachmentError("attachmentNotFound", "The file does not exist");
      const version = await tx.execute<{ file_id: string; name: string }>(sql`
        select file_id, name from attachment_versions where attachment_id = ${attachmentId} and number = ${number}`);
      const row = version.rows[0];
      if (!row) throw new AttachmentError("versionNotFound", "This version does not exist anymore");
      const current = await tx.execute<{ name: string }>(
        sql`select name from attachments where id = ${attachmentId}`,
      );
      await this.#addVersion(tx, actor, attachmentId, row.file_id, current.rows[0]?.name ?? row.name, number);
      const location = await this.#location(tx, itemId);
      await this.#changed(tx, itemId, location);
      await this.#prune(tx, attachmentId, location);
    });
    const restored = await this.get(actor, attachmentId, "draft");
    if (!restored) throw new AttachmentError("attachmentNotFound", "The file does not exist");
    return restored;
  }

  async delete(actor: Principal, attachmentId: string): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const deleted = await tx.execute<{ item_id: string }>(sql`
        update attachments set deleted_at = now(), deleted_by = ${actorIdOf(actor)}, updated_at = now()
        where id = ${attachmentId} and deleted_at is null returning item_id`);
      const itemId = deleted.rows[0]?.item_id;
      if (!itemId) throw new AttachmentError("attachmentNotFound", "The file does not exist");
      await tx.execute(
        sql`update blog_posts set cover_attachment_id = null where cover_attachment_id = ${attachmentId}`,
      );
      const location = await this.#location(tx, itemId);
      await this.#changed(tx, itemId, location);
    });
  }

  async undelete(actor: Principal, attachmentId: string): Promise<Attachment> {
    await this.#database.transaction(async (tx) => {
      const owner = await tx.execute<{ item_id: string }>(
        sql`select item_id from attachments where id = ${attachmentId}`,
      );
      const ownerId = owner.rows[0]?.item_id;
      if (!ownerId) throw new AttachmentError("attachmentNotFound", "The file does not exist");
      await tx.execute(sql`select id from tree_items where id = ${ownerId} for update`);
      const row = await tx.execute<{ item_id: string; name_key: string }>(sql`
        select item_id, name_key from attachments where id = ${attachmentId} and deleted_at is not null for update`);
      const attachment = row.rows[0];
      if (!attachment) throw new AttachmentError("attachmentNotFound", "The file does not exist");
      const taken = await tx.execute(sql`
        select 1 from attachments where item_id = ${attachment.item_id} and name_key = ${attachment.name_key}
          and deleted_at is null`);
      if (taken.rows.length > 0) {
        throw new AttachmentError(
          "nameTaken",
          "A file with this name was added in the meantime; rename one of them",
        );
      }
      await tx.execute(sql`
        update attachments set deleted_at = null, deleted_by = null, discarded_draft_id = null, updated_at = now()
        where id = ${attachmentId}`);
      const location = await this.#location(tx, attachment.item_id);
      await this.#changed(tx, attachment.item_id, location);
    });
    const restored = await this.get(actor, attachmentId, "draft");
    if (!restored) throw new AttachmentError("attachmentNotFound", "The file does not exist");
    return restored;
  }

  async deletedItemOf(attachmentId: string): Promise<string | null> {
    const result = await this.#database.execute<{ item_id: string }>(
      sql`select item_id from attachments where id = ${attachmentId} and deleted_at is not null`,
    );
    return result.rows[0]?.item_id ?? null;
  }

  async content(
    attachmentId: string,
    view: AttachmentView,
    number?: number,
  ): Promise<AttachmentContent | null> {
    const version =
      view === "published"
        ? number === undefined
          ? sql`v.id = a.published_version_id`
          : sql`v.number = ${number} and v.published_at is not null and a.published_version_id is not null`
        : number === undefined
          ? sql`v.id = a.current_version_id`
          : sql`v.number = ${number}`;
    const result = await this.#database.execute<{
      id: string;
      file_id: string;
      name: string;
      size: string | number;
      content_type: string;
      number: number;
      version_id: string;
    }>(sql`
      select a.id, v.file_id, v.name, f.size, f.content_type, v.number, v.id as version_id
      from attachments a join attachment_versions v on v.attachment_id = a.id and ${version}
      join stored_files f on f.id = v.file_id and f.state <> 'pending'
      where a.id = ${attachmentId} ${view === "draft" ? sql`and ${IN_DRAFT}` : sql``}`);
    const row = result.rows[0];
    if (!row) return null;
    return {
      attachmentId: row.id,
      fileId: row.file_id,
      name: row.name,
      size: Number(row.size),
      contentType: row.content_type,
      ...previewOf(row.content_type, row.name),
      version: row.number,
      versionId: row.version_id,
    };
  }

  async usage(
    scope: { spaceId: string } | { organizationId: string },
  ): Promise<{ bytes: number; files: number }> {
    const filter =
      "spaceId" in scope
        ? sql`t.space_id = ${scope.spaceId}`
        : sql`s.organization_id = ${scope.organizationId}`;
    const result = await this.#database.execute<{ bytes: string | null; files: string }>(sql`
      select coalesce(sum(f.size), 0) as bytes, count(*) as files
      from (
        select distinct v.attachment_id, v.file_id from attachment_versions v
        join attachments a on a.id = v.attachment_id
        join tree_items t on t.id = a.item_id join spaces s on s.id = t.space_id
        where ${filter}) used
      join stored_files f on f.id = used.file_id`);
    return { bytes: Number(result.rows[0]?.bytes ?? 0), files: Number(result.rows[0]?.files ?? 0) };
  }
}
