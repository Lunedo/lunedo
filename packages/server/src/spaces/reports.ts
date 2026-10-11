import {
  type DecisionReportRequest,
  type DocumentJson,
  decisionReportRequest,
  type PageReportRequest,
  pageReportRequest,
  type ReportedDecision,
  type ReportedPage,
} from "@pagehall/editor-schema";
import { type SQL, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database } from "../database/database.js";
import { blocksOfType, pagePath, reportKey } from "./documents.js";
import type { PeopleService } from "./people.js";
import { visibleItem, visiblePages } from "./visibility.js";

export const MAX_DECISION_REPORT_PAGE = 100;

const pageReportDefaults = { spaceId: null, labels: [], sort: "modified", reverse: false, limit: 20 };
const decisionReportDefaults = { spaceId: null, labels: [], parentId: null, order: "newest" };

export interface DocumentReports {
  pageReports: Map<string, readonly ReportedPage[]>;
  decisionReports: Map<string, readonly ReportedDecision[]>;
}

export interface ReportPage {
  id: string;
  title: string;
  path: string;
  spaceId: string;
  author: { id: string; name: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReportDecision {
  id: string;
  text: string;
  page: { id: string; title: string; path: string };
  date: Date;
}

export interface DecisionReportPage {
  items: ReportDecision[];
  next: [string, string] | null;
}

function toDate(value: Date | string): Date {
  return new Date(value);
}

function labelCondition(labels: readonly string[]): SQL {
  return labels.length > 0
    ? sql`and exists (select 1 from page_labels l where l.item_id = t.id and l.label = any(${sql.param([...labels])}::text[]))`
    : sql``;
}

function archiveCondition(spaceId: string | null): SQL {
  return spaceId
    ? sql`and t.space_id = ${spaceId} and (t.archived_root_id is null or s.archived_at is not null)`
    : sql`and t.archived_root_id is null and s.archived_at is null`;
}

export class ReportService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #people: PeopleService;

  constructor(options: { database: Database; authorization: AuthorizationService; people: PeopleService }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#people = options.people;
  }

  async forDocument(viewer: Principal, document: DocumentJson): Promise<DocumentReports> {
    const reports: DocumentReports = { pageReports: new Map(), decisionReports: new Map() };
    for (const block of blocksOfType(document, "pageReport")) {
      const request = pageReportRequest({ attrs: { ...pageReportDefaults, ...block.attrs } });
      const key = reportKey(request);
      if (reports.pageReports.has(key)) continue;
      const pages = await this.pages(viewer, request);
      reports.pageReports.set(
        key,
        pages.map((page) => ({
          title: page.title,
          href: page.path,
          author: page.author?.name ?? null,
          updatedAt: page.updatedAt.toISOString(),
        })),
      );
    }
    for (const block of blocksOfType(document, "decisionReport")) {
      const request = decisionReportRequest({ attrs: { ...decisionReportDefaults, ...block.attrs } });
      const key = reportKey(request);
      if (reports.decisionReports.has(key)) continue;
      const decisions = await this.decisions(viewer, request, { limit: MAX_DECISION_REPORT_PAGE });
      reports.decisionReports.set(
        key,
        decisions.items.map((decision) => ({
          text: decision.text,
          page: { title: decision.page.title, href: decision.page.path },
          date: decision.date.toISOString(),
        })),
      );
    }
    return reports;
  }

  async pages(viewer: Principal, request: PageReportRequest): Promise<ReportPage[]> {
    const column =
      request.sort === "title"
        ? sql`lower(t.title)`
        : request.sort === "created"
          ? sql`t.created_at`
          : sql`t.content_updated_at`;
    const ascending = request.sort === "title" ? !request.reverse : request.reverse;
    const result = await this.#database.execute<{
      id: string;
      title: string;
      space_id: string;
      key: string;
      creator_id: string | null;
      author: string | null;
      created_at: Date | string;
      content_updated_at: Date | string;
    }>(sql`
      select t.id, t.title, t.space_id, s.key, t.creator_id, ${this.#people.visibleName(viewer, sql`a`)} as author,
        t.created_at, t.content_updated_at
      from tree_items t join spaces s on s.id = t.space_id left join accounts a on a.id = t.creator_id
      where t.kind = 'page' and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}
        ${archiveCondition(request.spaceId)} ${labelCondition(request.labels)}
      order by ${column} ${ascending ? sql`asc` : sql`desc`}, t.id
      limit ${Math.min(Math.max(request.limit, 1), 100)}`);
    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      path: pagePath(row.key, row.id, row.title),
      spaceId: row.space_id,
      author: row.creator_id && row.author ? { id: row.creator_id, name: row.author } : null,
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.content_updated_at),
    }));
  }

  async decisions(
    viewer: Principal,
    request: DecisionReportRequest,
    page: { after?: [string, string] | undefined; limit?: number | undefined } = {},
  ): Promise<DecisionReportPage> {
    const limit = Math.min(Math.max(page.limit ?? 50, 1), MAX_DECISION_REPORT_PAGE);
    const newest = request.order === "newest";
    const after = page.after
      ? newest
        ? sql`and (t.created_at, d.id) < (${page.after[0]}::timestamptz, ${page.after[1]}::uuid)`
        : sql`and (t.created_at, d.id) > (${page.after[0]}::timestamptz, ${page.after[1]}::uuid)`
      : sql``;
    const result = await this.#database.execute<{
      id: string;
      text: string;
      item_id: string;
      title: string;
      key: string;
      created_at: Date | string;
      cursor: string;
    }>(sql`
      select d.id, d.text, t.id as item_id, t.title, s.key, t.created_at, t.created_at::text as cursor
      from decisions d join tree_items t on t.id = d.item_id join spaces s on s.id = t.space_id
      where d.published and d.text <> '' and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}
        ${archiveCondition(request.spaceId)} ${labelCondition(request.labels)}
        ${request.parentId ? sql`and t.parent_id = any(${visiblePages(this.#authorization, viewer, [request.parentId])})` : sql``}
        ${after}
      order by t.created_at ${newest ? sql`desc` : sql`asc`}, d.id ${newest ? sql`desc` : sql`asc`}
      limit ${limit + 1}`);
    const rows = result.rows.slice(0, limit);
    const last = rows.at(-1);
    return {
      items: rows.map((row) => ({
        id: row.id,
        text: row.text,
        page: { id: row.item_id, title: row.title, path: pagePath(row.key, row.item_id, row.title) },
        date: toDate(row.created_at),
      })),
      next: result.rows.length > limit && last ? [last.cursor, last.id] : null,
    };
  }
}
