import {
  type ContentByLabelRequest,
  contentByLabelRequest,
  type DecisionReportRequest,
  type DocumentJson,
  decisionReportRequest,
  type LabeledContent,
  type LabeledContentKind,
  MAX_PROPERTIES_REPORT_COLUMNS,
  MAX_PROPERTIES_REPORT_PAGE_SIZE,
  type NodeJson,
  type PageReportRequest,
  type PropertiesReport,
  type PropertiesReportRequest,
  pageReportRequest,
  propertiesReportRequest,
  propertyKeyOf,
  type RelatedLabel,
  type ReportedDecision,
  type ReportedPage,
} from "@lunedo/editor-schema";
import { type SQL, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database } from "../database/database.js";
import { itemAddress } from "./addresses.js";
import {
  blocksOfType,
  type PageDocumentService,
  type PageReferences,
  relatedLabelsKey,
  reportKey,
} from "./documents.js";
import type { PeopleService } from "./people.js";
import { spaceNameFor, visibleItem, visiblePages, visibleParents } from "./visibility.js";

export const MAX_DECISION_REPORT_PAGE = 100;

const pageReportDefaults = { spaceId: null, labels: [], sort: "modified", reverse: false, limit: 20 };
const decisionReportDefaults = { spaceId: null, labels: [], parentId: null, order: "newest" };
const propertiesReportDefaults = {
  spaceIds: [],
  labels: [],
  setId: null,
  columns: [],
  sortBy: null,
  reverse: false,
  pageSize: 30,
};
const contentByLabelDefaults = {
  labels: [],
  matchAll: false,
  spaceIds: [],
  kinds: ["page", "blogPost"],
  sort: "modified",
  reverse: false,
  limit: 5,
  excerpts: false,
};

const MAX_RELATED_LABELS = 30;
const MAX_REPORT_KEYS = 50;

export interface DocumentReports {
  pageReports: Map<string, readonly ReportedPage[]>;
  decisionReports: Map<string, readonly ReportedDecision[]>;
  propertiesReports: Map<string, PropertiesReport>;
  contentByLabel: Map<string, readonly LabeledContent[]>;
  relatedLabels: Map<string, readonly RelatedLabel[]>;
  references: PageReferences;
}

export interface PropertiesReportRow {
  page: { id: string; title: string; path: string; spaceId: string };
  creator: { id: string; name: string } | null;
  labels: string[];
  cells: (NodeJson[] | null)[];
}

export interface PropertiesReportPage {
  columns: string[];
  keys: string[];
  total: number;
  rows: PropertiesReportRow[];
}

export interface LabeledItem {
  id: string;
  title: string;
  kind: LabeledContentKind;
  path: string;
  space: { id: string; name: string };
  labels: string[];
  excerpt: string | null;
  parents: string[];
  contentUpdatedAt: Date;
}

export function labelPath(spaceKey: string, label: string): string {
  return `/spaces/${encodeURIComponent(spaceKey)}/labels/${encodeURIComponent(label)}`;
}

function spacesCondition(spaceIds: readonly string[]): SQL {
  return spaceIds.length > 0
    ? sql`and t.space_id = any(${sql.param([...spaceIds])}::uuid[]) and (t.archived_root_id is null or s.archived_at is not null)`
    : sql`and t.archived_root_id is null and s.archived_at is null`;
}

function allLabelsCondition(labels: readonly string[]): SQL {
  return sql`and (select count(distinct l.label) from page_labels l
    where l.item_id = t.id and l.label = any(${sql.param([...labels])}::text[])) = ${labels.length}`;
}

