import { type Readable, Transform, type TransformCallback } from "node:stream";
import { escapeHtml } from "@pagehall/editor-schema";
import { formatDate, uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import type { InstanceAddressService } from "../accounts/instance-address.js";
import type { Principal, TokenGrant, TokenScopes } from "../accounts/principal.js";
import { accountScopeChain } from "../accounts/scope.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { AuthorizationService } from "../authorization/service.js";
import { ForbiddenError } from "../authorization/service.js";
import type { TaskService } from "../collaboration/tasks.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import type { DatabasePool } from "../database/pool.js";
import type { AttachmentService } from "../files/attachments.js";
import type { FileService } from "../files/files.js";
import type { ByteRange } from "../files/store.js";
import type { JobContext, JobQueue } from "../jobs/job-queue.js";
import type { Logger } from "../logging/logger.js";
import type { MailService } from "../mail/mail-service.js";
import type { NotificationService } from "../notifications/service.js";
import { timeFormatSetting } from "../settings/preferences.js";
import type { SettingsService } from "../settings/service.js";
import { auditScopeOf } from "../spaces/common.js";
import type { PageDocumentService } from "../spaces/documents.js";
import type { PeopleService } from "../spaces/people.js";
import type { ReportService } from "../spaces/reports.js";
import { visibleItem } from "../spaces/visibility.js";
import { StorageFullError } from "../storage/errors.js";
import type { StorageService } from "../storage/storage.js";
import { type ArchiveEntry, zipArchive } from "./archive.js";
import { exportBuildJob } from "./jobs.js";
import { safeName } from "./names.js";
import {
  type ExportPlan,
  INDEX_NAME,
  type PlanInput,
  type PlannedNode,
  pageFile,
  planExport,
} from "./plan.js";
import {
  type ExportFormatter,
  htmlDocument,
  nowhere,
  PageExportRenderer,
  type PreparedPage,
} from "./renderer.js";
import type { ExportScope, ExportState } from "./schema.js";
import { exportTexts } from "./texts.js";

export const EXPORT_RETENTION_DAYS = 7;
export const DOWNLOADED_RETENTION_HOURS = 24;
const FREE_SPACE_CHECK_BYTES = 16 * 1024 * 1024;
const PAGE_OVERHEAD_BYTES = 8 * 1024;
const EXPORT_RUNNING = "Another export of yours is still running";
const NOT_ENOUGH_STORAGE =
  "Not enough storage for this export. Your instance administrator needs to free up space.";
export const MAX_EXPORT_ATTEMPTS = 3;
const STALE_MINUTES = 10;
const BLOG_FOLDER_ID = "blog";
const HEARTBEAT_MS = 5_000;
const MAX_LISTED_EXPORTS = 50;
export const MAX_KEPT_EXPORTS = 5;

export type PageExportFormat = "markdown" | "html" | "zip";

export type ExportErrorCode =
  | "exportNotFound"
  | "exportRunning"
  | "notEnoughStorage"
  | "nothingToExport"
  | "tooManyExports";

export type ExportFailureCode =
  | "exportDisabled"
  | "noAccess"
  | "tokenRevoked"
  | "notEnoughStorage"
  | "interrupted"
  | "internalError";

export class ExportError extends Error {
  override name = "ExportError";

  constructor(
    readonly code: ExportErrorCode,
    message: string,
  ) {
    super(message);
  }
}

class ExportFailure extends Error {
  override name = "ExportFailure";

  constructor(readonly code: ExportFailureCode) {
    super(`The export failed: ${code}`);
  }
}

class ExportRemoved extends Error {
  override name = "ExportRemoved";
}

export interface ExportSummary {
  id: string;
  scope: ExportScope;
  spaceId: string | null;
  rootItemId: string | null;
  name: string;
  state: ExportState;
  progress: { done: number; total: number };
  fileName: string | null;
  size: number | null;
  errorCode: string | null;
  createdAt: Date;
  finishedAt: Date | null;
  expiresAt: Date | null;
}

export interface ExportArchive {
  fileName: string;
  size: number;
  read(range?: ByteRange): Promise<Readable>;
  delivered(): Promise<void>;
}

export interface ExportFile {
  fileName: string;
  contentType: string;
  size?: number;
  body: Readable | Buffer;
}

type ExportRow = {
  id: string;
  account_id: string;
  token_id: string | null;
  started_with_token: boolean;
  organization_id: string | null;
  scope: ExportScope;
  space_id: string | null;
  root_item_id: string | null;
  name: string;
  state: ExportState;
  attempts: number;
  progress_done: number;
  progress_total: number;
  file_id: string | null;
  file_name: string | null;
  size: string | number | null;
  error_code: string | null;
  created_at: Date | string;
  finished_at: Date | string | null;
  expires_at: Date | string | null;
};

type ItemRow = {
  id: string;
  parent_id: string | null;
  path: string[];
  kind: "page" | "folder" | "link" | "meetingSeries";
  title: string;
  link_url: string | null;
  link_item_id: string | null;
};

function date(value: Date | string | null): Date | null {
  return value === null ? null : new Date(value);
}

function summary(row: ExportRow): ExportSummary {
  return {
    id: row.id,
    scope: row.scope,
    spaceId: row.space_id,
    rootItemId: row.root_item_id,
    name: row.name,
    state: row.state,
    progress: { done: row.progress_done, total: row.progress_total },
    fileName: row.file_name,
    size: row.size === null ? null : Number(row.size),
    errorCode: row.error_code,
    createdAt: new Date(row.created_at),
    finishedAt: date(row.finished_at),
    expiresAt: date(row.expires_at),
  };
}

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: unknown }).cause ?? error;
  return (cause as { code?: string }).code === "23505";
}

