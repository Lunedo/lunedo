import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database } from "../database/database.js";
import { lastReviewedAt } from "../knowledge-bases/reviews.js";
import { CATEGORY_LEVELS } from "../knowledge-bases/service.js";
import type { ArticleSort, ListedArticle } from "../search/adapter.js";
import type { SearchCursor, SearchService } from "../search/service.js";
import type { ArticleType } from "../spaces/schema.js";
import type { ArticleRenderer } from "./articles.js";
import type { PortalConfig } from "./portals.js";
import type { RenderedHeading } from "./schema.js";
import { FREQUENT_SEARCH_DAYS, type PortalStatistics } from "./statistics.js";

export const PORTAL_PAGE_SIZE = 20;
export const RELATED_LIMIT = 3;
export const START_LIST_LIMIT = 5;
const FREQUENT_CANDIDATES = 8;
const FREQUENT_SHOWN = 4;
export const portalArticleFilters = ["howTo", "troubleshooting"] as const;
export type PortalArticleFilter = (typeof portalArticleFilters)[number];

export interface PortalCategory {
  id: string;
  parentId: string | null;
  level: number;
  title: string;
  description: string;
  icon: string | null;
  contactEmail: string | null;
  articles: number;
}

export interface PortalArticleSummary {
  itemId: string;
  number: number;
  slug: string;
  title: string;
  type: ArticleType | null;
  categoryId: string | null;
  subcategoryId: string | null;
  updatedAt: Date;
  reviewedAt: Date | null;
  views: number;
}

export interface PortalArticle extends PortalArticleSummary {
  spaceKey: string;
  lead: string;
  html: string;
  headings: RenderedHeading[];
  contactEmail: string | null;
  canEdit: boolean;
}

export type ArticleLookup =
  | { type: "found"; article: PortalArticle }
  | { type: "redirect"; spaceId: string; number: number; slug: string }
  | null;

export interface ArticlePage {
  articles: PortalArticleSummary[];
  total: number;
  typeCounts: Record<"all" | ArticleType, number>;
}

export interface PortalSearchResult {
  results: (PortalArticleSummary & { excerpt: { text: string; highlighted: boolean }[] })[];
  total: number;
  nextCursor: SearchCursor | null;
  categories: { id: string; count: number }[];
  typeCounts: Record<"all" | ArticleType, number>;
  suggestion: string | null;
}

function typeOf(value: string): ArticleType | null {
  return value === "howTo" || value === "troubleshooting" ? value : null;
}

function counts(entries: { value: string; count: number }[]): Record<"all" | ArticleType, number> {
  const result = { all: 0, howTo: 0, troubleshooting: 0 };
  for (const entry of entries) {
    result.all += entry.count;
    const type = typeOf(entry.value);
    if (type) result[type] += entry.count;
  }
  return result;
}

