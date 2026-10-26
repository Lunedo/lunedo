import {
  type ChildPagesRequest,
  type ContentByLabelRequest,
  type DecisionReportRequest,
  type DocumentJson,
  escapeHtml,
  excerptContent,
  extractHeadings,
  formatBytes,
  type Heading,
  type IncludedContent,
  type IncludeRequest,
  includeRequest,
  type LabeledContent,
  type ListedAttachment,
  type ListedPage,
  MAX_INCLUDE_DEPTH,
  markdownUrl,
  type PageReportRequest,
  type PropertiesReport,
  type PropertiesReportRequest,
  type ReferencedDiagram,
  type RelatedLabel,
  type RelatedLabelsRequest,
  type RenderContext,
  type RenderLabels,
  type ReportedDecision,
  type ReportedPage,
  type ReportedTask,
  renderHtml,
  renderMarkdown,
  renderWord,
  type TaskReportRequest,
  taskReportRequest,
  type WordBlock,
} from "@lunedo/editor-schema";
import { sql } from "drizzle-orm";
import { dump } from "js-yaml";
import type { Principal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { TaskService } from "../collaboration/tasks.js";
import type { Database } from "../database/database.js";
import type { AttachmentService } from "../files/attachments.js";
import type { Logger } from "../logging/logger.js";
import { itemAddress } from "../spaces/addresses.js";
import {
  blocksOfType,
  childPagesKey,
  diagramKey,
  type PageDocumentService,
  type PageReferences,
  type ReferencedBoard,
  referencedPageLink,
  relatedLabelsKey,
  reportKey,
} from "../spaces/documents.js";
import { type IncludeService, includeKey } from "../spaces/includes.js";
import type { PeopleService } from "../spaces/people.js";
import type { ReportService } from "../spaces/reports.js";
import { visibleItem } from "../spaces/visibility.js";
import { exportStyle } from "./style.js";
import type { ExportTexts } from "./texts.js";
import { svgPalette } from "./word.js";

export type ExportFormat = "markdown" | "html";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PAGE_ADDRESS = new RegExp(
  `^/spaces/[^/?#]*/(?:pages|blog)/(${UUID})(?:/[^?#]*)?(?:\\?[^#]*)?(#.*)?$`,
  "i",
);
const NUMBERED_ADDRESS =
  /^\/(?:spaces\/[^/?#]*\/(?:pages|blog|whiteboards|folders|meetings|topics)|shared)\/([1-9][0-9]{0,14})(?:\/[^?#]*)?(?:\?[^#]*)?(#.*)?$/;
const ATTACHMENT_ADDRESS = new RegExp(`^/api/v1/attachments/(${UUID})/content(\\?size=display)?$`, "i");
const WHITEBOARD_PREVIEW_ADDRESS = new RegExp(`^/api/v1/whiteboards/(${UUID})/preview$`, "i");
const MAX_REPORTED_TASKS = 200;
const MAX_INCLUDES = 50;
const MAX_INCLUDED_PAGES = 100;
const INCLUDE_BLOCKS = ["includeExcerpt", "includePage"];

type Module =
  | "childPages"
  | "attachmentList"
  | "pageReport"
  | "decisionReport"
  | "taskReport"
  | "taskStatus"
  | "propertiesReport"
  | "include";

export type PreparedInclusion =
  | { state: "visible"; title: string; href: string; document: DocumentJson; page: PreparedPage }
  | { state: "hidden" | "loop" | "depth" | "noExcerpt" };

export interface Locator {
  page(pageId: string, format: ExportFormat): string | null;
  attachment(attachmentId: string, display?: boolean): string | null;
  preview(itemId: string): string | null;
  index(format: ExportFormat): string | null;
}

export const nowhere: Locator = {
  page: () => null,
  attachment: () => null,
  preview: () => null,
  index: () => null,
};

export function whiteboardPreviewPath(itemId: string): string {
  return `/api/v1/whiteboards/${itemId}/preview`;
}

export interface BoardPreview {
  fileId: string;
  size: number;
}

export interface ExportFormatter {
  date(date: Date): string;
  day(iso: string): string;
  dateTime(date: Date): string;
}

export interface PageFacts {
  createdAt: Date | null;
  labels: readonly string[];
  articleType: string | null;
  language: string | null;
  translation: boolean;
}

export interface PreparedPage {
  id: string;
  facts?: PageFacts;
  title: string;
  author: string | null;
  path: readonly string[];
  version: number | null;
  updatedAt: Date;
  document: DocumentJson;
  references: PageReferences;
  numbers: ReadonlyMap<number, string>;
  childPages: ReadonlyMap<string, readonly ListedPage[]> | null;
  attachments: readonly ListedAttachment[] | null;
  pageReports: ReadonlyMap<string, readonly ReportedPage[]> | null;
  decisionReports: ReadonlyMap<string, readonly ReportedDecision[]> | null;
  taskReports: ReadonlyMap<string, readonly ReportedTask[]> | null;
  propertiesReports: ReadonlyMap<string, PropertiesReport> | null;
  contentByLabel: ReadonlyMap<string, readonly LabeledContent[]> | null;
  relatedLabels: ReadonlyMap<string, readonly RelatedLabel[]> | null;
  included: ReadonlyMap<string, PreparedInclusion> | null;
  taskStatus: ReadonlyMap<string, boolean> | null;
  diagrams: ReadonlyMap<string, ReferencedDiagram> | null;
  whiteboards: ReadonlyMap<string, ReferencedBoard> | null;
  images: ReadonlySet<string>;
  numberHeadings: boolean;
  meeting: { startsAt: Date | null; attendees: string[] } | null;
  unavailable: ReadonlySet<Module>;
  failed: boolean;
  board: { preview: BoardPreview | null } | null;
}

export interface RenderedPage {
  markdown: string;
  html: string;
}

function numberOf(href: string): number | null {
  const found = NUMBERED_ADDRESS.exec(href)?.[1];
  return found ? Number(found) : null;
}

function pageIdOf(href: string, numbers: ReadonlyMap<number, string>): string | null {
  const id = PAGE_ADDRESS.exec(href)?.[1]?.toLowerCase();
  if (id) return id;
  const number = numberOf(href);
  return number === null ? null : (numbers.get(number) ?? null);
}

function listedVisible(
  href: string,
  visible: ReadonlySet<string>,
  numbers: ReadonlyMap<number, string>,
): boolean {
  const id = pageIdOf(href, numbers);
  return id === null ? numberOf(href) === null : visible.has(id);
}

function keepVisiblePages(
  pages: readonly ListedPage[],
  visible: ReadonlySet<string>,
  numbers: ReadonlyMap<number, string>,
): ListedPage[] {
  return pages.flatMap((page) => {
    if (!listedVisible(page.href, visible, numbers)) return [];
    return [{ ...page, children: keepVisiblePages(page.children, visible, numbers) }];
  });
}

function collectListedHrefs(pages: readonly ListedPage[], into: string[]): void {
  for (const page of pages) {
    into.push(page.href);
    collectListedHrefs(page.children, into);
  }
}

type Target = ExportFormat | "print";

type ContextTarget = "screen" | "print" | "word";

const emptyModules = {
  propertiesReports: null,
  contentByLabel: null,
  relatedLabels: null,
  included: null,
} as const;

export class PageExportRenderer {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #documents: PageDocumentService;
  readonly #attachments: AttachmentService;
  readonly #reports: ReportService;
  readonly #includes: IncludeService;
  readonly #tasks: TaskService;
  readonly #people: PeopleService;
  readonly #logger: Logger;
  readonly #viewer: Principal;
  readonly #texts: ExportTexts;
  readonly #format: ExportFormatter;
  readonly #origin: string;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    documents: PageDocumentService;
    attachments: AttachmentService;
    reports: ReportService;
    includes: IncludeService;
    tasks: TaskService;
    people: PeopleService;
    logger: Logger;
    viewer: Principal;
    texts: ExportTexts;
    format: ExportFormatter;
    origin: string;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#documents = options.documents;
    this.#attachments = options.attachments;
    this.#reports = options.reports;
    this.#includes = options.includes;
    this.#tasks = options.tasks;
    this.#people = options.people;
    this.#logger = options.logger;
    this.#viewer = options.viewer;
    this.#texts = options.texts;
    this.#format = options.format;
    this.#origin = options.origin.replace(/\/+$/, "");
  }

  get texts(): ExportTexts {
    return this.#texts;
  }

  get format(): ExportFormatter {
    return this.#format;
  }

  async #load<T>(module: Module, unavailable: Set<Module>, load: () => Promise<T>): Promise<T | null> {
    try {
      return await load();
    } catch (error) {
      this.#logger.warn({ err: error, module }, "A module could not be prepared for an export");
      unavailable.add(module);
      return null;
    }
  }

  async #readerVisible(ids: Iterable<string>): Promise<Set<string>> {
    const list = [...new Set(ids)];
    if (list.length === 0) return new Set();
    const result = await this.#database.execute<{ id: string }>(sql`
      select id from tree_items where id = any(${sql.param(list)}::uuid[]) and reader_visible`);
    return new Set(result.rows.map((row) => row.id));
  }

  async #numbered(hrefs: Iterable<string>): Promise<Map<number, string>> {
    const wanted = [...new Set([...hrefs].flatMap((href) => numberOf(href) ?? []))];
    if (wanted.length === 0) return new Map();
    const result = await this.#database.execute<{ id: string; number: string }>(sql`
      select id, number from tree_items where number = any(${sql.param(wanted)}::bigint[])`);
    return new Map(result.rows.map((row) => [Number(row.number), row.id]));
  }

  async path(pageId: string): Promise<string[]> {
    const result = await this.#database.execute<{ space: string; title: string | null }>(sql`
      select s.name as space, a.title
      from tree_items t join spaces s on s.id = t.space_id
      left join lateral (
        select case when p.kind = 'page' and p.mode = 'publish' then coalesce(v.title, p.title) else p.title end
            as title,
          array_position(t.path, p.id) as position
        from tree_items p left join page_versions v on v.id = p.published_version_id
        where p.id = any(t.path) and p.id <> t.id and p.reader_visible
          and ${visibleItem(this.#authorization, this.#viewer, sql`p`, sql`s`)}
      ) a on true
      where t.id = ${pageId}
      order by a.position nulls first`);
    const [first] = result.rows;
    if (!first) return [];
    return [
      first.space,
      ...result.rows.flatMap((row) =>
        row.title === null ? [] : [row.title.trim() || this.#texts.untitledPage],
      ),
    ];
  }

  async #author(accountId: string | null): Promise<string | null> {
    if (!accountId) return null;
    return (await this.#people.visibleNames(this.#viewer, [accountId])).get(accountId) ?? null;
  }

  async #inclusions(
    pageId: string,
    document: DocumentJson,
    chain: readonly string[],
    budget: { left: number },
  ): Promise<Map<string, PreparedInclusion>> {
    const result = new Map<string, PreparedInclusion>();
    const blocks = INCLUDE_BLOCKS.flatMap((type) => blocksOfType(document, type));
    for (const block of blocks) {
      const request = includeRequest({
        type: block.type,
        attrs: { pageId: null, sourceSpace: null, sourceTitle: null, name: null, ...block.attrs },
      });
      const key = includeKey(request);
      if (result.has(key)) continue;
      if (result.size >= MAX_INCLUDES) break;
      result.set(key, await this.#inclusion(pageId, request, chain, budget));
    }
    return result;
  }

  async #inclusion(
    pageId: string,
    request: IncludeRequest,
    chain: readonly string[],
    budget: { left: number },
  ): Promise<PreparedInclusion> {
    const target = await this.#includes.target(this.#viewer, pageId, request);
    if (!target || !(await this.#readerVisible([target.id])).has(target.id)) return { state: "hidden" };
    if (
      !(await this.#authorization.authorize(this.#viewer, "item.export", { type: "item", id: target.id }))
    ) {
      return { state: "hidden" };
    }
    if (target.id === pageId || chain.includes(target.id)) return { state: "loop" };
    if (chain.length + 1 > MAX_INCLUDE_DEPTH || budget.left <= 0) return { state: "depth" };
    budget.left -= 1;
    const prepared = await this.prepare(target.id, [...chain, pageId], budget);
    if (!prepared || prepared.failed) return { state: "hidden" };
    const content = request.excerpt
      ? excerptContent(prepared.document, request.name)
      : (prepared.document.content ?? []);
    if (!content) return { state: "noExcerpt" };
    return {
      state: "visible",
      title: prepared.title,
      href: target.path,
      document: { type: "doc", content },
      page: prepared,
    };
  }

  async prepare(
    pageId: string,
    chain: readonly string[] = [],
    budget = { left: MAX_INCLUDED_PAGES },
  ): Promise<PreparedPage | null> {
    const readable = await this.#documents.readable(pageId);
    if (!readable) return null;
    const document = readable.document;
    const unavailable = new Set<Module>();
    const author = await this.#author(readable.updatedBy);
    const path = await this.path(pageId);
    try {
      const references = await this.#documents.references(this.#viewer, document);
      const childPages = await this.#load("childPages", unavailable, () =>
        this.#documents.childPages(this.#viewer, pageId, document),
      );
      const attachments = blocksOfType(document, "attachmentList").length
        ? await this.#load("attachmentList", unavailable, async () =>
            (await this.#attachments.list(this.#viewer, pageId, "published")).map(({ id, name, size }) => ({
              id,
              name,
              size,
            })),
          )
        : null;
      const reports = await this.#load("pageReport", unavailable, () =>
        this.#reports.forDocument(this.#viewer, document, pageId),
      );
      if (!reports) {
        unavailable.add("decisionReport");
        unavailable.add("propertiesReport");
      }
      const included = await this.#load("include", unavailable, () =>
        this.#inclusions(pageId, document, chain, budget),
      );
      const taskReports = await this.#load("taskReport", unavailable, () => this.#taskReports(document));
      const taskStatus = await this.#load("taskStatus", unavailable, async () => {
        const statuses = await this.#tasks.statuses(this.#viewer, pageId);
        return new Map(statuses.map((status) => [status.id, status.done]));
      });
      const diagrams = await this.#diagrams(document);
      const whiteboards = await this.#whiteboards(document);
      const images = await this.#previewImages(document);
      const meeting = await this.#meeting(pageId);
      const merged: PageReferences = {
        people: { ...reports?.references.people, ...references.people },
        pages: { ...reports?.references.pages, ...references.pages },
        topics: references.topics,
        tooLargeImages: references.tooLargeImages,
      };
      const listed: string[] = [];
      for (const report of reports?.propertiesReports.values() ?? []) {
        for (const row of report.rows) listed.push(row.href);
      }
      for (const items of reports?.contentByLabel.values() ?? []) {
        for (const item of items) listed.push(item.href);
      }
      for (const pages of childPages?.values() ?? []) collectListedHrefs(pages, listed);
      for (const pages of reports?.pageReports.values() ?? []) {
        for (const page of pages) listed.push(page.href);
      }
      for (const decisions of reports?.decisionReports.values() ?? []) {
        for (const decision of decisions) listed.push(decision.page.href);
      }
      for (const tasks of taskReports?.values() ?? []) {
        for (const task of tasks) listed.push(task.page.href);
      }
      const linked = [
        ...[...(included?.values() ?? [])].flatMap((inclusion) =>
          inclusion.state === "visible" ? [inclusion.href] : [],
        ),
        ...[...diagrams.values()].map((diagram) => diagram.href),
        ...[...whiteboards.values()].map((board) => board.href),
      ];
      const numbers = await this.#numbered([...listed, ...linked]);
      for (const [id, page] of Object.entries(merged.pages)) {
        if (page.number !== null) numbers.set(page.number, id);
      }
      for (const inclusion of included?.values() ?? []) {
        if (inclusion.state !== "visible") continue;
        for (const [number, id] of inclusion.page.numbers) numbers.set(number, id);
      }
      const referenced = new Set<string>(Object.keys(merged.pages));
      for (const href of listed) referenced.add(pageIdOf(href, numbers) ?? "");
      referenced.delete("");
      const visible = await this.#readerVisible(referenced);
      const shown = (href: string) => listedVisible(href, visible, numbers);
      return {
        id: pageId,
        title: readable.title,
        author,
        path,
        version: readable.version,
        updatedAt: readable.updatedAt,
        document,
        references: {
          ...merged,
          pages: Object.fromEntries(
            Object.entries(merged.pages).map(([id, page]) => [
              id,
              page.accessible && !visible.has(id)
                ? { title: "", spaceKey: "", kind: "page", number: null, accessible: false, inTrash: false }
                : page,
            ]),
          ),
        },
        numbers,
        childPages: childPages
          ? new Map([...childPages].map(([key, pages]) => [key, keepVisiblePages(pages, visible, numbers)]))
          : null,
        attachments,
        pageReports: reports
          ? new Map(
              [...reports.pageReports].map(([key, pages]) => [key, pages.filter((page) => shown(page.href))]),
            )
          : null,
        decisionReports: reports
          ? new Map(
              [...reports.decisionReports].map(([key, decisions]) => [
                key,
                decisions.filter((decision) => shown(decision.page.href)),
              ]),
            )
          : null,
        taskReports: taskReports
          ? new Map(
              [...taskReports].map(([key, tasks]) => [key, tasks.filter((task) => shown(task.page.href))]),
            )
          : null,
        propertiesReports: reports
          ? new Map(
              [...reports.propertiesReports].map(([key, report]) => {
                const rows = report.rows.filter((row) => shown(row.href));
                return [key, { ...report, rows, total: report.total - (report.rows.length - rows.length) }];
              }),
            )
          : null,
        contentByLabel: reports
          ? new Map(
              [...reports.contentByLabel].map(([key, items]) => [
                key,
                items.filter((item) => shown(item.href)),
              ]),
            )
          : null,
        relatedLabels: reports?.relatedLabels ?? null,
        included,
        taskStatus,
        diagrams,
        whiteboards,
        images,
        numberHeadings: await this.#numberHeadings(pageId),
        meeting,
        unavailable,
        failed: false,
        board: null,
        facts: await this.#facts(pageId),
      };
    } catch (error) {
      this.#logger.warn({ err: error }, "A page could not be prepared for an export");
      return {
        id: pageId,
        title: readable.title,
        author,
        path,
        version: readable.version,
        updatedAt: readable.updatedAt,
        document,
        references: { people: {}, pages: {}, topics: {}, tooLargeImages: [] },
        numbers: new Map(),
        childPages: null,
        attachments: null,
        pageReports: null,
        decisionReports: null,
        taskReports: null,
        ...emptyModules,
        taskStatus: null,
        diagrams: null,
        whiteboards: null,
        images: new Set(),
        numberHeadings: false,
        meeting: null,
        unavailable,
        failed: true,
        board: null,
      };
    }
  }

  async exportable(ids: Iterable<string>): Promise<Set<string>> {
    const visible = [...(await this.#readerVisible(ids))];
    const decisions = await this.#authorization.explainMany(
      this.#viewer,
      "item.export",
      visible.map((id) => ({ type: "item", id })),
    );
    return new Set(visible.filter((_, index) => decisions[index]?.allowed));
  }

  async #whiteboards(document: DocumentJson): Promise<Map<string, ReferencedBoard>> {
    const found = await this.#documents.referencedWhiteboards(this.#viewer, document);
    const exportable = await this.exportable(found.keys());
    return new Map([...found].filter(([id]) => exportable.has(id)));
  }

  async #diagrams(document: DocumentJson): Promise<Map<string, ReferencedDiagram>> {
    const found = await this.#documents.referencedDiagrams(this.#viewer, document);
    const pageOf = (key: string) => key.slice(0, key.indexOf("/"));
    const exportable = await this.exportable([...found.keys()].map(pageOf));
    return new Map([...found].filter(([key]) => exportable.has(pageOf(key))));
  }

  async #previewImages(document: DocumentJson): Promise<Set<string>> {
    const ids = new Set<string>();
    for (const block of blocksOfType(document, "file")) {
      const id = block.attrs?.attachmentId;
      if (block.attrs?.preview !== true || typeof id !== "string" || ids.has(id)) continue;
      const allowed = await this.#authorization.authorize(this.#viewer, "attachment.view", {
        type: "attachment",
        id,
      });
      if (!allowed) continue;
      const content = await this.#attachments.content(id, "published");
      if (content?.contentType.startsWith("image/")) ids.add(id);
    }
    return ids;
  }

  async #numberHeadings(pageId: string): Promise<boolean> {
    const result = await this.#database.execute<{ number_headings: boolean }>(
      sql`select number_headings from tree_items where id = ${pageId}`,
    );
    return result.rows[0]?.number_headings === true;
  }

  async prepareBoard(itemId: string): Promise<PreparedPage | null> {
    const result = await this.#database.execute<{
      title: string;
      changed_at: Date | string;
      updated_by: string | null;
      file_id: string | null;
      size: string | number | null;
    }>(sql`
      select t.title, d.changed_at, d.updated_by, f.id as file_id, f.size
      from tree_items t join whiteboard_documents d on d.item_id = t.id
      left join whiteboard_previews p on p.id = d.preview_id
      left join stored_files f on f.id = p.file_id and f.state = 'ready'
      where t.id = ${itemId} and t.kind = 'whiteboard'`);
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: itemId,
      title: row.title,
      author: await this.#author(row.updated_by),
      path: await this.path(itemId),
      version: null,
      updatedAt: new Date(row.changed_at),
      document: { type: "doc", content: [] },
      references: { people: {}, pages: {}, topics: {}, tooLargeImages: [] },
      numbers: new Map(),
      childPages: null,
      attachments: null,
      pageReports: null,
      decisionReports: null,
      taskReports: null,
      ...emptyModules,
      taskStatus: null,
      diagrams: null,
      whiteboards: null,
      images: new Set(),
      numberHeadings: false,
      meeting: null,
      unavailable: new Set(),
      failed: false,
      board: { preview: row.file_id ? { fileId: row.file_id, size: Number(row.size ?? 0) } : null },
    };
  }

  #previewSource(page: PreparedPage, locator: Locator): string | null {
    if (!page.board?.preview) return null;
    return locator.preview(page.id) ?? `${this.#origin}${whiteboardPreviewPath(page.id)}`;
  }

  #boardBody(page: PreparedPage, format: ExportFormat, locator: Locator): string {
    const source = this.#previewSource(page, locator);
    if (format === "markdown") {
      return source
        ? `![${markdownText(this.title(page))}](${markdownUrl(source)})\n`
        : `> ${this.#texts.whiteboardWithoutImage}\n`;
    }
    return source
      ? `<figure class="ld-whiteboard"><img src="${escapeHtml(source)}" alt="${escapeHtml(this.title(page))}"></figure>`
      : `<p class="ld-export-note">${escapeHtml(this.#texts.whiteboardWithoutImage)}</p>`;
  }

  async #taskReports(document: DocumentJson): Promise<Map<string, readonly ReportedTask[]>> {
    const result = new Map<string, readonly ReportedTask[]>();
    for (const block of blocksOfType(document, "taskReport")) {
      const request = taskReportRequest({ attrs: block.attrs ?? {} });
      const key = taskKey(request);
      if (result.has(key)) continue;
      const list = await this.#tasks.list(this.#viewer, {
        assignee: request.assignedToViewer ? "me" : (request.assignee ?? undefined),
        spaceId: request.spaceId ?? undefined,
        seriesId: request.seriesId ?? undefined,
        pageIds: request.pageIds.length > 0 ? request.pageIds : undefined,
        labels: request.labels.length > 0 ? request.labels : undefined,
        status: request.status,
        due: request.due,
        limit: MAX_REPORTED_TASKS,
      });
      result.set(
        key,
        list.items.map((task) => ({
          text: task.text,
          done: task.done,
          assignee: task.assignee?.name ?? null,
          dueDate: task.dueDate,
          page: {
            title: task.item.title,
            href: itemAddress(task.item.kind, task.item.spaceKey, task.item.number, task.item.title) ?? "",
          },
        })),
      );
    }
    return result;
  }

  async #facts(pageId: string): Promise<PageFacts> {
    const result = await this.#database.execute<{
      created_at: Date | string | null;
      labels: string[] | null;
      article_type: string | null;
      language: string | null;
      translation: boolean;
    }>(sql`
      select t.created_at, t.article_type, t.translation_of is not null as translation,
        (select array_agg(l.label order by l.label) from page_labels l where l.item_id = t.id) as labels,
        case when s.type <> 'knowledgeBase' then null
          when t.translation_of is null then kb.default_language::text
          else t.content_language end as language
      from tree_items t join spaces s on s.id = t.space_id
      left join knowledge_bases kb on kb.space_id = s.id
      where t.id = ${pageId}`);
    const row = result.rows[0];
    return {
      createdAt: row?.created_at ? new Date(row.created_at) : null,
      labels: row?.labels ?? [],
      articleType: row?.article_type ?? null,
      language: row?.language ?? null,
      translation: row?.translation === true,
    };
  }

  #frontMatter(page: PreparedPage): string {
    const facts = page.facts;
    const lunedo: Record<string, unknown> = { kind: page.board ? "whiteboard" : "page" };
    if (page.version !== null) lunedo.version = page.version;
    if (page.author) lunedo.author = page.author;
    if (facts?.articleType) lunedo.articleType = facts.articleType;
    if (facts?.language) lunedo.language = facts.language;
    if (facts?.translation) lunedo.translation = true;
    const data: Record<string, unknown> = { title: this.title(page) };
    if (facts?.createdAt) data.created = facts.createdAt.toISOString();
    data.updated = page.updatedAt.toISOString();
    if (facts && facts.labels.length > 0) data.labels = [...facts.labels];
    data.lunedo = lunedo;
    return `---\n${dump(data, { lineWidth: -1, noRefs: true })}---\n`;
  }

  async #meeting(pageId: string): Promise<PreparedPage["meeting"]> {
    const meeting = await this.#database.execute<{ starts_at: Date | string | null }>(
      sql`select starts_at from meetings where item_id = ${pageId}`,
    );
    const row = meeting.rows[0];
    if (!row) return null;
    const attendees = await this.#database.execute<{ account_id: string }>(sql`
      select account_id from meeting_attendees where meeting_id = ${pageId} order by position, account_id`);
    const ids = attendees.rows.map((attendee) => attendee.account_id);
    const names = await this.#people.visibleNames(this.#viewer, ids);
    const guests = await this.#database.execute<{ name: string }>(sql`
      select name from meeting_guests where meeting_id = ${pageId} order by position, created_at, id`);
    return {
      startsAt: row.starts_at === null ? null : new Date(row.starts_at),
      attendees: [
        ...ids.map((id) => names.get(id)).filter((name): name is string => name !== undefined),
        ...guests.rows.map((guest) => guest.name),
      ],
    };
  }

  #labels(page: PreparedPage): Partial<RenderLabels> {
    const labels = this.#texts.labels;
    const unavailable = (key: keyof Omit<RenderLabels, "callout">) => this.#texts.unavailable(labels[key]);
    return {
      ...labels,
      ...(page.unavailable.has("childPages") ? { childPages: unavailable("childPages") } : {}),
      ...(page.unavailable.has("attachmentList") ? { attachmentList: unavailable("attachmentList") } : {}),
      ...(page.unavailable.has("pageReport") ? { pageReport: unavailable("pageReport") } : {}),
      ...(page.unavailable.has("decisionReport") ? { decisionReport: unavailable("decisionReport") } : {}),
      ...(page.unavailable.has("taskReport") ? { taskReport: unavailable("taskReport") } : {}),
      ...(page.unavailable.has("propertiesReport")
        ? {
            propertiesReport: unavailable("propertiesReport"),
            contentByLabel: unavailable("contentByLabel"),
            relatedLabels: unavailable("relatedLabels"),
          }
        : {}),
      ...(page.unavailable.has("include")
        ? { includedPage: unavailable("includedPage"), includedExcerpt: unavailable("includedExcerpt") }
        : {}),
    };
  }

  #address(format: ExportFormat, locator: Locator, numbers: ReadonlyMap<number, string>) {
    return (address: string): string => {
      const page = PAGE_ADDRESS.exec(address) ?? NUMBERED_ADDRESS.exec(address);
      const pageId = pageIdOf(address, numbers);
      if (pageId) {
        const local = locator.page(pageId, format);
        if (local) return `${local}${page?.[2] ?? ""}`;
      }
      const attachment = ATTACHMENT_ADDRESS.exec(address);
      const attachmentId = attachment?.[1]?.toLowerCase();
      if (attachmentId) {
        const local = locator.attachment(attachmentId, attachment?.[2] !== undefined);
        if (local) return local;
      }
      const boardId = WHITEBOARD_PREVIEW_ADDRESS.exec(address)?.[1]?.toLowerCase();
      if (boardId) {
        const local = locator.preview(boardId);
        if (local) return local;
      }
      return address.startsWith("/") ? `${this.#origin}${address}` : address;
    };
  }

  #context(
    page: PreparedPage,
    format: ExportFormat,
    locator: Locator,
    target: ContextTarget = "screen",
  ): RenderContext {
    const { references } = page;
    return {
      ...(target === "print" ? { target: "print" as const } : {}),
      ...(target === "word" ? { svgPalette } : {}),
      nodeTitle: (type) => this.#texts.nodeTitles[type] ?? this.#texts.someContent,
      labels: this.#labels(page),
      href: this.#address(format, locator, page.numbers),
      formatDate: (iso) => this.#format.day(iso),
      formatSize: formatBytes,
      mention: (id) => {
        const name = references.people[id];
        return name ? { name } : null;
      },
      topic: (id) => references.topics[id] ?? null,
      pageLink: (link) => referencedPageLink(references, link.pageId),
      attachment: (id) => ({
        href: `/api/v1/attachments/${id}/content`,
        display: `/api/v1/attachments/${id}/content?size=display`,
        image: page.images.has(id),
        ...(references.tooLargeImages.includes(id) ? { tooLarge: true } : {}),
      }),
      whiteboard: (id) => {
        const board = page.whiteboards?.get(id);
        if (!board) return null;
        return {
          title: board.title,
          href: board.href,
          previewHref: board.preview ? whiteboardPreviewPath(id) : null,
        };
      },
      numberHeadings: page.numberHeadings,
      diagramReference: (pageId, diagramId) => page.diagrams?.get(diagramKey(pageId, diagramId)) ?? null,
      attachmentList: () => page.attachments,
      childPages: (request: ChildPagesRequest) =>
        page.childPages ? (page.childPages.get(childPagesKey(request)) ?? []) : null,
      pageReport: (request: PageReportRequest) =>
        page.pageReports ? (page.pageReports.get(reportKey(request)) ?? []) : null,
      decisionReport: (request: DecisionReportRequest) =>
        page.decisionReports ? (page.decisionReports.get(reportKey(request)) ?? []) : null,
      taskReport: (request: TaskReportRequest) =>
        page.taskReports ? (page.taskReports.get(taskKey(request)) ?? []) : null,
      propertiesReport: (request: PropertiesReportRequest) =>
        page.propertiesReports
          ? (page.propertiesReports.get(reportKey(request)) ?? { columns: [], rows: [], total: 0 })
          : null,
      contentByLabel: (request: ContentByLabelRequest) =>
        page.contentByLabel ? (page.contentByLabel.get(reportKey(request)) ?? []) : null,
      relatedLabels: (request: RelatedLabelsRequest) =>
        page.relatedLabels ? (page.relatedLabels.get(relatedLabelsKey(request.labels)) ?? []) : null,
      include: (request: IncludeRequest): IncludedContent | null => {
        if (!page.included) return null;
        const entry = page.included.get(includeKey(request));
        if (!entry) return { state: "hidden" };
        if (entry.state !== "visible") return { state: entry.state };
        return {
          state: "visible",
          title: entry.title,
          href: entry.href,
          document: entry.document,
          context: this.#context(entry.page, format, locator, target),
        };
      },
      taskStatus: (id) => page.taskStatus?.get(id) ?? null,
    };
  }

  #meta(page: PreparedPage): string[] {
    const lines = [
      page.version !== null
        ? this.#texts.publishedVersion(page.version, this.#format.date(page.updatedAt))
        : this.#texts.lastChanged(this.#format.date(page.updatedAt)),
    ];
    if (page.meeting) {
      if (page.meeting.startsAt)
        lines.push(this.#texts.meeting(this.#format.dateTime(page.meeting.startsAt)));
      if (page.meeting.attendees.length > 0) {
        lines.push(this.#texts.attendees(page.meeting.attendees.join(", ")));
      }
    }
    return lines;
  }

  #body(page: PreparedPage, target: Target, locator: Locator): string {
    const format = target === "markdown" ? "markdown" : "html";
    if (page.board) return this.#boardBody(page, format, locator);
    if (!page.failed) {
      try {
        const context = this.#context(page, format, locator, target === "print" ? "print" : "screen");
        return format === "html"
          ? renderHtml(page.document, context)
          : renderMarkdown(page.document, context);
      } catch (error) {
        this.#logger.warn({ err: error }, "A page could not be rendered for an export");
      }
    }
    return format === "html"
      ? `<p class="ld-export-note">${escapeHtml(this.#texts.pageUnavailable)}</p>`
      : `> ${this.#texts.pageUnavailable}\n`;
  }

  printBody(page: PreparedPage, locator: Locator): string {
    return this.#body(page, "print", locator);
  }

  wordBody(page: PreparedPage, locator: Locator): WordBlock[] {
    if (page.board) {
      return page.board.preview
        ? [
            {
              type: "image",
              attachmentId: page.id,
              href: this.#previewSource(page, locator),
              alt: this.title(page),
              width: null,
              align: "center",
            },
          ]
        : [{ type: "placeholder", text: this.#texts.whiteboardWithoutImage }];
    }
    if (!page.failed) {
      try {
        return renderWord(page.document, this.#context(page, "html", locator, "word"));
      } catch (error) {
        this.#logger.warn({ err: error }, "A page could not be rendered for an export");
      }
    }
    return [{ type: "placeholder", text: this.#texts.pageUnavailable }];
  }

  headings(page: PreparedPage): Heading[] {
    return page.failed ? [] : extractHeadings(page.document);
  }

  meta(page: PreparedPage): string[] {
    const [first = "", ...rest] = this.#meta(page);
    return page.author ? [`${page.author} · ${first}`, ...rest] : [first, ...rest];
  }

  title(page: PreparedPage): string {
    return page.title.trim() || this.#texts.untitledPage;
  }

  markdown(page: PreparedPage, locator: Locator): string {
    const meeting = page.meeting ? this.#meta(page).slice(1) : [];
    const head = [
      this.#frontMatter(page),
      `# ${markdownText(this.title(page))}`,
      "",
      ...(meeting.length > 0 ? [...meeting.map((line) => `*${markdownText(line)}*`), ""] : []),
    ];
    return `${head.join("\n")}\n${this.#body(page, "markdown", locator)}`;
  }

  html(page: PreparedPage, locator: Locator, language: string): string {
    const index = locator.index("html");
    const title = escapeHtml(this.title(page));
    const meta = this.#meta(page)
      .map((line) => `<p class="ld-meta">${escapeHtml(line)}</p>`)
      .join("");
    const navigation = index
      ? `<nav><a href="${escapeHtml(index)}">${escapeHtml(this.#texts.contents)}</a></nav>`
      : "";
    const facts = page.facts;
    const head = [
      facts?.articleType
        ? `<meta name="lunedo:article-type" content="${escapeHtml(facts.articleType)}">`
        : "",
      facts?.translation ? '<meta name="lunedo:translation" content="true">' : "",
    ].join("");
    return htmlDocument(
      facts?.language ?? language,
      title,
      `${navigation}<header><h1>${title}</h1>${meta}</header><article>${this.#body(page, "html", locator)}</article>`,
      head,
    );
  }
}

export function taskKey(request: TaskReportRequest): string {
  return JSON.stringify(Object.entries(request).sort(([left], [right]) => left.localeCompare(right)));
}

export function markdownText(text: string): string {
  return text.replace(/[\\`*_[\]<>|~$&#]/g, "\\$&").replace(/\s*[\r\n]+\s*/g, " ");
}

export function htmlDocument(language: string, title: string, body: string, head = ""): string {
  return `<!doctype html>\n<html lang="${escapeHtml(language)}">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n${head ? `${head}\n` : ""}<title>${title}</title>\n<style>\n${exportStyle}\n</style>\n</head>\n<body>\n<main>${body}</main>\n</body>\n</html>\n`;
}