function failureOf(error: ForbiddenError): ExportFailureCode {
  return error.decision.denials.includes("exportDisabled") ? "exportDisabled" : "noAccess";
}

const SAFE_LINK = /^(https?:|mailto:)/i;

function owned(actor: Extract<Principal, { type: "account" }>): ReturnType<typeof sql> {
  const organizationId = actor.token?.organizationId;
  return organizationId
    ? sql`account_id = ${actor.id} and organization_id = ${organizationId}`
    : sql`account_id = ${actor.id}`;
}

export class ExportService {
  readonly #database: Database;
  readonly #pool: DatabasePool;
  readonly #authorization: AuthorizationService;
  readonly #audit: AuditLog;
  readonly #notifications: NotificationService;
  readonly #settings: SettingsService;
  readonly #mail: MailService;
  readonly #files: FileService;
  readonly #storage: StorageService;
  readonly #documents: PageDocumentService;
  readonly #attachments: AttachmentService;
  readonly #reports: ReportService;
  readonly #tasks: TaskService;
  readonly #people: PeopleService;
  readonly #address: InstanceAddressService;
  readonly #jobs: JobQueue | undefined;
  readonly #logger: Logger;

  constructor(options: {
    database: Database;
    pool: DatabasePool;
    authorization: AuthorizationService;
    audit: AuditLog;
    notifications: NotificationService;
    settings: SettingsService;
    mail: MailService;
    files: FileService;
    storage: StorageService;
    documents: PageDocumentService;
    attachments: AttachmentService;
    reports: ReportService;
    tasks: TaskService;
    people: PeopleService;
    address: InstanceAddressService;
    jobs: JobQueue | undefined;
    logger: Logger;
  }) {
    this.#database = options.database;
    this.#pool = options.pool;
    this.#authorization = options.authorization;
    this.#audit = options.audit;
    this.#notifications = options.notifications;
    this.#settings = options.settings;
    this.#mail = options.mail;
    this.#files = options.files;
    this.#storage = options.storage;
    this.#documents = options.documents;
    this.#attachments = options.attachments;
    this.#reports = options.reports;
    this.#tasks = options.tasks;
    this.#people = options.people;
    this.#address = options.address;
    this.#jobs = options.jobs;
    this.#logger = options.logger;
  }

