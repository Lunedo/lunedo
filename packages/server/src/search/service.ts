import { cleanLabel } from "@pagehall/editor-schema";
import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database } from "../database/database.js";
import type { PeopleService } from "../spaces/people.js";
import { type PageStatus, pageStatusEnabledCondition } from "../spaces/status.js";
import { visibleItem } from "../spaces/visibility.js";
import { loadViewer } from "./access.js";
import {
  type AdapterFacets,
  type AdapterHit,
  EXCERPT_END,
  EXCERPT_START,
  type FacetCount,
  type SearchAdapter,
  type SearchContentType,
  type SearchFilters,
  type SearchSort,
} from "./adapter.js";
import type { SearchIndexer } from "./indexer.js";
import { parseQuery } from "./query.js";

export const SEARCH_PAGE_LIMIT = 50;
export const DEFAULT_SEARCH_LIMIT = 20;
export const QUICK_SEARCH_LIMIT = 8;
const MAX_FILTER_VALUES = 20;
const MAX_AUTHOR_MATCHES = 50;

export type SearchMode = "full" | "quick";

export interface SearchCursor {
  score: number;
  updatedAt: string;
  sourceId: string;
}

export interface SearchRequest {
  query: string;
  mode: SearchMode;
  spaceIds: string[];
  contentTypes: SearchContentType[];
  labels: string[];
  authorIds: string[];
  statusIds: string[];
  includeArchived: boolean;
  updatedAfter: Date | null;
  updatedBefore: Date | null;
  sort: SearchSort;
  limit: number;
  cursor: SearchCursor | null;
  currentSpaceId: string | null;
}

export interface ExcerptPart {
  text: string;
  highlighted: boolean;
}

export interface SearchSpace {
  id: string;
  key: string;
  name: string;
  personal: boolean;
}

export interface SearchHit {
  type: SearchContentType;
  id: string;
  itemId: string;
  title: string;
  heading: string;
  anchor: string | null;
  excerpt: ExcerptPart[];
  space: SearchSpace | null;
  sharedWithYou: boolean;
  path: { id: string; title: string }[];
  labels: string[];
  status: PageStatus | null;
  author: { id: string; name: string } | null;
  archived: boolean;
  updatedAt: string;
  cursor: SearchCursor;
}

export interface SearchFacets {
  contentTypes: FacetCount<SearchContentType>[];
  spaces: (FacetCount<string | null> & { key: string | null; name: string | null; personal: boolean })[];
  labels: FacetCount<string>[];
  authors: (FacetCount<string> & { name: string })[];
  statuses: (FacetCount<string> & Omit<PageStatus, "id">)[];
}

export interface SearchResponse {
  results: SearchHit[];
  total: number;
  nextCursor: SearchCursor | null;
  facets: SearchFacets | null;
  index: { building: boolean };
}

const TYPE_ALIASES: Record<string, SearchContentType> = {
  page: "page",
  pages: "page",
  blog: "blogPost",
  blogpost: "blogPost",
  "blog-post": "blogPost",
  post: "blogPost",
  comment: "comment",
  comments: "comment",
};

export function excerptParts(raw: string): ExcerptPart[] {
  const parts: ExcerptPart[] = [];
  let rest = raw;
  while (rest.length > 0) {
    const start = rest.indexOf(EXCERPT_START);
    if (start === -1) {
      parts.push({ text: rest, highlighted: false });
      break;
    }
    if (start > 0) parts.push({ text: rest.slice(0, start), highlighted: false });
    const end = rest.indexOf(EXCERPT_END, start + 1);
    const stop = end === -1 ? rest.length : end;
    parts.push({ text: rest.slice(start + 1, stop), highlighted: true });
    rest = end === -1 ? "" : rest.slice(end + 1);
  }
  return parts
    .map((part) => ({ ...part, text: part.text.replaceAll(EXCERPT_START, "").replaceAll(EXCERPT_END, "") }))
    .filter((part) => part.text.length > 0);
}

