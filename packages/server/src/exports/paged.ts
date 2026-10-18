import {
  commentKit,
  type DocumentJson,
  diagramTypes,
  formatBytes,
  type RenderContext,
} from "@pagehall/editor-schema";
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
import {
  type BoardPreview,
  type Locator,
  nowhere,
  type PageExportRenderer,
  type PreparedPage,
  whiteboardPreviewPath,
} from "./renderer.js";
import type { RenderAsset } from "./rendering.js";
import { imageInfo, type WordComment, type WordImage, type WordPage, wordDocument } from "./word.js";

export const MAX_EMBEDDED_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_EMBEDDED_TOTAL_BYTES = 100 * 1024 * 1024;

type ImageFile = { fileId: string; size: number; contentType: string } | null;

interface ListedPage {
  id: string;
  title: string;
}

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
  readonly #images = new Map<string, Promise<ImageFile>>();
  readonly #boards = new Map<string, BoardPreview>();
  readonly #exported = new Set<string>();
  readonly #assetIds = new Set<string>();
  readonly #assetBoards = new Set<string>();
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
      preview: (itemId) => whiteboardPreviewPath(itemId),
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

  async #appendix(pages: readonly ListedPage[]): Promise<PrintAttachment[]> {
    if (pages.length === 0) return [];
    const titles = new Map(pages.map((page) => [page.id, page.title]));
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

  async *#pages(input: PagedInput): AsyncGenerator<{ entry: PagedEntry; page: PreparedPage }> {
    for (const entry of input.entries) {
      const page = await input.prepare(entry.id);
      await input.progress();
      if (!page) continue;
      this.#exported.add(page.id);
      if (page.board?.preview) this.#boards.set(page.id, page.board.preview);
      for (const [id, board] of page.whiteboards ?? []) {
        if (board.preview) this.#boards.set(id, board.preview);
      }
      yield { entry, page };
    }
  }

  async print(input: PagedInput): Promise<string> {
    const ids = new Set(input.entries.map((entry) => entry.id));
    const locator = this.#printLocator(ids);
    const printed: PrintPage[] = [];
    const listed: ListedPage[] = [];
    for await (const { entry, page } of this.#pages(input)) {
      const title = this.#renderer.title(page);
      printed.push({
        id: page.id,
        depth: entry.depth,
        title,
        path: page.path,
        meta: this.#renderer.meta(page),
        body: this.#renderer.printBody(page, locator),
        headings: this.#renderer.headings(page),
        comments: input.options.comments ? await this.#printComments(page.id) : [],
      });
      this.noteAssets(page);
      listed.push({ id: page.id, title });
    }
    return printHtml({
      language: this.#language,
      title: input.title,
      path: input.path,
      exported: input.exported,
      options: input.options,
      texts: this.#renderer.texts,
      pages: printed,
      attachments: input.options.attachments ? await this.#appendix(listed) : [],
    });
  }

  async word(input: PagedInput): Promise<Buffer> {
    const words: WordPage[] = [];
    const listed: ListedPage[] = [];
    for await (const { entry, page } of this.#pages(input)) {
      const title = this.#renderer.title(page);
      words.push({
        id: page.id,
        depth: entry.depth,
        title,
        path: page.path,
        meta: this.#renderer.meta(page),
        blocks: this.#renderer.wordBody(page, nowhere),
        comments: input.options.comments ? await this.#wordComments(page.id) : [],
      });
      listed.push({ id: page.id, title });
    }
    return wordDocument({
      title: input.title,
      path: input.path,
      exported: input.exported,
      options: input.options,
      texts: this.#renderer.texts,
      pages: words,
      attachments: input.options.attachments ? await this.#appendix(listed) : [],
      image: (attachmentId) => this.#image(attachmentId),
    });
  }

  #cached(key: string, read: () => Promise<ImageFile>): Promise<ImageFile> {
    const cached = this.#images.get(key);
    if (cached) return cached;
    const reading = read();
    this.#images.set(key, reading);
    return reading;
  }

  #readable(attachmentId: string): Promise<ImageFile> {
    return this.#cached(`attachment:${attachmentId}`, () => this.#read(attachmentId));
  }

  #boardImage(itemId: string, preview: BoardPreview): Promise<ImageFile> {
    return this.#cached(`whiteboard:${itemId}`, async () =>
      this.#within({ fileId: preview.fileId, size: preview.size, contentType: "image/svg+xml" }),
    );
  }

  async #read(attachmentId: string): Promise<ImageFile> {
    const allowed = await this.#authorization.authorize(this.#viewer, "attachment.view", {
      type: "attachment",
      id: attachmentId,
    });
    if (!allowed) return null;
    const owner = await this.#database.execute<{ item_id: string }>(
      sql`select item_id from attachments where id = ${attachmentId}`,
    );
    const itemId = owner.rows[0]?.item_id;
    if (!itemId) return null;
    if (!this.#exported.has(itemId) && !(await this.#renderer.exportable([itemId])).has(itemId)) return null;
    const content = await this.#attachments.content(attachmentId, "published");
    if (!content?.contentType.startsWith("image/")) return null;
    return this.#within({ fileId: content.fileId, size: content.size, contentType: content.contentType });
  }

  #within(file: NonNullable<ImageFile>): ImageFile {
    if (file.size > MAX_EMBEDDED_IMAGE_BYTES || this.#embedded + file.size > this.#maxEmbedded) return null;
    this.#embedded += file.size;
    return file;
  }

  async #bytes(file: NonNullable<ImageFile>): Promise<Buffer | null> {
    try {
      const stream = await this.#files.read(file.fileId);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks);
    } catch (error) {
      this.#logger.warn({ err: error, fileId: file.fileId }, "An image could not be read for an export");
      return null;
    }
  }

  async #image(attachmentId: string): Promise<WordImage | null> {
    const board = this.#boards.get(attachmentId);
    const file = await (board ? this.#boardImage(attachmentId, board) : this.#readable(attachmentId));
    const data = file ? await this.#bytes(file) : null;
    if (!data) return null;
    const info = imageInfo(data);
    return info ? { ...info, data } : null;
  }

  noteAssets(page: PreparedPage): void {
    this.#exported.add(page.id);
    if (page.board?.preview) {
      this.#boards.set(page.id, page.board.preview);
      this.#assetBoards.add(page.id);
    }
    for (const [id, board] of page.whiteboards ?? []) {
      if (!board.preview) continue;
      this.#boards.set(id, board.preview);
      this.#assetBoards.add(id);
    }
    for (const image of blocksOfType(page.document, "image")) {
      const id = image.attrs?.attachmentId;
      if (typeof id === "string") this.#assetIds.add(id);
    }
    for (const id of page.images) this.#assetIds.add(id);
    for (const embed of blocksOfType(page.document, "embed")) {
      const id = embed.attrs?.thumbnailId;
      if (typeof id === "string") this.#assetIds.add(id);
    }
    for (const type of ["drawing", ...diagramTypes]) {
      for (const block of blocksOfType(page.document, type)) {
        const id = block.attrs?.previewId;
        if (typeof id === "string") this.#assetIds.add(id);
      }
    }
    for (const diagram of page.diagrams?.values() ?? []) {
      if (diagram.previewId) this.#assetIds.add(diagram.previewId);
    }
  }

  async assets(): Promise<RenderAsset[]> {
    const assets: RenderAsset[] = [];
    const asset = (path: string, file: ImageFile) => {
      if (!file) return;
      const { fileId, size, contentType } = file;
      assets.push({ path, contentType, size, open: () => this.#files.read(fileId) });
    };
    for (const id of this.#assetBoards) {
      const board = this.#boards.get(id);
      if (board) asset(whiteboardPreviewPath(id), await this.#boardImage(id, board));
    }
    for (const id of this.#assetIds) asset(`/api/v1/attachments/${id}/content`, await this.#readable(id));
    return assets;
  }
}
