import { commentKit, type DocumentJson, formatBytes, type RenderContext } from "@pagehall/editor-schema";
import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { CommentList, CommentService } from "../collaboration/comments.js";
import type { Database } from "../database/database.js";
import type { AttachmentService } from "../files/attachments.js";
import type { FileService } from "../files/files.js";
import type { Logger } from "../logging/logger.js";
import { blocksOfType } from "../spaces/documents.js";
import type { ExportOptions } from "./options.js";
import { type PrintAttachment, type PrintComment, type PrintPage, pageAnchor, printHtml } from "./print.js";
import { type Locator, nowhere, type PageExportRenderer, type PreparedPage } from "./renderer.js";
import type { RenderAsset } from "./rendering.js";
import { imageInfo, type WordComment, type WordImage, type WordPage, wordDocument } from "./word.js";

export const MAX_EMBEDDED_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_EMBEDDED_TOTAL_BYTES = 100 * 1024 * 1024;

type ReadImage = { data: Buffer; contentType: string } | null;

export interface PagedEntry {
  id: string;
  depth: number;
}

export interface PagedInput {
  entries: readonly PagedEntry[];
  title: string;
  path: readonly string[];
  exported: string;
  options: ExportOptions;
  prepare(id: string): Promise<PreparedPage | null>;
  progress(): Promise<void>;
}

interface Thread {
  quote: string | null;
  author: string;
  date: string;
  body: DocumentJson | null;
  replies: { author: string; date: string; body: DocumentJson | null }[];
}