  async #renderer(
    viewer: Principal,
    accountId: string,
  ): Promise<{ renderer: PageExportRenderer; language: string }> {
    const language = await this.#mail.languageOf(accountId);
    const timeZone = await this.#mail.timeZoneOf(accountId);
    const dateFormat = await this.#mail.dateFormatOf(accountId);
    const timeFormat = await this.#settings.get(timeFormatSetting, {
      ...(await accountScopeChain(this.#database, accountId)),
      user: accountId,
    });
    const time = new Intl.DateTimeFormat(language, {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: timeFormat === "12h",
    });
    const format: ExportFormatter = {
      date: (value) => formatDate(value, dateFormat, timeZone, language),
      day: (iso) =>
        /^\d{4}-\d{2}-\d{2}$/.test(iso)
          ? formatDate(new Date(`${iso}T12:00:00Z`), dateFormat, "UTC", language)
          : iso,
      dateTime: (value) => `${formatDate(value, dateFormat, timeZone, language)} ${time.format(value)}`,
    };
    const renderer = new PageExportRenderer({
      database: this.#database,
      documents: this.#documents,
      attachments: this.#attachments,
      reports: this.#reports,
      tasks: this.#tasks,
      people: this.#people,
      logger: this.#logger,
      viewer,
      texts: exportTexts(language),
      format,
      origin: (await this.#address.get()).url ?? "",
    });
    return { renderer, language };
  }

  async #publishedAttachments(itemIds: readonly string[]) {
    if (itemIds.length === 0) return [];
    const result = await this.#database.execute<{
      id: string;
      item_id: string;
      name: string;
      file_id: string;
      size: string | number;
    }>(sql`
      select a.id, a.item_id, v.name, v.file_id, f.size
      from attachments a join attachment_versions v on v.id = a.published_version_id
      join stored_files f on f.id = v.file_id and f.state = 'ready'
      where a.item_id = any(${sql.param([...itemIds])}::uuid[])
      order by a.item_id, lower(v.name), a.id`);
    return result.rows.map((row) => ({
      id: row.id,
      itemId: row.item_id,
      name: row.name,
      fileId: row.file_id,
      size: Number(row.size),
    }));
  }

  async page(actor: Principal, pageId: string, format: PageExportFormat): Promise<ExportFile> {
    if (actor.type !== "account") throw new ExportError("nothingToExport", "Only people can export pages");
    await this.#authorization.require(actor, "item.export", { type: "item", id: pageId });
    const { renderer, language } = await this.#renderer(actor, actor.id);
    const prepared = await renderer.prepare(pageId);
    if (!prepared) throw new ExportError("nothingToExport", "The page has no published content to export");
    const stem = safeName(renderer.title(prepared), renderer.texts.untitledPage);
    if (format === "markdown") {
      return {
        fileName: `${stem}.md`,
        contentType: "text/markdown; charset=utf-8",
        body: Buffer.from(renderer.markdown(prepared, nowhere), "utf8"),
      };
    }
    if (format === "html") {
      return {
        fileName: `${stem}.html`,
        contentType: "text/html; charset=utf-8",
        body: Buffer.from(renderer.html(prepared, nowhere, language), "utf8"),
      };
    }
    const plan = planExport({
      rootId: pageId,
      items: [
        {
          id: pageId,
          parentId: null,
          path: [pageId],
          kind: "page",
          title: prepared.title,
          linkUrl: null,
          linkItemId: null,
        },
      ],
      attachments: await this.#publishedAttachments([pageId]),
      untitledPage: renderer.texts.untitledPage,
      untitledFolder: renderer.texts.untitledFolder,
      flat: true,
    });
    const node = plan.pages[0];
    if (!node) throw new ExportError("nothingToExport", "The page has no published content to export");
    const now = new Date();
    const entries: ArchiveEntry[] = [
      {
        path: pageFile(node, "markdown"),
        mtime: prepared.updatedAt,
        compress: true,
        content: async () => Buffer.from(renderer.markdown(prepared, plan.locator(node)), "utf8"),
      },
      {
        path: pageFile(node, "html"),
        mtime: prepared.updatedAt,
        compress: true,
        content: async () => Buffer.from(renderer.html(prepared, plan.locator(node), language), "utf8"),
      },
      ...plan.attachments.map((attachment) => ({
        path: attachment.path,
        mtime: now,
        compress: false,
        content: () => this.#files.read(attachment.fileId),
      })),
    ];
    return { fileName: `${stem}.zip`, contentType: "application/zip", body: zipArchive(entries) };
  }

  async start(actor: Principal, target: { spaceId: string } | { pageId: string }): Promise<ExportSummary> {
    if (actor.type !== "account") throw new ExportError("nothingToExport", "Only people can export");
    const scope: ExportScope = "spaceId" in target ? "space" : "pages";
    if ("spaceId" in target) {
      await this.#authorization.require(actor, "space.export", { type: "space", id: target.spaceId });
    } else {
      await this.#authorization.require(actor, "item.exportPages", { type: "item", id: target.pageId });
    }
    const subject = await this.#subject(target);
    if (!subject) throw new ExportError("nothingToExport", "There is nothing to export");
    const running = await this.#database.execute(sql`
      select 1 from exports where account_id = ${actor.id} and state in ('queued', 'running') limit 1`);
    if (running.rows.length > 0) {
      throw new ExportError("exportRunning", EXPORT_RUNNING);
    }
    const measured = (await this.#storage.reading()) !== null;
    const estimate = measured ? await this.#estimate(subject.spaceId, subject.rootItemId) : 0;
    const id = uuidv7();
    try {
      await this.#database.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`pagehall.exports:${actor.id}`}, 0))`,
        );
        await this.#delete(
          tx,
          sql`account_id = ${actor.id} and state in ('ready', 'failed') and scope = ${scope}
            and space_id = ${subject.spaceId} and root_item_id is not distinct from ${subject.rootItemId}`,
        );
        const kept = await tx.execute<{ count: number }>(sql`
          select count(*)::int as count from exports where account_id = ${actor.id} and state = 'ready'`);
        if (Number(kept.rows[0]?.count ?? 0) >= MAX_KEPT_EXPORTS) {
          throw new ExportError(
            "tooManyExports",
            `You can keep up to ${MAX_KEPT_EXPORTS} exports. Delete one you no longer need first.`,
          );
        }
        if (measured) {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended('pagehall.exports.storage', 0))`,
          );
          const pending = await tx.execute<{ bytes: string | number }>(sql`
            select coalesce(sum(estimated_size), 0) as bytes from exports where state in ('queued', 'running')`);
          try {
            await this.#storage.requireLargeWrite(Number(pending.rows[0]?.bytes ?? 0) + estimate);
          } catch (error) {
            if (error instanceof StorageFullError)
              throw new ExportError("notEnoughStorage", NOT_ENOUGH_STORAGE);
            throw error;
          }
        }
        await tx.execute(sql`
          insert into exports (id, account_id, token_id, started_with_token, organization_id, scope, space_id,
            root_item_id, name, estimated_size)
          values (${id}, ${actor.id}, ${actor.token?.id ?? null}, ${actor.token !== undefined},
            ${subject.organizationId}, ${scope}, ${subject.spaceId}, ${subject.rootItemId}, ${subject.name},
            ${estimate})`);
        if (scope === "space") {
          await this.#audit.record(tx, {
            name: "space.exported",
            actor,
            targetId: subject.spaceId,
            fields: { name: subject.spaceName, key: subject.spaceKey, exportId: id },
            scope: auditScopeOf(subject),
          });
        } else {
          await this.#audit.record(tx, {
            name: "page.subtreeExported",
            actor,
            targetId: subject.rootItemId,
            fields: { spaceId: subject.spaceId, title: subject.name, exportId: id },
            scope: auditScopeOf(subject),
          });
        }
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ExportError("exportRunning", EXPORT_RUNNING);
      }
      throw error;
    }
    await this.#enqueue(id);
    return this.#require(actor, id);
  }

  async #subject(target: { spaceId: string } | { pageId: string }): Promise<{
    spaceId: string;
    spaceName: string;
    spaceKey: string;
    organizationId: string | null;
    rootItemId: string | null;
    name: string;
  } | null> {
    if ("spaceId" in target) {
      const result = await this.#database.execute<{
        id: string;
        name: string;
        key: string;
        organization_id: string | null;
      }>(sql`select id, name, key, organization_id from spaces where id = ${target.spaceId}`);
      const row = result.rows[0];
      return row
        ? {
            spaceId: row.id,
            spaceName: row.name,
            spaceKey: row.key,
            organizationId: row.organization_id,
            rootItemId: null,
            name: row.name,
          }
        : null;
    }
    const readable = await this.#documents.readable(target.pageId);
    const result = await this.#database.execute<{
      space_id: string;
      name: string;
      key: string;
      organization_id: string | null;
    }>(sql`
      select t.space_id, s.name, s.key, s.organization_id from tree_items t join spaces s on s.id = t.space_id
      where t.id = ${target.pageId}`);
    const row = result.rows[0];
    if (!row || !readable) return null;
    return {
      spaceId: row.space_id,
      spaceName: row.name,
      spaceKey: row.key,
      organizationId: row.organization_id,
      rootItemId: target.pageId,
      name: readable.title,
    };
  }

  async #estimate(spaceId: string, rootItemId: string | null): Promise<number> {
    const within = rootItemId ? sql`and ${rootItemId}::uuid = any(t.path)` : sql``;
    const result = await this.#database.execute<{
      attachments: string | number;
      text: string | number;
      pages: number;
    }>(sql`
      select
        (select coalesce(sum(f.size), 0) from attachments a
          join attachment_versions v on v.id = a.published_version_id
          join stored_files f on f.id = v.file_id
          join tree_items t on t.id = a.item_id
          where t.space_id = ${spaceId} and t.trash_entry_id is null ${within}) as attachments,
        (select coalesce(sum(octet_length(coalesce(v.document::text, d.snapshot::text, ''))), 0)
          from tree_items t
          left join page_versions v on v.id = t.published_version_id and t.mode = 'publish'
          left join page_documents d on d.item_id = t.id and t.mode = 'live'
          where t.space_id = ${spaceId} and t.kind in ('page', 'blogPost') and t.trash_entry_id is null ${within}) as text,
        (select count(*)::int from tree_items t
          where t.space_id = ${spaceId} and t.kind in ('page', 'blogPost') and t.trash_entry_id is null ${within}) as pages`);
    const row = result.rows[0];
    return (
      Number(row?.attachments ?? 0) +
      2 * Number(row?.text ?? 0) +
      Number(row?.pages ?? 0) * PAGE_OVERHEAD_BYTES
    );
  }

  #watchFreeSpace(): { stream: Transform; stopped: () => boolean } {
    const storage = this.#storage;
    let written = 0;
    let checkedAt = Number.NEGATIVE_INFINITY;
    let stopped = false;
    const stream = new Transform({
      transform(chunk: Buffer, _encoding, callback: TransformCallback) {
        written += chunk.length;
        if (written - checkedAt < FREE_SPACE_CHECK_BYTES) {
          callback(null, chunk);
          return;
        }
        checkedAt = written;
        storage.requireBuildRoom(written).then(
          () => callback(null, chunk),
          (error: unknown) => {
            if (error instanceof StorageFullError) {
              stopped = true;
              callback(new ExportFailure("notEnoughStorage"));
            } else {
              callback(error as Error);
            }
          },
        );
      },
    });
    return { stream, stopped: () => stopped };
  }

  async #enqueue(id: string): Promise<void> {
    await this.#jobs?.enqueue(exportBuildJob, { exportId: id }, { idempotencyKey: `${id}:${uuidv7()}` });
  }

  async #row(id: string, executor: Executor = this.#database): Promise<ExportRow | null> {
    const result = await executor.execute<ExportRow>(sql`select * from exports where id = ${id}`);
    return result.rows[0] ?? null;
  }

  async #owned(actor: Extract<Principal, { type: "account" }>, id: string): Promise<ExportRow | null> {
    const result = await this.#database.execute<ExportRow>(
      sql`select * from exports where id = ${id} and ${owned(actor)}`,
    );
    return result.rows[0] ?? null;
  }

  async #require(actor: Extract<Principal, { type: "account" }>, id: string): Promise<ExportSummary> {
    const row = await this.#owned(actor, id);
    if (!row) throw new ExportError("exportNotFound", "The export does not exist");
    return summary(row);
  }

  async list(actor: Principal): Promise<ExportSummary[]> {
    if (actor.type !== "account") return [];
    const result = await this.#database.execute<ExportRow>(sql`
      select * from exports where ${owned(actor)} and (expires_at is null or expires_at > now())
      order by created_at desc, id desc limit ${MAX_LISTED_EXPORTS}`);
    return result.rows.map(summary);
  }

  async get(actor: Principal, id: string): Promise<ExportSummary> {
    if (actor.type !== "account") throw new ExportError("exportNotFound", "The export does not exist");
    return this.#require(actor, id);
  }

  async #requireRoot(viewer: Principal, row: ExportRow): Promise<void> {
    if (row.scope === "space") {
      if (!row.space_id) throw new ExportFailure("noAccess");
      await this.#authorization.require(viewer, "space.export", { type: "space", id: row.space_id });
    } else {
      if (!row.root_item_id) throw new ExportFailure("noAccess");
      await this.#authorization.require(viewer, "item.exportPages", { type: "item", id: row.root_item_id });
    }
  }

  async download(actor: Principal, id: string): Promise<ExportArchive> {
    if (actor.type !== "account") throw new ExportError("exportNotFound", "The export does not exist");
    await this.#authorization.require(actor, "export.download", { type: "export", id });
    const row = await this.#owned(actor, id);
    if (!row?.file_id || row.state !== "ready") {
      throw new ExportError("exportNotFound", "The export does not exist");
    }
    try {
      await this.#requireRoot(actor, row);
    } catch (error) {
      if (error instanceof ExportFailure)
        throw new ExportError("exportNotFound", "The export does not exist");
      throw error;
    }
    const fileId = row.file_id;
    return {
      fileName: row.file_name ?? "export.zip",
      size: Number(row.size ?? 0),
      read: (range) => this.#files.read(fileId, range),
      delivered: async () => {
        await this.#database.execute(sql`
          update exports set expires_at = least(expires_at,
              now() + make_interval(hours => ${DOWNLOADED_RETENTION_HOURS})), updated_at = now()
          where id = ${id} and state = 'ready'`);
      },
    };
  }

  async remove(actor: Principal, id: string): Promise<void> {
    if (actor.type !== "account") throw new ExportError("exportNotFound", "The export does not exist");
    const removed = await this.#database.transaction(async (tx) =>
      this.#delete(tx, sql`id = ${id} and ${owned(actor)}`),
    );
    if (removed === 0) throw new ExportError("exportNotFound", "The export does not exist");
  }

  async #delete(tx: Transaction, condition: ReturnType<typeof sql>): Promise<number> {
    const removed = await tx.execute<{ file_id: string | null }>(sql`
      delete from exports where ${condition} returning file_id`);
    const files = removed.rows
      .map((row) => row.file_id)
      .filter((fileId): fileId is string => fileId !== null);
    if (files.length > 0) {
      await tx.execute(sql`
        update stored_files set state = 'orphaned', updated_at = now()
        where id = any(${sql.param(files)}::uuid[])`);
    }
    return removed.rows.length;
  }

  async afterDeactivation(tx: Transaction, accountId: string): Promise<void> {
    await this.#delete(tx, sql`account_id = ${accountId}`);
  }

  async afterMembershipEnded(tx: Transaction, organizationId: string, accountId: string): Promise<void> {
    await this.#delete(tx, sql`account_id = ${accountId} and organization_id = ${organizationId}`);
  }

  async removeExpired(): Promise<number> {
    return this.#database.transaction((tx) =>
      this.#delete(
        tx,
        sql`id in (select id from exports
          where expires_at <= now()
            or (state = 'failed' and finished_at <= now() - make_interval(days => ${EXPORT_RETENTION_DAYS}))
            or space_id is null or (scope = 'pages' and root_item_id is null)
          limit 500)`,
      ),
    );
  }

  async watchdog(): Promise<number> {
    const stale = await this.#database.execute<{ id: string }>(sql`
      select id from exports
      where state in ('queued', 'running')
        and coalesce(heartbeat_at, updated_at) < now() - make_interval(mins => ${STALE_MINUTES})
      limit 100`);
    for (const row of stale.rows) await this.#enqueue(row.id);
    return stale.rows.length;
  }

  async #lock(id: string): Promise<(() => Promise<void>) | null> {
    const client = await this.#pool.connect();
    const key = `pagehall.export:${id}`;
    try {
      const result = await client.query<{ locked: boolean }>(
        "select pg_try_advisory_lock(hashtextextended($1, 0)) as locked",
        [key],
      );
      if (!result.rows[0]?.locked) {
        client.release();
        return null;
      }
    } catch (error) {
      client.release(error as Error);
      throw error;
    }
    return async () => {
      try {
        await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [key]);
        client.release();
      } catch (error) {
        client.release(error as Error);
      }
    };
  }

  readonly work = async (job: JobContext<{ exportId: string }>): Promise<void> => {
    const id = job.payload.exportId;
    const unlock = await this.#lock(id);
    if (!unlock) return;
    try {
      const row = await this.#row(id);
      if (!row || (row.state !== "queued" && row.state !== "running")) return;
      if (row.attempts >= MAX_EXPORT_ATTEMPTS) {
        await this.#fail(row, "interrupted");
        return;
      }
      await this.#database.execute(sql`
        update exports set state = 'running', attempts = attempts + 1, heartbeat_at = now(), progress_done = 0,
          updated_at = now()
        where id = ${id}`);
      try {
        await this.#build({ ...row, attempts: row.attempts + 1 }, job.signal);
      } catch (error) {
        if (error instanceof ExportRemoved) return;
        if (error instanceof ForbiddenError) {
          await this.#fail(row, failureOf(error));
          return;
        }
        if (error instanceof ExportFailure) {
          await this.#fail(row, error.code);
          return;
        }
        if (job.signal.aborted) throw error;
        if (row.attempts + 1 >= MAX_EXPORT_ATTEMPTS) {
          this.#logger.error({ err: error, exportId: id }, "An export failed after all attempts");
          await this.#fail(row, "internalError");
          return;
        }
        this.#logger.warn({ err: error, exportId: id }, "An export attempt failed and is retried");
        throw error;
      }
    } finally {
      await unlock();
    }
  };

  async #viewer(row: ExportRow): Promise<Principal> {
    if (!row.started_with_token) return { type: "account", id: row.account_id };
    if (!row.token_id) throw new ExportFailure("tokenRevoked");
    const result = await this.#database.execute<{
      id: string;
      organization_id: string | null;
      scopes: TokenScopes;
      usable: boolean;
    }>(sql`
      select id, organization_id, scopes,
        (revoked_at is null and (expires_at is null or expires_at > now())) as usable
      from api_tokens where id = ${row.token_id} and account_id = ${row.account_id}`);
    const token = result.rows[0];
    if (!token?.usable) throw new ExportFailure("tokenRevoked");
    const grant: TokenGrant = { id: token.id, organizationId: token.organization_id, scopes: token.scopes };
    return { type: "account", id: row.account_id, token: grant };
  }

  async #blogPosts(viewer: Principal, row: ExportRow, folderTitle: string): Promise<PlanInput[]> {
    const result = await this.#database.execute<{ id: string; title: string }>(sql`
      select t.id, coalesce(v.title, t.title) as title
      from tree_items t join spaces s on s.id = t.space_id join blog_posts b on b.item_id = t.id
      join page_versions v on v.id = t.published_version_id
      where t.space_id = ${row.space_id} and t.kind = 'blogPost' and b.published_at is not null
        and t.reader_visible and t.archived_root_id is null
        and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}
      order by b.published_at desc, t.id desc`);
    if (result.rows.length === 0) return [];
    const folder: PlanInput = {
      id: BLOG_FOLDER_ID,
      parentId: null,
      path: [BLOG_FOLDER_ID],
      kind: "folder",
      title: folderTitle,
      linkUrl: null,
      linkItemId: null,
    };
    return [
      folder,
      ...result.rows.map((post) => ({
        id: post.id,
        parentId: BLOG_FOLDER_ID,
        path: [BLOG_FOLDER_ID, post.id],
        kind: "page" as const,
        title: post.title,
        linkUrl: null,
        linkItemId: null,
      })),
    ];
  }

  async #items(viewer: Principal, row: ExportRow): Promise<PlanInput[]> {
    const root = row.root_item_id;
    const archivedRoot = root
      ? sql`(select archived_root_id from tree_items where id = ${root})`
      : sql`null::uuid`;
    const result = await this.#database.execute<ItemRow>(sql`
      select t.id, t.parent_id, t.path, t.kind::text as kind,
        case when t.kind = 'page' and t.mode = 'publish' then coalesce(v.title, t.title) else t.title end as title,
        t.link_url, t.link_item_id
      from tree_items t join spaces s on s.id = t.space_id
      left join page_versions v on v.id = t.published_version_id
      where t.space_id = ${row.space_id}
        ${root ? sql`and ${root}::uuid = any(t.path)` : sql``}
        and t.kind in ('page', 'folder', 'link', 'meetingSeries')
        and t.reader_visible
        and t.archived_root_id is not distinct from ${archivedRoot}
        and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}
      order by cardinality(t.path), t.position, t.id`);
    return result.rows.map((item) => ({
      id: item.id,
      parentId: item.parent_id,
      path: item.path,
      kind: item.kind === "meetingSeries" ? "folder" : item.kind,
      title: item.title,
      linkUrl: item.link_url,
      linkItemId: item.link_item_id,
    }));
  }

  async #build(row: ExportRow, signal: AbortSignal): Promise<void> {
    const viewer = await this.#viewer(row);
    await this.#requireRoot(viewer, row);
    const { renderer, language } = await this.#renderer(viewer, row.account_id);
    const items = [
      ...(await this.#items(viewer, row)),
      ...(row.root_item_id ? [] : await this.#blogPosts(viewer, row, renderer.texts.blog)),
    ];
    const pageIds = items.filter((item) => item.kind === "page").map((item) => item.id);
    if (row.root_item_id && !pageIds.includes(row.root_item_id)) throw new ExportFailure("noAccess");
    const prepared = new Map<string, PreparedPage>();
    const plan = planExport({
      rootId: row.root_item_id,
      items,
      attachments: await this.#publishedAttachments(pageIds),
      untitledPage: renderer.texts.untitledPage,
      untitledFolder: renderer.texts.untitledFolder,
    });
    const total = plan.pages.length * 2 + plan.attachments.length + 1;
    let done = 0;
    let beat = 0;
    const progress = async () => {
      done += 1;
      signal.throwIfAborted();
      if (Date.now() - beat < HEARTBEAT_MS && done < total) return;
      beat = Date.now();
      const alive = await this.#database.execute(sql`
        update exports set heartbeat_at = now(), progress_done = ${done}, progress_total = ${total}
        where id = ${row.id} and state = 'running' returning id`);
      if (alive.rows.length === 0) throw new ExportRemoved();
    };
    const prepare = async (node: PlannedNode) => {
      const cached = prepared.get(node.id);
      if (cached) {
        prepared.delete(node.id);
        return cached;
      }
      const page = await renderer.prepare(node.id);
      if (!page) throw new ExportFailure("noAccess");
      prepared.set(node.id, page);
      return page;
    };
    const now = new Date();
    const entries: ArchiveEntry[] = [
      {
        path: `${INDEX_NAME}.html`,
        mtime: now,
        compress: true,
        content: async () => {
          await progress();
          return Buffer.from(this.#index(plan, row.name, renderer, language, now), "utf8");
        },
      },
    ];
    for (const node of plan.pages) {
      entries.push(
        {
          path: pageFile(node, "markdown"),
          mtime: now,
          compress: true,
          content: async () => {
            const page = await prepare(node);
            await progress();
            return Buffer.from(renderer.markdown(page, plan.locator(node)), "utf8");
          },
        },
        {
          path: pageFile(node, "html"),
          mtime: now,
          compress: true,
          content: async () => {
            const page = await prepare(node);
            await progress();
            return Buffer.from(renderer.html(page, plan.locator(node), language), "utf8");
          },
        },
      );
      for (const attachment of node.attachments) {
        entries.push({
          path: attachment.path,
          mtime: now,
          compress: false,
          content: async () => {
            await progress();
            return this.#files.read(attachment.fileId);
          },
        });
      }
    }
    const fileName = `${safeName(row.name, renderer.texts.untitledPage)} ${now.toISOString().slice(0, 10)}.zip`;
    const watch = this.#watchFreeSpace();
    const archive = zipArchive(entries);
    archive.once("error", (error) => watch.stream.destroy(error));
    watch.stream.once("error", (error) => archive.destroy(error));
    const abort = () =>
      archive.destroy(signal.reason instanceof Error ? signal.reason : new Error("Aborted"));
    signal.addEventListener("abort", abort, { once: true });
    let stored: Awaited<ReturnType<FileService["write"]>>;
    try {
      stored = await this.#files.write(archive.pipe(watch.stream), {
        name: fileName,
        maxBytes: Number.POSITIVE_INFINITY,
      });
    } catch (error) {
      if (watch.stopped()) throw new ExportFailure("notEnoughStorage");
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
    }
    const mailIds = await this.#database.transaction(async (tx) => {
      const locked = await tx.execute<{ state: ExportState }>(
        sql`select state from exports where id = ${row.id} for update`,
      );
      if (locked.rows[0]?.state !== "running") {
        await tx.execute(
          sql`update stored_files set state = 'orphaned', updated_at = now() where id = ${stored.id}`,
        );
        return [];
      }
      await this.#files.commit(tx, stored.id);
      const updated = await tx.execute<{ expires_at: Date | string }>(sql`
        update exports set state = 'ready', file_id = ${stored.id}, file_name = ${fileName}, size = ${stored.size},
          progress_done = ${total}, progress_total = ${total}, error_code = null, finished_at = now(),
          expires_at = now() + make_interval(days => ${EXPORT_RETENTION_DAYS}), updated_at = now()
        where id = ${row.id}
        returning expires_at`);
      const expiresAt = new Date(updated.rows[0]?.expires_at ?? Date.now());
      const notified = await this.#notifications.notify(tx, {
        type: "export.ready",
        recipients: [row.account_id],
        organizationId: row.organization_id,
        targetId: row.id,
        params: { name: row.name, scope: row.scope, expiresAt: expiresAt.toISOString() },
      });
      return notified.mailIds;
    });
    await this.#notifications.dispatch(mailIds);
  }

  #index(plan: ExportPlan, name: string, renderer: PageExportRenderer, language: string, now: Date): string {
    const locator = plan.locator(null);
    const list = (nodes: readonly PlannedNode[]): string => {
      if (nodes.length === 0) return "";
      const items = nodes.map((node) => {
        const title = escapeHtml(
          node.title.trim() ||
            (node.kind === "folder" ? renderer.texts.untitledFolder : renderer.texts.untitledPage),
        );
        let entry = title;
        if (node.kind === "page") {
          entry = `<a href="${escapeHtml(locator.page(node.id, "html") ?? "")}">${title}</a>`;
        } else if (node.kind === "link") {
          const local = node.linkItemId ? locator.page(node.linkItemId, "html") : null;
          const href = local ?? (node.linkUrl && SAFE_LINK.test(node.linkUrl) ? node.linkUrl : null);
          entry = href ? `<a href="${escapeHtml(href)}">${title}</a>` : title;
        }
        return `<li>${entry}${list(node.children)}</li>`;
      });
      return `<ul>${items.join("")}</ul>`;
    };
    const title = escapeHtml(name.trim() || renderer.texts.untitledPage);
    return htmlDocument(
      language,
      title,
      `<header><h1>${title}</h1><p class="ph-meta">${escapeHtml(renderer.texts.exported(renderer.format.date(now)))}</p></header><nav class="ph-index" aria-label="${escapeHtml(renderer.texts.contents)}">${list(plan.roots)}</nav>`,
    );
  }

  async #fail(row: ExportRow, code: ExportFailureCode): Promise<void> {
    const mailIds = await this.#database.transaction(async (tx) => {
      const updated = await tx.execute(sql`
        update exports set state = 'failed', error_code = ${code}, finished_at = now(), updated_at = now()
        where id = ${row.id} and state in ('queued', 'running') returning id`);
      if (updated.rows.length === 0) return [];
      const notified = await this.#notifications.notify(tx, {
        type: "export.failed",
        recipients: [row.account_id],
        organizationId: row.organization_id,
        targetId: row.id,
        params: { name: row.name, scope: row.scope, errorCode: code },
      });
      return notified.mailIds;
    });
    await this.#notifications.dispatch(mailIds);
  }
}