function since(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export class PortalReader {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #search: SearchService;
  readonly #renderer: ArticleRenderer;
  readonly #statistics: PortalStatistics;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    search: SearchService;
    renderer: ArticleRenderer;
    statistics: PortalStatistics;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#search = options.search;
    this.#renderer = options.renderer;
    this.#statistics = options.statistics;
  }

  async categories(principal: Principal, config: PortalConfig): Promise<PortalCategory[]> {
    const counted = await this.#search.portalArticleCounts(principal, config.organizationId, config.spaceId);
    if (counted.size === 0) return [];
    const result = await this.#database.execute<{
      id: string;
      parent_id: string | null;
      level: number;
      title: string;
      description: string;
      icon: string | null;
      contact_email: string | null;
    }>(sql`
      select c.id, c.parent_id, cardinality(c.path) as level, c.title, c.description, kc.icon, kc.contact_email
      from tree_items c join spaces s on s.id = c.space_id
      left join knowledge_base_categories kc on kc.item_id = c.id
      where c.space_id = ${config.spaceId} and c.kind = 'folder' and cardinality(c.path) <= ${CATEGORY_LEVELS}
        and c.id = any(${sql.param([...counted.keys()])}::uuid[])
        and ${this.#authorization.portalFilter(principal, sql`c`, sql`s`)}
      order by cardinality(c.path), c.position, c.id`);
    const byId = new Map(result.rows.map((row) => [row.id, row]));
    return result.rows
      .filter((row) => row.parent_id === null || byId.has(row.parent_id))
      .map((row) => {
        const parent = row.parent_id ? byId.get(row.parent_id) : undefined;
        return {
          id: row.id,
          parentId: row.parent_id,
          level: Number(row.level),
          title: row.title,
          description: row.description,
          icon: row.icon,
          contactEmail: row.contact_email ?? parent?.contact_email ?? config.contactEmail,
          articles: counted.get(row.id) ?? 0,
        };
      });
  }

  async articles(
    principal: Principal,
    config: PortalConfig,
    options: {
      categoryId?: string | null;
      type?: PortalArticleFilter | null;
      sort?: ArticleSort;
      limit?: number;
      offset?: number;
      itemIds?: string[] | null;
      exclude?: string[];
    } = {},
  ): Promise<ArticlePage> {
    const list = await this.#search.portalArticles(principal, config.organizationId, {
      spaceId: config.spaceId,
      categoryId: options.categoryId ?? null,
      articleTypes: options.type ? [options.type] : [],
      itemIds: options.itemIds ?? null,
      excludeItemIds: options.exclude ?? [],
      sort: options.sort ?? "views",
      viewsSince: since(FREQUENT_SEARCH_DAYS),
      limit: Math.min(Math.max(options.limit ?? PORTAL_PAGE_SIZE, 1), 50),
      offset: Math.max(options.offset ?? 0, 0),
    });
    return {
      articles: await this.#summaries(config, list.articles),
      total: list.total,
      typeCounts: counts(list.articleTypes),
    };
  }

  async #addresses(
    spaceId: string,
    itemIds: string[],
  ): Promise<Map<string, { number: number; slug: string; reviewedAt: Date | null }>> {
    if (itemIds.length === 0) return new Map();
    const result = await this.#database.execute<{
      item_id: string;
      number: number;
      slug: string;
      reviewed_at: Date | string | null;
    }>(sql`
      select n.item_id, n.number, coalesce(article_slug(v.title), '') as slug, ${lastReviewedAt(sql`t`)} as reviewed_at
      from article_numbers n join tree_items t on t.id = n.item_id
      left join page_versions v on v.id = t.published_version_id
      where n.space_id = ${spaceId} and n.item_id = any(${sql.param(itemIds)}::uuid[])`);
    return new Map(
      result.rows.map((row) => [
        row.item_id,
        {
          number: Number(row.number),
          slug: row.slug,
          reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null,
        },
      ]),
    );
  }

  async #summaries(config: PortalConfig, listed: ListedArticle[]): Promise<PortalArticleSummary[]> {
    const addresses = await this.#addresses(
      config.spaceId,
      listed.map((article) => article.itemId),
    );
    return listed.flatMap((article) => {
      const address = addresses.get(article.itemId);
      if (!address) return [];
      const ancestors = article.path.filter((id) => id !== article.itemId);
      return [
        {
          itemId: article.itemId,
          number: address.number,
          slug: address.slug,
          title: article.title,
          type: typeOf(article.articleType),
          categoryId: ancestors[0] ?? null,
          subcategoryId: ancestors[1] ?? null,
          updatedAt: new Date(article.updatedAt),
          reviewedAt: address.reviewedAt,
          views: article.views,
        },
      ];
    });
  }

  async article(
    principal: Principal,
    config: PortalConfig,
    number: number,
    slug: string,
  ): Promise<ArticleLookup> {
    if (!Number.isSafeInteger(number) || number < 1) return null;
    const found = await this.#database.execute<{
      id: string;
      space_id: string;
      space_key: string;
      title: string;
      description: string;
      article_type: ArticleType | null;
      path: string[];
      version_id: string;
      updated_at: Date;
      reviewed_at: Date | string | null;
      slug: string;
      own_number: number | null;
      known_slug: boolean;
    }>(sql`
      select t.id, t.space_id, s.key as space_key, v.title, t.description, t.article_type, t.path,
        v.id as version_id, v.created_at as updated_at, ${lastReviewedAt(sql`t`)} as reviewed_at, coalesce(article_slug(v.title), '') as slug,
        (select n2.number from article_numbers n2 where n2.item_id = t.id and n2.space_id = t.space_id) as own_number,
        (${slug} = '' or ${slug} = coalesce(article_slug(v.title), '')
          or exists (select 1 from article_slugs sl where sl.item_id = t.id and sl.slug = ${slug})) as known_slug
      from article_numbers n
      join tree_items t on t.id = n.item_id
      join spaces s on s.id = t.space_id
      join page_versions v on v.id = t.published_version_id
      where n.space_id = ${config.spaceId} and n.number = ${number}
        and t.kind = 'page' and t.reader_visible
        and ${this.#authorization.portalFilter(principal, sql`t`, sql`s`)}`);
    const row = found.rows[0];
    if (!row?.known_slug) return null;
    if (row.space_id !== config.spaceId) {
      return row.own_number === null
        ? null
        : { type: "redirect", spaceId: row.space_id, number: Number(row.own_number), slug: row.slug };
    }
    const rendered = await this.#renderer.rendered(row.version_id, config.language);
    if (!rendered) return null;
    const ancestors = row.path.filter((id) => id !== row.id);
    const contact = await this.#contact(config, ancestors);
    const canEdit =
      principal.type === "account" &&
      (await this.#authorization.decide(principal, "item.edit", { type: "item", id: row.id })).allowed;
    return {
      type: "found",
      article: {
        itemId: row.id,
        number,
        slug: row.slug,
        title: row.title,
        type: row.article_type,
        categoryId: ancestors[0] ?? null,
        subcategoryId: ancestors[1] ?? null,
        updatedAt: new Date(row.updated_at),
        reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null,
        views: 0,
        spaceKey: row.space_key,
        lead: row.description,
        html: rendered.html,
        headings: rendered.headings,
        contactEmail: contact,
        canEdit,
      },
    };
  }

  async #contact(config: PortalConfig, ancestors: string[]): Promise<string | null> {
    const categories = ancestors.slice(0, CATEGORY_LEVELS);
    if (categories.length === 0) return config.contactEmail;
    const result = await this.#database.execute<{ item_id: string; contact_email: string | null }>(sql`
      select item_id, contact_email from knowledge_base_categories
      where item_id = any(${sql.param(categories)}::uuid[]) and contact_email is not null`);
    const byId = new Map(result.rows.map((row) => [row.item_id, row.contact_email]));
    for (const id of [...categories].reverse()) {
      const email = byId.get(id);
      if (email) return email;
    }
    return config.contactEmail;
  }

  async search(
    principal: Principal,
    config: PortalConfig,
    request: {
      query: string;
      categoryId: string | null;
      type: PortalArticleFilter | null;
      cursor: SearchCursor | null;
    },
  ): Promise<PortalSearchResult> {
    const response = await this.#search.portalSearch(principal, {
      organizationId: config.organizationId,
      spaceId: config.spaceId,
      query: request.query,
      categoryId: request.categoryId,
      articleTypes: request.type ? [request.type] : [],
      limit: PORTAL_PAGE_SIZE,
      cursor: request.cursor,
    });
    const ids = response.results.map((hit) => hit.itemId);
    const listed =
      ids.length === 0
        ? []
        : (
            await this.#search.portalArticles(principal, config.organizationId, {
              spaceId: config.spaceId,
              categoryId: null,
              articleTypes: [],
              itemIds: ids,
              excludeItemIds: [],
              sort: "title",
              viewsSince: since(FREQUENT_SEARCH_DAYS),
              limit: ids.length,
              offset: 0,
            })
          ).articles;
    const summaries = new Map(
      (await this.#summaries(config, listed)).map((summary) => [summary.itemId, summary]),
    );
    return {
      results: response.results.flatMap((hit) => {
        const summary = summaries.get(hit.itemId);
        return summary ? [{ ...summary, excerpt: hit.excerpt }] : [];
      }),
      total: response.total,
      nextCursor: response.nextCursor,
      categories: response.categories.map((entry) => ({ id: entry.value, count: entry.count })),
      typeCounts: counts(response.articleTypes),
      suggestion: response.suggestion,
    };
  }

  async frequentSearches(principal: Principal, config: PortalConfig): Promise<string[]> {
    const shown: string[] = [];
    for (const term of await this.#statistics.frequentSearches(config.spaceId, FREQUENT_CANDIDATES)) {
      const found = await this.#search.portalSearch(principal, {
        organizationId: config.organizationId,
        spaceId: config.spaceId,
        query: term,
        categoryId: null,
        articleTypes: [],
        limit: 1,
        cursor: null,
      });
      if (found.total > 0) shown.push(term);
      if (shown.length === FREQUENT_SHOWN) break;
    }
    return shown;
  }

  async readable(principal: Principal, config: PortalConfig, itemId: string): Promise<boolean> {
    const result = await this.#database.execute<{ found: boolean }>(sql`
      select exists (select 1 from tree_items t join spaces s on s.id = t.space_id
        where t.id = ${itemId} and t.space_id = ${config.spaceId} and t.kind = 'page' and t.reader_visible
          and t.published_version_id is not null
          and ${this.#authorization.portalFilter(principal, sql`t`, sql`s`)}) as found`);
    return result.rows[0]?.found ?? false;
  }

  async account(accountId: string): Promise<{ name: string; email: string; type: string } | null> {
    const result = await this.#database.execute<{ name: string; email: string | null; type: string }>(sql`
      select name, email, type from accounts where id = ${accountId} and state = 'active'`);
    const row = result.rows[0];
    return row ? { name: row.name, email: row.email ?? "", type: row.type } : null;
  }

  async seesSpaces(principal: Principal): Promise<boolean> {
    if (principal.type !== "account") return false;
    const result = await this.#database.execute<{ found: boolean }>(sql`
      select exists (select 1 from spaces s where s.deleted_at is null
        and ${this.#authorization.spaceFilter(principal, sql`s`)}) as found`);
    return result.rows[0]?.found ?? false;
  }
}