export class SearchService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #people: PeopleService;
  readonly #adapter: SearchAdapter;
  readonly #indexer: SearchIndexer;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    people: PeopleService;
    adapter: SearchAdapter;
    indexer: SearchIndexer;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#people = options.people;
    this.#adapter = options.adapter;
    this.#indexer = options.indexer;
  }

  get indexer(): SearchIndexer {
    return this.#indexer;
  }

  async search(
    principal: Principal,
    organizationId: string,
    request: SearchRequest,
  ): Promise<SearchResponse> {
    const index = { building: (await this.#indexer.state()).building };
    const quick = request.mode === "quick";
    const empty: SearchResponse = {
      results: [],
      total: 0,
      nextCursor: null,
      facets: quick ? null : emptyFacets(),
      index,
    };
    const viewer = await loadViewer(this.#database, principal, organizationId);
    if (!viewer) return empty;
    const query = parseQuery(request.query);
    const spaces = await this.#visibleSpaces(principal, organizationId);
    const filters = await this.#filters(principal, organizationId, request, query.operators, spaces);
    if (!filters) return empty;
    const limit = Math.min(Math.max(request.limit, 1), SEARCH_PAGE_LIMIT);
    const result = await this.#adapter.search(this.#database, {
      viewer,
      query,
      prefixLastTerm: quick && !/\s$/.test(request.query),
      filters,
      visibleSpaceIds: [...spaces.keys()],
      sort: request.sort,
      limit,
      after: quick ? null : request.cursor,
      firstSpaceId:
        quick && request.currentSpaceId && spaces.has(request.currentSpaceId) ? request.currentSpaceId : null,
      facets: !quick,
    });
    const hits = await this.#describe(principal, result.hits, spaces);
    const last = hits[hits.length - 1];
    return {
      results: hits,
      total: result.total,
      nextCursor: result.hasMore && last && !quick ? last.cursor : null,
      facets: result.facets ? await this.#facets(principal, result.facets, spaces) : null,
      index,
    };
  }

  async #visibleSpaces(principal: Principal, organizationId: string): Promise<Map<string, SearchSpace>> {
    const result = await this.#database.execute<SearchSpace & Record<string, unknown>>(sql`
      select s.id, s.key, s.name, s.personal_of is not null as personal from spaces s
      where (s.organization_id = ${organizationId} or s.personal_of is not null)
        and ${this.#authorization.spaceFilter(principal, sql`s`)}`);
    return new Map(result.rows.map((row) => [row.id, row]));
  }

  async #filters(
    principal: Principal,
    organizationId: string,
    request: SearchRequest,
    operators: ReturnType<typeof parseQuery>["operators"],
    spaces: Map<string, SearchSpace>,
  ): Promise<SearchFilters | null> {
    const byKey = new Map([...spaces.values()].map((space) => [space.key.toLowerCase(), space.id]));
    const spaceRequested = request.spaceIds.length > 0 || operators.space.length > 0;
    const spaceIds = [
      ...new Set([
        ...request.spaceIds.filter((id) => spaces.has(id)),
        ...operators.space.flatMap((key) => {
          const id = byKey.get(key.toLowerCase());
          return id ? [id] : [];
        }),
      ]),
    ];

    const operatorTypes = operators.type.flatMap((value) => {
      const type = TYPE_ALIASES[value.toLowerCase()];
      return type ? [type] : [];
    });
    if (operators.type.length > 0 && operatorTypes.length === 0) return null;
    const types = [...new Set([...request.contentTypes, ...operatorTypes])];

    const labels = [
      ...new Set(
        [...request.labels, ...operators.label]
          .map((label) => cleanLabel(label))
          .filter((label): label is string => label !== null),
      ),
    ].slice(0, MAX_FILTER_VALUES);
    if (labels.length === 0 && request.labels.length + operators.label.length > 0) return null;

    let authorIds: string[] | null = null;
    if (request.authorIds.length > 0 || operators.author.length > 0) {
      authorIds = [
        ...new Set([...request.authorIds, ...(await this.#authorsNamed(principal, operators.author))]),
      ];
    }

    const statusRequested = request.statusIds.length > 0 || operators.status.length > 0;
    const statusIds = [
      ...new Set([
        ...request.statusIds,
        ...(await this.#statusesNamed(organizationId, spaces, operators.status)),
      ]),
    ];
    if (statusRequested && statusIds.length === 0) return null;

    return {
      spaceIds: spaceRequested ? spaceIds : null,
      contentTypes: types,
      labels,
      authorIds,
      statusIds,
      includeArchived: request.includeArchived,
      updatedAfter: request.updatedAfter,
      updatedBefore: request.updatedBefore,
    };
  }

  async #statusesNamed(
    organizationId: string,
    spaces: Map<string, SearchSpace>,
    names: readonly string[],
  ): Promise<string[]> {
    if (names.length === 0) return [];
    const exact = names.map((name) => name.trim().toLowerCase());
    const builtIn = names.map((name) => name.toLowerCase().replace(/[^a-z]/g, ""));
    const result = await this.#database.execute<{ id: string }>(sql`
      select sv.id from page_status_values sv join spaces s on s.id = sv.space_id
      where (s.organization_id = ${organizationId} or s.id = any(${sql.param([...spaces.keys()])}::uuid[]))
        and ${pageStatusEnabledCondition(sql`s`)}
        and (lower(sv.name) = any(${sql.param(exact)}::text[])
          or (sv.name is null and lower(sv.built_in) = any(${sql.param(builtIn)}::text[])))`);
    return result.rows.map((row) => row.id);
  }

  async #statuses(ids: readonly string[]): Promise<Map<string, PageStatus>> {
    if (ids.length === 0) return new Map();
    const result = await this.#database.execute<PageStatus & Record<string, unknown>>(sql`
      select sv.id, sv.built_in as "builtIn", sv.name, sv.color
      from page_status_values sv join spaces s on s.id = sv.space_id
      where sv.id = any(${sql.param([...new Set(ids)])}::uuid[]) and ${pageStatusEnabledCondition(sql`s`)}`);
    return new Map(result.rows.map((row) => [row.id, row]));
  }

  async #authorsNamed(principal: Principal, names: readonly string[]): Promise<string[]> {
    if (names.length === 0) return [];
    const patterns = names.map(
      (name) => `${name.trim().replace(/[\\%_]/g, (character) => `\\${character}`)}%`,
    );
    const result = await this.#database.execute<{ id: string }>(sql`
      select a.id from accounts a
      where (a.name ilike any(${sql.param(patterns)}::text[])
          or exists (select 1 from unnest(${sql.param(patterns)}::text[]) as p(pattern)
            where split_part(a.name, ' ', 2) ilike p.pattern))
        and ${this.#people.visibleCondition(principal, sql`a.id`)}
      order by a.id limit ${MAX_AUTHOR_MATCHES}`);
    return result.rows.map((row) => row.id);
  }

  async #describe(
    principal: Principal,
    hits: AdapterHit[],
    spaces: Map<string, SearchSpace>,
  ): Promise<SearchHit[]> {
    if (hits.length === 0) return [];
    const inSpaces = hits.filter((hit) => spaces.has(hit.spaceId)).map((hit) => hit.itemId);
    const paths = new Map<string, { id: string; title: string }[]>();
    if (inSpaces.length > 0) {
      const result = await this.#database.execute<{ id: string; path: { id: string; title: string }[] }>(sql`
        select t.id, coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title) order by p.n)
          from unnest(t.path) with ordinality as p(id, n)
          join tree_items a on a.id = p.id join spaces sa on sa.id = a.space_id
          where a.id <> t.id and ${visibleItem(this.#authorization, principal, sql`a`, sql`sa`)}), '[]'::jsonb) as path
        from tree_items t where t.id = any(${sql.param([...new Set(inSpaces)])}::uuid[])`);
      for (const row of result.rows) paths.set(row.id, row.path);
    }
    const authors = await this.#people.visibleNames(
      principal,
      hits.flatMap((hit) => (hit.authorId ? [hit.authorId] : [])),
    );
    const statuses = await this.#statuses(hits.flatMap((hit) => (hit.status ? [hit.status] : [])));
    return hits.map((hit) => {
      const space = spaces.get(hit.spaceId) ?? null;
      const authorName = hit.authorId ? authors.get(hit.authorId) : undefined;
      return {
        type: hit.contentType,
        id: hit.sourceId,
        itemId: hit.itemId,
        title: hit.title,
        heading: hit.heading,
        anchor: hit.anchor,
        excerpt: excerptParts(hit.excerpt),
        space,
        sharedWithYou: space === null,
        path: space ? (paths.get(hit.itemId) ?? []) : [],
        labels: hit.labels,
        status: (hit.status && statuses.get(hit.status)) || null,
        author: hit.authorId && authorName ? { id: hit.authorId, name: authorName } : null,
        archived: hit.archived,
        updatedAt: new Date(hit.contentUpdatedAt).toISOString(),
        cursor: { score: hit.score, updatedAt: hit.contentUpdatedAt, sourceId: hit.sourceId },
      };
    });
  }

  async #facets(
    principal: Principal,
    facets: AdapterFacets,
    spaces: Map<string, SearchSpace>,
  ): Promise<SearchFacets> {
    const names = await this.#people.visibleNames(
      principal,
      facets.authors.map((author) => author.value),
    );
    const statuses = await this.#statuses(facets.statuses.map((facet) => facet.value));
    return {
      contentTypes: facets.contentTypes,
      spaces: facets.spaces.map((facet) => {
        const space = facet.value ? spaces.get(facet.value) : undefined;
        return {
          value: space ? facet.value : null,
          count: facet.count,
          key: space?.key ?? null,
          name: space?.name ?? null,
          personal: space?.personal ?? false,
        };
      }),
      labels: facets.labels,
      authors: facets.authors.flatMap((author) => {
        const name = names.get(author.value);
        return name ? [{ ...author, name }] : [];
      }),
      statuses: facets.statuses.flatMap((facet) => {
        const status = statuses.get(facet.value);
        return status ? [{ ...facet, builtIn: status.builtIn, name: status.name, color: status.color }] : [];
      }),
    };
  }
}

function emptyFacets(): SearchFacets {
  return { contentTypes: [], spaces: [], labels: [], authors: [], statuses: [] };
}
