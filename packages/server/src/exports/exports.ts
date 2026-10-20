import { Readable, Transform, type TransformCallback } from "node:stream";
import { escapeHtml } from "@pagehall/editor-schema";
import { formatDate, uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import type { InstanceAddressService } from "../accounts/instance-address.js";
import type { Principal, TokenGrant, TokenScopes } from "../accounts/principal.js";
import { accountScopeChain } from "../accounts/scope.js";
import type { AuditLog } from "../audit/audit-log.js";
import { OwnerSlots } from "../auth/concurrency.js";
import type { AuthorizationService } from "../authorization/service.js";
import { ForbiddenError } from "../authorization/service.js";
import type { CommentService } from "../collaboration/comments.js";
import type { TaskService } from "../collaboration/tasks.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import type { DatabasePool } from "../database/pool.js";
import type { AttachmentService } from "../files/attachments.js";
import type { DisplayVersionService } from "../files/display-versions.js";
import type { FileService } from "../files/files.js";
import type { ByteRange } from "../files/store.js";
import type { JobContext, JobQueue } from "../jobs/job-queue.js";
import type { Logger } from "../logging/logger.js";
import type { MailService } from "../mail/mail-service.js";
import type { NotificationService } from "../notifications/service.js";
import { timeFormatSetting } from "../settings/preferences.js";
import type { SettingsService } from "../settings/service.js";
import { auditScopeOf, SpaceError } from "../spaces/common.js";
import type { PageDocumentService } from "../spaces/documents.js";
import type { IncludeService } from "../spaces/includes.js";
import type { PeopleService } from "../spaces/people.js";
import type { ReportService } from "../spaces/reports.js";
import { visibleItem } from "../spaces/visibility.js";
import { StorageFullError } from "../storage/errors.js";
import type { StorageService } from "../storage/storage.js";
import { type ArchiveEntry, zipArchive } from "./archive.js";
import { exportBuildJob } from "./jobs.js";
import { safeName } from "./names.js";
import {
  defaultExportOptions,
  type ExportFormat,
  type ExportOptions,
  MAX_BROWSER_PRINT_PAGES,
  MAX_FILE_EXPORT_PAGES,
  readExportOptions,
} from "./options.js";
import { type PagedEntry, PagedExport } from "./paged.js";
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
import { RenderError, type RenderService } from "./rendering.js";
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

export interface StaticSite {
  config(spaceId: string): Promise<unknown>;
  entries(spaceId: string, options: { siteUrl: string | null; now: Date }): Promise<ArchiveEntry[]>;
}

export const pageExportFormats = ["markdown", "html", "zip", "print", "pdf", "docx"] as const;
export type PageExportFormat = (typeof pageExportFormats)[number];

export type ExportErrorCode =
  | "exportNotFound"
  | "exportRunning"
  | "notEnoughStorage"
  | "nothingToExport"
  | "tooManyExports"
  | "tooManyPagesToPrint"
  | "tooManyPagesForFile"
  | "renderUnavailable"
  | "renderFailed";

export type ExportFailureCode =
  | "exportDisabled"
  | "noAccess"
  | "tokenRevoked"
  | "notEnoughStorage"
  | "renderUnavailable"
  | "renderFailed"
  | "renderTooLarge"
  | "tooManyPagesForFile"
  | "tooLargeToBuild"
  | "notPublic"
  | "interrupted"
  | "internalError";

const RENDER_UNAVAILABLE = "Server-side PDF needs the render container; see the documentation";

const CONTENT_TYPES: Record<ExportFormat, string> = {
  archive: "application/zip",
  html: "application/zip",
  markdown: "application/zip",
  print: "text/html; charset=utf-8",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  site: "application/zip",
};

const EXTENSIONS: Record<ExportFormat, string> = {
  archive: "zip",
  html: "zip",
  markdown: "zip",
  print: "html",
  pdf: "pdf",
  docx: "docx",
  site: "zip",
};

function tooManyForFile(total: number): string {
  return `Word and PDF files can hold up to ${MAX_FILE_EXPORT_PAGES} pages, and this export has ${total}. Export it as an HTML or Markdown archive instead, or export a smaller part.`;
}

function outOfMemory(error: unknown): boolean {
  return (
    error instanceof RangeError &&
    /allocation failed|invalid (string|array|typed array) length|out of memory/i.test(error.message)
  );
}

function renderFailure(error: RenderError): ExportFailureCode {
  if (error.reason === "unavailable") return "renderUnavailable";
  if (error.reason === "tooLarge") return "renderTooLarge";
  return "renderFailed";
}

export interface ExportRequest {
  format: ExportFormat;
  options: ExportOptions;
}

export interface ExportSummaryCounts {
  pages: number;
  blogPosts: number;
  printLimit: number;
  fileLimit: number;
  serverPdf: boolean;
  largeWritesPaused: boolean;
}

export const MAX_PAGE_EXPORT_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_PARALLEL_PAGE_EXPORTS = 2;
export const MAX_PARALLEL_PAGE_EXPORTS_PER_ACCOUNT = 1;

export class ExportBusyError extends Error {
  override name = "ExportBusyError";
  readonly retryAfterSeconds = 5;

  constructor() {
    super("Too many Word and PDF files are being created at the moment; try again in a few seconds");
  }
}

export const pageExportSlots = new OwnerSlots(
  MAX_PARALLEL_PAGE_EXPORTS,
  MAX_PARALLEL_PAGE_EXPORTS_PER_ACCOUNT,
  () => new ExportBusyError(),
);

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
  format: ExportFormat;
  options: ExportOptions;
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
  contentType: string;
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
  format: ExportFormat;
  options: unknown;
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
  kind: "page" | "whiteboard" | "folder" | "link" | "meetingSeries";
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
    format: row.format,
    options: readExportOptions(row.options),
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
  readonly #displayVersions: DisplayVersionService;
  readonly #storage: StorageService;
  readonly #documents: PageDocumentService;
  readonly #attachments: AttachmentService;
  readonly #reports: ReportService;
  readonly #includes: IncludeService;
  readonly #tasks: TaskService;
  readonly #people: PeopleService;
  readonly #address: InstanceAddressService;
  readonly #comments: CommentService;
  readonly #render: RenderService;
  readonly #jobs: JobQueue | undefined;
  readonly #logger: Logger;
  readonly #site: StaticSite | null;

  constructor(options: {
    database: Database;
    pool: DatabasePool;
    authorization: AuthorizationService;
    audit: AuditLog;
    notifications: NotificationService;
    settings: SettingsService;
    mail: MailService;
    files: FileService;
    displayVersions: DisplayVersionService;
    storage: StorageService;
    documents: PageDocumentService;
    attachments: AttachmentService;
    reports: ReportService;
    includes: IncludeService;
    tasks: TaskService;
    people: PeopleService;
    address: InstanceAddressService;
    comments: CommentService;
    render: RenderService;
    jobs: JobQueue | undefined;
    logger: Logger;
    site?: StaticSite;
  }) {
    this.#database = options.database;
    this.#pool = options.pool;
    this.#authorization = options.authorization;
    this.#audit = options.audit;
    this.#notifications = options.notifications;
    this.#settings = options.settings;
    this.#mail = options.mail;
    this.#files = options.files;
    this.#displayVersions = options.displayVersions;
    this.#storage = options.storage;
    this.#documents = options.documents;
    this.#attachments = options.attachments;
    this.#reports = options.reports;
    this.#includes = options.includes;
    this.#tasks = options.tasks;
    this.#people = options.people;
    this.#address = options.address;
    this.#comments = options.comments;
    this.#render = options.render;
    this.#jobs = options.jobs;
    this.#logger = options.logger;
    this.#site = options.site ?? null;
  }

  async #renderer(
    viewer: Principal,
    accountId: string,
  ): Promise<{ renderer: PageExportRenderer; language: string; origin: string }> {
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
    const origin = (await this.#address.get()).url ?? "";
    const renderer = new PageExportRenderer({
      database: this.#database,
      authorization: this.#authorization,
      documents: this.#documents,
      attachments: this.#attachments,
      reports: this.#reports,
      includes: this.#includes,
      tasks: this.#tasks,
      people: this.#people,
      logger: this.#logger,
      viewer,
      texts: exportTexts(language),
      format,
      origin,
    });
    return { renderer, language, origin };
  }

  #paged(
    viewer: Principal,
    renderer: PageExportRenderer,
    language: string,
    maxEmbeddedBytes?: number,
  ): PagedExport {
    return new PagedExport({
      database: this.#database,
      authorization: this.#authorization,
      attachments: this.#attachments,
      displayVersions: this.#displayVersions,
      files: this.#files,
      comments: this.#comments,
      logger: this.#logger,
      renderer,
      viewer,
      language,
      ...(maxEmbeddedBytes === undefined ? {} : { maxEmbeddedBytes }),
    });
  }

  async #exported(renderer: PageExportRenderer, accountId: string, now: Date): Promise<string> {
    const result = await this.#database.execute<{ name: string }>(
      sql`select name from accounts where id = ${accountId}`,
    );
    const date = renderer.format.date(now);
    const name = result.rows[0]?.name;
    return name ? renderer.texts.exportedBy(date, name) : renderer.texts.exported(date);
  }

  async #pdf(paged: PagedExport, html: string, origin: string, signal?: AbortSignal) {
    if (!this.#render.configured) throw new ExportFailure("renderUnavailable");
    try {
      return await this.#render.pdf(html, await paged.assets(), origin, signal);
    } catch (error) {
      if (error instanceof RenderError) throw new ExportFailure(renderFailure(error));
      throw error;
    }
  }

  get serverPdf(): boolean {
    return this.#render.configured;
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

  async page(
    actor: Principal,
    pageId: string,
    format: PageExportFormat,
    options: ExportOptions = defaultExportOptions,
  ): Promise<ExportFile> {
    if (actor.type !== "account") throw new ExportError("nothingToExport", "Only people can export pages");
    await this.#authorization.require(actor, "item.export", { type: "item", id: pageId });
    if (format === "pdf" && !this.#render.configured) {
      throw new ExportError("renderUnavailable", RENDER_UNAVAILABLE);
    }
    const { renderer, language, origin } = await this.#renderer(actor, actor.id);
    const prepared = await renderer.prepare(pageId);
    if (!prepared) throw new ExportError("nothingToExport", "The page has no published content to export");
    const stem = safeName(renderer.title(prepared), renderer.texts.untitledPage);
    if (format === "print") {
      return this.#pagedPage(actor, prepared, format, options, { renderer, language, origin, stem });
    }
    if (format === "pdf" || format === "docx") {
      return pageExportSlots.run(actor, () =>
        this.#pagedPage(actor, prepared, format, options, { renderer, language, origin, stem }),
      );
    }
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

  async #pagedPage(
    actor: Extract<Principal, { type: "account" }>,
    prepared: PreparedPage,
    format: "print" | "pdf" | "docx",
    options: ExportOptions,
    context: { renderer: PageExportRenderer; language: string; origin: string; stem: string },
  ): Promise<ExportFile> {
    const { renderer, language, origin, stem } = context;
    const paged = this.#paged(actor, renderer, language, MAX_PAGE_EXPORT_IMAGE_BYTES);
    const input = {
      entries: [{ id: prepared.id, depth: 0 }],
      title: renderer.title(prepared),
      path: prepared.path,
      exported: await this.#exported(renderer, actor.id, new Date()),
      options,
      prepare: async () => prepared,
      progress: async () => {},
    };
    if (format === "docx") {
      return { fileName: `${stem}.docx`, contentType: CONTENT_TYPES.docx, body: await paged.word(input) };
    }
    const html = await paged.print(input);
    if (format === "print") {
      return { fileName: `${stem}.html`, contentType: CONTENT_TYPES.print, body: Buffer.from(html, "utf8") };
    }
    try {
      return {
        fileName: `${stem}.pdf`,
        contentType: CONTENT_TYPES.pdf,
        body: await this.#pdf(paged, html, origin),
      };
    } catch (error) {
      if (error instanceof ExportFailure && error.code === "renderUnavailable") {
        throw new ExportError("renderUnavailable", RENDER_UNAVAILABLE);
      }
      if (error instanceof ExportFailure) {
        throw new ExportError("renderFailed", "The render container could not create the PDF");
      }
      throw error;
    }
  }

  async #requireTarget(actor: Principal, target: { spaceId: string } | { pageId: string }): Promise<void> {
    if ("spaceId" in target) {
      await this.#authorization.require(actor, "space.export", { type: "space", id: target.spaceId });
    } else {
      await this.#authorization.require(actor, "item.exportPages", { type: "item", id: target.pageId });
    }
  }

  async #countPages(
    viewer: Principal,
    spaceId: string,
    rootItemId: string | null,
  ): Promise<{ pages: number; blogPosts: number }> {
    const result = await this.#database.execute<{ pages: number; blog_posts: number }>(sql`
      select count(*) filter (where t.kind in ('page', 'whiteboard'))::int as pages,
        count(*) filter (where t.kind = 'blogPost' and b.published_at is not null)::int as blog_posts
      from tree_items t join spaces s on s.id = t.space_id left join blog_posts b on b.item_id = t.id
      where t.space_id = ${spaceId} and t.kind in ('page', 'whiteboard', 'blogPost') and t.reader_visible
        and t.trash_entry_id is null
        and ${rootItemId ? sql`${rootItemId}::uuid = any(t.path) and t.kind in ('page', 'whiteboard')` : sql`t.archived_root_id is null`}
        and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}`);
    const row = result.rows[0];
    return { pages: Number(row?.pages ?? 0), blogPosts: Number(row?.blog_posts ?? 0) };
  }

  async counts(
    actor: Principal,
    target: { spaceId: string } | { pageId: string },
  ): Promise<ExportSummaryCounts> {
    if (actor.type !== "account") throw new ExportError("nothingToExport", "Only people can export");
    await this.#requireTarget(actor, target);
    const subject = await this.#subject(target);
    if (!subject) throw new ExportError("nothingToExport", "There is nothing to export");
    return {
      ...(await this.#countPages(actor, subject.spaceId, subject.rootItemId)),
      printLimit: MAX_BROWSER_PRINT_PAGES,
      fileLimit: MAX_FILE_EXPORT_PAGES,
      serverPdf: this.#render.configured,
      largeWritesPaused: await this.#storage.requireLargeWrite().then(
        () => false,
        (error: unknown) => {
          if (error instanceof StorageFullError) return true;
          throw error;
        },
      ),
    };
  }

  async start(
    actor: Principal,
    target: { spaceId: string } | { pageId: string },
    request: ExportRequest = { format: "archive", options: defaultExportOptions },
  ): Promise<ExportSummary> {
    if (actor.type !== "account") throw new ExportError("nothingToExport", "Only people can export");
    const scope: ExportScope = "spaceId" in target ? "space" : "pages";
    await this.#requireTarget(actor, target);
    if (request.format === "pdf" && !this.#render.configured) {
      throw new ExportError("renderUnavailable", RENDER_UNAVAILABLE);
    }
    if (request.format === "site") {
      if (!this.#site || !("spaceId" in target)) {
        throw new ExportError(
          "nothingToExport",
          "A static website is built from a whole knowledge base. Start it in the settings of the knowledge base.",
        );
      }
      await this.#site.config(target.spaceId);
    }
    const subject = await this.#subject(target);
    if (!subject) throw new ExportError("nothingToExport", "There is nothing to export");
    if (request.format === "print" || request.format === "docx" || request.format === "pdf") {
      const counted = await this.#countPages(actor, subject.spaceId, subject.rootItemId);
      const total = counted.pages + counted.blogPosts;
      if (request.format === "print" && total > MAX_BROWSER_PRINT_PAGES) {
        throw new ExportError(
          "tooManyPagesToPrint",
          `Browsers can print up to ${MAX_BROWSER_PRINT_PAGES} pages at once. Export as Word or HTML instead, or as PDF on the server if the render container is set up.`,
        );
      }
      if (request.format !== "print" && total > MAX_FILE_EXPORT_PAGES) {
        throw new ExportError("tooManyPagesForFile", tooManyForFile(total));
      }
    }
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
            and format = ${request.format}
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
          insert into exports (id, account_id, token_id, started_with_token, organization_id, scope, format, options,
            space_id, root_item_id, name, estimated_size)
          values (${id}, ${actor.id}, ${actor.token?.id ?? null}, ${actor.token !== undefined},
            ${subject.organizationId}, ${scope}, ${request.format}, ${JSON.stringify(request.options)}::jsonb,
            ${subject.spaceId}, ${subject.rootItemId}, ${subject.name}, ${estimate})`);
        if (scope === "space") {
          await this.#audit.record(tx, {
            name: "space.exported",
            actor,
            targetId: subject.spaceId,
            fields: { name: subject.spaceName, key: subject.spaceKey, exportId: id, format: request.format },
            scope: auditScopeOf(subject),
          });
        } else {
          await this.#audit.record(tx, {
            name: "page.subtreeExported",
            actor,
            targetId: subject.rootItemId,
            fields: { spaceId: subject.spaceId, title: subject.name, exportId: id, format: request.format },
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
          where t.space_id = ${spaceId} and t.trash_entry_id is null ${within})
        + (select coalesce(sum(f.size), 0) from whiteboard_documents d
          join whiteboard_previews p on p.id = d.preview_id
          join stored_files f on f.id = p.file_id
          join tree_items t on t.id = d.item_id
          where t.space_id = ${spaceId} and t.trash_entry_id is null ${within}) as attachments,
        (select coalesce(sum(octet_length(coalesce(v.document::text, d.snapshot::text, ''))), 0)
          from tree_items t
          left join page_versions v on v.id = t.published_version_id and t.mode = 'publish'
          left join page_documents d on d.item_id = t.id and t.mode = 'live'
          where t.space_id = ${spaceId} and t.kind in ('page', 'blogPost') and t.trash_entry_id is null ${within}) as text,
        (select count(*)::int from tree_items t
          where t.space_id = ${spaceId} and t.kind in ('page', 'blogPost', 'whiteboard')
            and t.trash_entry_id is null ${within}) as pages`);
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
      fileName: row.file_name ?? `export.${EXTENSIONS[row.format]}`,
      contentType: CONTENT_TYPES[row.format],
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
        if (outOfMemory(error)) {
          this.#logger.error({ err: error, exportId: id }, "An export ran out of memory and is not retried");
          await this.#fail(row, "tooLargeToBuild");
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
        and t.kind in ('page', 'whiteboard', 'folder', 'link', 'meetingSeries')
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

  async #previews(itemIds: readonly string[]) {
    if (itemIds.length === 0) return [];
    const result = await this.#database.execute<{ item_id: string; file_id: string }>(sql`
      select d.item_id, f.id as file_id
      from whiteboard_documents d join whiteboard_previews p on p.id = d.preview_id
      join stored_files f on f.id = p.file_id and f.state = 'ready'
      where d.item_id = any(${sql.param([...itemIds])}::uuid[])`);
    return result.rows.map((preview) => ({ itemId: preview.item_id, fileId: preview.file_id }));
  }

  async #build(row: ExportRow, signal: AbortSignal): Promise<void> {
    const viewer = await this.#viewer(row);
    await this.#requireRoot(viewer, row);
    if (row.format === "site") return this.#buildSite(row, viewer, signal);
    const { renderer, language, origin } = await this.#renderer(viewer, row.account_id);
    const options = readExportOptions(row.options);
    const items = [
      ...(await this.#items(viewer, row)),
      ...(row.root_item_id ? [] : await this.#blogPosts(viewer, row, renderer.texts.blog)),
    ];
    const pageIds = items.filter((item) => item.kind === "page").map((item) => item.id);
    const boardIds = new Set(items.filter((item) => item.kind === "whiteboard").map((item) => item.id));
    if (row.root_item_id && !pageIds.includes(row.root_item_id)) throw new ExportFailure("noAccess");
    const prepared = new Map<string, PreparedPage>();
    const plan = planExport({
      rootId: row.root_item_id,
      items,
      attachments: await this.#publishedAttachments(pageIds),
      previews: await this.#previews([...boardIds]),
      untitledPage: renderer.texts.untitledPage,
      untitledFolder: renderer.texts.untitledFolder,
    });
    const paged = row.format === "print" || row.format === "pdf" || row.format === "docx";
    const withMarkdown = row.format === "archive" || row.format === "markdown";
    const withHtml = row.format === "archive" || row.format === "html";
    const withAttachments = row.format === "archive" || options.attachments;
    const total = paged
      ? plan.pages.length + 1
      : plan.pages.length * (withMarkdown && withHtml ? 2 : 1) +
        (withAttachments ? plan.attachments.length : 0) +
        plan.previews.length +
        1;
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
    const load = async (id: string) => {
      const page = boardIds.has(id) ? await renderer.prepareBoard(id) : await renderer.prepare(id);
      if (!page) throw new ExportFailure("noAccess");
      return page;
    };
    const prepare = async (node: PlannedNode) => {
      const cached = prepared.get(node.id);
      if (cached) {
        prepared.delete(node.id);
        return cached;
      }
      const page = await load(node.id);
      prepared.set(node.id, page);
      return page;
    };
    const now = new Date();
    let archive: Readable;
    if (paged) {
      if (row.format !== "print" && plan.pages.length > MAX_FILE_EXPORT_PAGES) {
        throw new ExportFailure("tooManyPagesForFile");
      }
      const depths = new Map(items.map((item) => [item.id, item.path.length]));
      const base = Math.min(...plan.pages.map((node) => depths.get(node.id) ?? 1));
      const pagedExport = this.#paged(viewer, renderer, language);
      const input = {
        entries: plan.pages.map(
          (node): PagedEntry => ({
            id: node.id,
            depth: Math.max(0, (depths.get(node.id) ?? base) - base),
          }),
        ),
        title: row.name,
        path: row.root_item_id ? await renderer.path(row.root_item_id) : [],
        exported: await this.#exported(renderer, row.account_id, now),
        options,
        prepare: load,
        progress,
      };
      let file: Buffer;
      if (row.format === "docx") {
        file = await pagedExport.word(input);
      } else {
        const printed = await pagedExport.print(input);
        file =
          row.format === "pdf"
            ? await this.#pdf(pagedExport, printed, origin, signal)
            : Buffer.from(printed, "utf8");
      }
      await progress();
      archive = Readable.from([file]);
    } else {
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
        if (withMarkdown) {
          entries.push({
            path: pageFile(node, "markdown"),
            mtime: now,
            compress: true,
            content: async () => {
              const page = await prepare(node);
              await progress();
              return Buffer.from(renderer.markdown(page, plan.locator(node)), "utf8");
            },
          });
        }
        if (withHtml) {
          entries.push({
            path: pageFile(node, "html"),
            mtime: now,
            compress: true,
            content: async () => {
              const page = await prepare(node);
              await progress();
              return Buffer.from(renderer.html(page, plan.locator(node), language), "utf8");
            },
          });
        }
        if (node.preview) {
          const preview = node.preview;
          entries.push({
            path: preview.path,
            mtime: now,
            compress: true,
            content: async () => {
              await progress();
              return this.#files.read(preview.fileId);
            },
          });
        }
        for (const attachment of withAttachments ? node.attachments : []) {
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
      archive = zipArchive(entries);
    }
    const fileName = `${safeName(row.name, renderer.texts.untitledPage)} ${now.toISOString().slice(0, 10)}.${EXTENSIONS[row.format]}`;
    await this.#store(row, archive, fileName, total, signal);
  }

  async #buildSite(row: ExportRow, viewer: Principal, signal: AbortSignal): Promise<void> {
    if (!this.#site || row.scope !== "space" || !row.space_id) throw new ExportFailure("noAccess");
    const { renderer } = await this.#renderer(viewer, row.account_id);
    const options = readExportOptions(row.options);
    const now = new Date();
    let entries: ArchiveEntry[];
    try {
      entries = await this.#site.entries(row.space_id, { siteUrl: options.siteUrl, now });
    } catch (error) {
      if (error instanceof SpaceError) {
        throw new ExportFailure(error.code === "staticSiteNotPublic" ? "notPublic" : "noAccess");
      }
      throw error;
    }
    const total = entries.length;
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
    const archive = zipArchive(
      entries.map((entry) => ({
        ...entry,
        content: async () => {
          const content = await entry.content();
          await progress();
          return content;
        },
      })),
    );
    const fileName = `${safeName(row.name, renderer.texts.untitledPage)} ${now.toISOString().slice(0, 10)}.${EXTENSIONS[row.format]}`;
    await this.#store(row, archive, fileName, total, signal);
  }

  async #store(
    row: ExportRow,
    archive: Readable,
    fileName: string,
    total: number,
    signal: AbortSignal,
  ): Promise<void> {
    const watch = this.#watchFreeSpace();
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
        if (node.kind === "page" || node.kind === "whiteboard") {
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