function setCondition(setId: string | null, alias: SQL): SQL {
  return setId === null ? sql`` : sql`and ${alias}.set_id = ${setId}`;
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
  readonly #documents: PageDocumentService;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    people: PeopleService;
    documents: PageDocumentService;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#people = options.people;
    this.#documents = options.documents;
  }

  async forDocument(
    viewer: Principal,
    document: DocumentJson,
    pageId: string | null = null,
  ): Promise<DocumentReports> {
    const reports: DocumentReports = {
      pageReports: new Map(),
      decisionReports: new Map(),
      propertiesReports: new Map(),
      contentByLabel: new Map(),
      relatedLabels: new Map(),
      references: { people: {}, pages: {}, topics: {}, tooLargeImages: [] },
    };
    const cells: NodeJson[] = [];
    for (const block of blocksOfType(document, "propertiesReport")) {
      const request = propertiesReportRequest({ attrs: { ...propertiesReportDefaults, ...block.attrs } });
      const key = reportKey(request);
      if (reports.propertiesReports.has(key)) continue;
      const report = await this.properties(viewer, request);
      for (const row of report.rows) for (const cell of row.cells) if (cell) cells.push(...cell);
      reports.propertiesReports.set(key, {
        columns: report.columns,
        total: report.total,
        rows: report.rows.map((row) => ({
          title: row.page.title,
          href: row.page.path,
          creator: row.creator?.name ?? null,
          labels: row.labels,
          cells: row.cells,
        })),
      });
    }
    if (cells.length > 0) {
      reports.references = await this.#documents.references(viewer, { type: "doc", content: cells });
    }
    for (const block of blocksOfType(document, "contentByLabel")) {
      const request = contentByLabelRequest({ attrs: { ...contentByLabelDefaults, ...block.attrs } });
      const key = reportKey(request);
      if (reports.contentByLabel.has(key)) continue;
      const items = await this.labeledContent(viewer, request);
      reports.contentByLabel.set(
        key,
        items.map((item) => ({
          title: item.title,
          href: item.path,
          kind: item.kind,
          space: item.space.name || null,
          labels: item.labels,
          excerpt: item.excerpt,
        })),
      );
    }
    if (pageId) {
      for (const block of blocksOfType(document, "relatedLabels")) {
        const labels = Array.isArray(block.attrs?.labels) ? (block.attrs.labels as string[]) : [];
        const key = relatedLabelsKey(labels);
        if (!reports.relatedLabels.has(key)) {
          reports.relatedLabels.set(key, await this.relatedLabels(viewer, pageId, labels));
        }
      }
    }
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

  async properties(
    viewer: Principal,
    request: PropertiesReportRequest,
    page: { offset?: number | undefined } = {},
  ): Promise<PropertiesReportPage> {
    const pageSize = Math.min(Math.max(request.pageSize, 1), MAX_PROPERTIES_REPORT_PAGE_SIZE);
    const offset = Math.max(page.offset ?? 0, 0);
    const matching = sql`
      select t.id, t.number, t.title, t.kind, t.space_id, s.key, t.creator_id from tree_items t
      join spaces s on s.id = t.space_id
      where t.kind in ('page', 'blogPost') and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}
        ${spacesCondition(request.spaceIds)} ${labelCondition(request.labels)}
        and exists (select 1 from page_properties p where p.item_id = t.id ${setCondition(request.setId, sql`p`)})`;
    const sortKey = request.sortBy === null ? null : propertyKeyOf(request.sortBy);
    const sortValue =
      sortKey === null
        ? sql`null::text`
        : sql`(select p.sort_key from page_properties p where p.item_id = m.id and p.key_normalized = ${sortKey}
            ${setCondition(request.setId, sql`p`)} order by p.block, p.position limit 1)`;
    const direction = request.reverse ? sql`desc` : sql`asc`;
    const result = await this.#database.execute<{
      id: string;
      number: string;
      title: string;
      kind: string;
      space_id: string;
      key: string;
      creator_id: string | null;
      creator: string | null;
      total: string | number;
    }>(sql`
      with matching as (${matching})
      select m.id, m.number, m.title, m.kind::text as kind, m.space_id, m.key, m.creator_id,
        ${this.#people.visibleName(viewer, sql`a`)} as creator, count(*) over () as total
      from matching m left join accounts a on a.id = m.creator_id
      order by ${sortValue} ${direction} nulls last, lower(m.title) ${direction}, m.id
      limit ${pageSize} offset ${offset}`);
    const keys = await this.#database.execute<{ key: string }>(sql`
      with matching as (${matching})
      select (array_agg(p.key order by p.block, p.position))[1] as key
      from page_properties p join matching m on m.id = p.item_id
      where true ${setCondition(request.setId, sql`p`)}
      group by p.key_normalized
      order by min(p.position), count(*) desc, p.key_normalized
      limit ${MAX_REPORT_KEYS}`);
    const available = keys.rows.map((row) => row.key);
    const columns = (request.columns.length > 0 ? [...request.columns] : available).slice(
      0,
      MAX_PROPERTIES_REPORT_COLUMNS,
    );
    const ids = result.rows.map((row) => row.id);
    const values =
      ids.length === 0
        ? []
        : (
            await this.#database.execute<{ item_id: string; key_normalized: string; value: NodeJson[] }>(sql`
              select p.item_id, p.key_normalized, p.value from page_properties p
              where p.item_id = any(${sql.param(ids)}::uuid[]) ${setCondition(request.setId, sql`p`)}
              order by p.block, p.position`)
          ).rows;
    const cellsOf = new Map<string, Map<string, NodeJson[]>>();
    for (const row of values) {
      const cells = cellsOf.get(row.item_id) ?? new Map<string, NodeJson[]>();
      if (!cells.has(row.key_normalized)) cells.set(row.key_normalized, row.value);
      cellsOf.set(row.item_id, cells);
    }
    const labels = await this.#labelsOf(ids);
    return {
      columns,
      keys: available,
      total: Number(result.rows[0]?.total ?? 0),
      rows: result.rows.map((row) => ({
        page: {
          id: row.id,
          title: row.title,
          path: itemAddress(row.kind, row.key, row.number, row.title) ?? "",
          spaceId: row.space_id,
        },
        creator: row.creator_id && row.creator ? { id: row.creator_id, name: row.creator } : null,
        labels: labels.get(row.id) ?? [],
        cells: columns.map((column) => cellsOf.get(row.id)?.get(propertyKeyOf(column)) ?? null),
      })),
    };
  }

  async #labelsOf(ids: readonly string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (ids.length === 0) return result;
    const rows = await this.#database.execute<{ item_id: string; label: string }>(sql`
      select item_id, label from page_labels where item_id = any(${sql.param([...ids])}::uuid[])
      order by label`);
    for (const row of rows.rows) result.set(row.item_id, [...(result.get(row.item_id) ?? []), row.label]);
    return result;
  }

  async labeledContent(viewer: Principal, request: ContentByLabelRequest): Promise<LabeledItem[]> {
    if (request.labels.length === 0 || request.kinds.length === 0) return [];
    const column =
      request.sort === "title"
        ? sql`lower(t.title)`
        : request.sort === "created"
          ? sql`t.created_at`
          : sql`t.content_updated_at`;
    const ascending = request.sort === "title" ? !request.reverse : request.reverse;
    const result = await this.#database.execute<{
      id: string;
      number: string;
      title: string;
      kind: LabeledContentKind;
      key: string;
      space_id: string;
      space_name: string;
      excerpt: string | null;
      parents: string[] | null;
      content_updated_at: Date | string;
    }>(sql`
      select t.id, t.number, t.title, t.kind::text as kind, s.key, s.id as space_id, t.content_updated_at,
        ${visibleParents(this.#authorization, viewer, sql`t`)} as parents,
        ${spaceNameFor(this.#authorization, viewer, sql`s`)} as space_name,
        ${request.excerpts ? sql`coalesce(e.text, nullif(b.excerpt, ''))` : sql`null::text`} as excerpt
      from tree_items t join spaces s on s.id = t.space_id
      left join page_excerpts e on e.item_id = t.id
      left join blog_posts b on b.item_id = t.id
      where t.kind::text = any(${sql.param([...request.kinds])}::text[])
        and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}
        ${spacesCondition(request.spaceIds)}
        ${request.matchAll ? allLabelsCondition(request.labels) : labelCondition(request.labels)}
      order by ${column} ${ascending ? sql`asc` : sql`desc`}, t.id
      limit ${Math.min(Math.max(request.limit, 1), 100)}`);
    const labels = await this.#labelsOf(result.rows.map((row) => row.id));
    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      kind: row.kind,
      path: itemAddress(row.kind, row.key, row.number, row.title) ?? "",
      space: { id: row.space_id, name: row.space_name },
      labels: labels.get(row.id) ?? [],
      excerpt: row.excerpt,
      parents: row.parents ?? [],
      contentUpdatedAt: new Date(row.content_updated_at),
    }));
  }

  async relatedLabels(viewer: Principal, pageId: string, labels: readonly string[]): Promise<RelatedLabel[]> {
    const page = await this.#database.execute<{ key: string; organization_id: string | null }>(sql`
      select s.key, s.organization_id from tree_items t join spaces s on s.id = t.space_id
      where t.id = ${pageId}`);
    const space = page.rows[0];
    if (!space) return [];
    const own =
      labels.length > 0
        ? [...labels]
        : (
            await this.#database.execute<{ label: string }>(
              sql`select label from page_labels where item_id = ${pageId}`,
            )
          ).rows.map((row) => row.label);
    if (own.length === 0) return [];
    const result = await this.#database.execute<{ label: string }>(sql`
      select other.label from page_labels own
      join page_labels other on other.item_id = own.item_id and not (other.label = any(${sql.param(own)}::text[]))
      join tree_items t on t.id = own.item_id join spaces s on s.id = t.space_id
      where own.label = any(${sql.param(own)}::text[])
        and s.organization_id is not distinct from ${space.organization_id}
        and t.archived_root_id is null and s.archived_at is null
        and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}
      group by other.label
      order by count(distinct other.item_id) desc, other.label
      limit ${MAX_RELATED_LABELS}`);
    return result.rows.map((row) => ({ label: row.label, href: labelPath(space.key, row.label) }));
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
      number: string;
      title: string;
      space_id: string;
      key: string;
      creator_id: string | null;
      author: string | null;
      created_at: Date | string;
      content_updated_at: Date | string;
    }>(sql`
      select t.id, t.number, t.title, t.space_id, s.key, t.creator_id, ${this.#people.visibleName(viewer, sql`a`)} as author,
        t.created_at, t.content_updated_at
      from tree_items t join spaces s on s.id = t.space_id left join accounts a on a.id = t.creator_id
      where t.kind = 'page' and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}
        ${archiveCondition(request.spaceId)} ${labelCondition(request.labels)}
      order by ${column} ${ascending ? sql`asc` : sql`desc`}, t.id
      limit ${Math.min(Math.max(request.limit, 1), 100)}`);
    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      path: itemAddress("page", row.key, row.number, row.title) ?? "",
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
      number: string;
      kind: string;
      title: string;
      key: string;
      created_at: Date | string;
      cursor: string;
    }>(sql`
      select d.id, d.text, t.id as item_id, t.number, t.kind::text as kind, t.title, s.key, t.created_at, t.created_at::text as cursor
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
        page: {
          id: row.item_id,
          title: row.title,
          path: itemAddress(row.kind, row.key, row.number, row.title) ?? "",
        },
        date: toDate(row.created_at),
      })),
      next: result.rows.length > limit && last ? [last.cursor, last.id] : null,
    };
  }
}