export class PagedExport {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #attachments: AttachmentService;
  readonly #files: FileService;
  readonly #comments: CommentService;
  readonly #logger: Logger;
  readonly #renderer: PageExportRenderer;
  readonly #viewer: Principal;
  readonly #language: string;
  readonly #images = new Map<string, Promise<ReadImage>>();
  readonly #maxEmbedded: number;
  #embedded = 0;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    attachments: AttachmentService;
    files: FileService;
    comments: CommentService;
    logger: Logger;
    renderer: PageExportRenderer;
    viewer: Principal;
    language: string;
    maxEmbeddedBytes?: number;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#attachments = options.attachments;
    this.#files = options.files;
    this.#comments = options.comments;
    this.#logger = options.logger;
    this.#renderer = options.renderer;
    this.#viewer = options.viewer;
    this.#language = options.language;
    this.#maxEmbedded = options.maxEmbeddedBytes ?? MAX_EMBEDDED_TOTAL_BYTES;
  }

  #printLocator(ids: ReadonlySet<string>): Locator {
    return {
      page: (pageId) => (ids.has(pageId) ? `#${pageAnchor(pageId)}` : null),
      attachment: (attachmentId) => `/api/v1/attachments/${attachmentId}/content`,
      index: () => null,
    };
  }

  async #threads(pageId: string): Promise<{ threads: Thread[]; people: CommentList["people"] }> {
    const { threads, people } = await this.#comments.list(this.#viewer, pageId);
    const { texts, format } = this.#renderer;
    const name = (person: { name: string | null } | null, deleted: boolean) =>
      deleted ? texts.deletedComment : (person?.name ?? texts.labels.unknownPerson);
    return {
      people,
      threads: threads
        .filter((thread) => thread.resolvedAt === null)
        .map((thread) => ({
          quote: thread.anchor === "page" ? null : thread.quote,
          author: name(thread.author, thread.deleted),
          date: format.dateTime(thread.createdAt),
          body: thread.body,
          replies: thread.replies.map((reply) => ({
            author: name(reply.author, reply.deleted),
            date: format.dateTime(reply.createdAt),
            body: reply.body,
          })),
        })),
    };
  }

  #commentContext(people: CommentList["people"]): RenderContext {
    return {
      labels: this.#renderer.texts.labels,
      mention: (id) => (people[id] ? { name: people[id] } : null),
      formatDate: (iso) => this.#renderer.format.day(iso),
    };
  }

  async #printComments(pageId: string): Promise<PrintComment[]> {
    const { threads, people } = await this.#threads(pageId);
    const context = { ...this.#commentContext(people), target: "print" as const };
    const body = (document: DocumentJson | null) =>
      document ? commentKit.renderHtml(document, context) : "";
    return threads.map((thread) => ({
      quote: thread.quote,
      author: thread.author,
      date: thread.date,
      body: body(thread.body),
      replies: thread.replies.map((reply) => ({
        author: reply.author,
        date: reply.date,
        body: body(reply.body),
      })),
    }));
  }

  async #wordComments(pageId: string): Promise<WordComment[]> {
    const { threads, people } = await this.#threads(pageId);
    const context = this.#commentContext(people);
    const body = (document: DocumentJson | null) =>
      document ? commentKit.renderWord(document, context) : [];
    return threads.map((thread) => ({
      quote: thread.quote,
      author: thread.author,
      date: thread.date,
      body: body(thread.body),
      replies: thread.replies.map((reply) => ({
        author: reply.author,
        date: reply.date,
        body: body(reply.body),
      })),
    }));
  }

  async #appendix(pages: readonly PreparedPage[]): Promise<PrintAttachment[]> {
    if (pages.length === 0) return [];
    const titles = new Map(pages.map((page) => [page.id, this.#renderer.title(page)]));
    const result = await this.#database.execute<{ item_id: string; name: string; size: string | number }>(sql`
      select a.item_id, v.name, f.size
      from attachments a join attachment_versions v on v.id = a.published_version_id
      join stored_files f on f.id = v.file_id and f.state = 'ready'
      where a.item_id = any(${sql.param([...titles.keys()])}::uuid[])
      order by array_position(${sql.param([...titles.keys()])}::uuid[], a.item_id), lower(v.name), a.id`);
    return result.rows.map((row) => ({
      name: row.name,
      page: titles.get(row.item_id) ?? "",
      size: formatBytes(Number(row.size)),
    }));
  }

  async #collect(input: PagedInput): Promise<{ entry: PagedEntry; page: PreparedPage }[]> {
    const pages: { entry: PagedEntry; page: PreparedPage }[] = [];
    for (const entry of input.entries) {
      const page = await input.prepare(entry.id);
      await input.progress();
      if (page) pages.push({ entry, page });
    }
    return pages;
  }

  async print(input: PagedInput): Promise<{ html: string; pages: PreparedPage[] }> {
    const pages = await this.#collect(input);
    const locator = this.#printLocator(new Set(pages.map(({ page }) => page.id)));
    const printed: PrintPage[] = [];
    for (const { entry, page } of pages) {
      printed.push({
        id: page.id,
        depth: entry.depth,
        title: this.#renderer.title(page),
        path: page.path,
        meta: this.#renderer.meta(page),
        body: this.#renderer.printBody(page, locator),
        headings: this.#renderer.headings(page),
        comments: input.options.comments ? await this.#printComments(page.id) : [],
      });
    }
    const prepared = pages.map(({ page }) => page);
    const html = printHtml({
      language: this.#language,
      title: input.title,
      path: input.path,
      exported: input.exported,
      options: input.options,
      texts: this.#renderer.texts,
      pages: printed,
      attachments: input.options.attachments ? await this.#appendix(prepared) : [],
    });
    return { html, pages: prepared };
  }

  async word(input: PagedInput): Promise<Buffer> {
    const pages = await this.#collect(input);
    const words: WordPage[] = [];
    for (const { entry, page } of pages) {
      words.push({
        id: page.id,
        depth: entry.depth,
        title: this.#renderer.title(page),
        path: page.path,
        meta: this.#renderer.meta(page),
        blocks: this.#renderer.wordBody(page, nowhere),
        comments: input.options.comments ? await this.#wordComments(page.id) : [],
      });
    }
    return wordDocument({
      title: input.title,
      path: input.path,
      exported: input.exported,
      options: input.options,
      texts: this.#renderer.texts,
      pages: words,
      attachments: input.options.attachments ? await this.#appendix(pages.map(({ page }) => page)) : [],
      image: (attachmentId) => this.#image(attachmentId),
    });
  }

  #readable(attachmentId: string): Promise<ReadImage> {
    const cached = this.#images.get(attachmentId);
    if (cached) return cached;
    const read = this.#read(attachmentId);
    this.#images.set(attachmentId, read);
    return read;
  }

  async #read(attachmentId: string): Promise<ReadImage> {
    const allowed = await this.#authorization.authorize(this.#viewer, "attachment.view", {
      type: "attachment",
      id: attachmentId,
    });
    if (!allowed) return null;
    const content = await this.#attachments.content(attachmentId, "published");
    if (!content?.contentType.startsWith("image/") || content.size > MAX_EMBEDDED_IMAGE_BYTES) return null;
    if (this.#embedded + content.size > this.#maxEmbedded) return null;
    this.#embedded += content.size;
    try {
      const stream = await this.#files.read(content.fileId);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      return { data: Buffer.concat(chunks), contentType: content.contentType };
    } catch (error) {
      this.#logger.warn({ err: error, attachmentId }, "An image could not be read for an export");
      return null;
    }
  }

  async #image(attachmentId: string): Promise<WordImage | null> {
    const read = await this.#readable(attachmentId);
    if (!read) return null;
    const info = imageInfo(read.data);
    return info ? { ...info, data: read.data } : null;
  }

  async assets(pages: readonly PreparedPage[]): Promise<RenderAsset[]> {
    const ids = new Set<string>();
    for (const page of pages) {
      for (const image of blocksOfType(page.document, "image")) {
        const id = image.attrs?.attachmentId;
        if (typeof id === "string") ids.add(id);
      }
      for (const drawing of blocksOfType(page.document, "drawing")) {
        const id = drawing.attrs?.previewId;
        if (typeof id === "string") ids.add(id);
      }
    }
    const assets: RenderAsset[] = [];
    for (const id of ids) {
      const read = await this.#readable(id);
      if (read)
        assets.push({
          path: `/api/v1/attachments/${id}/content`,
          contentType: read.contentType,
          data: read.data,
        });
    }
    return assets;
  }
}
