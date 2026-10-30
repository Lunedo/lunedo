import { slugify } from "@lunedo/editor-schema";
import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import { requestAccount } from "../accounts/scope.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database } from "../database/database.js";
import { lastReviewedAt } from "../knowledge-bases/reviews.js";
import type { ArticleSort, ListedArticle } from "../search/adapter.js";
import type { SearchCursor, SearchService } from "../search/service.js";
import type { ArticleType } from "../spaces/schema.js";
import type { ArticleRenderer } from "./articles.js";
import { interfaceLanguage, type PortalConfig } from "./portals.js";
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
  number: number;
  slug: string;
  parentId: string | null;
  level: number;
  title: string;
  description: string;
  icon: string | null;
  contactEmail: string | null;
  restricted: boolean;
  articles: number;
}

export interface PortalArticleSummary {
  itemId: string;
  number: number;
  slug: string;
  language: string;
  title: string;
  type: ArticleType | null;
  folderIds: string[];
  updatedAt: Date;
  reviewedAt: Date | null;
  views: number;
}

export interface ArticleAlternate {
  language: string;
  number: number;
  slug: string;
}

export interface PortalArticle extends PortalArticleSummary {
  itemNumber: number;
  spaceKey: string;
  lead: string;
  html: string;
  headings: RenderedHeading[];
  contactEmail: string | null;
  canEdit: boolean;
  fallback: boolean;
  alternates: ArticleAlternate[];
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

  async categories(
    principal: Principal,
    config: PortalConfig,
    language: string = config.defaultLanguage,
  ): Promise<PortalCategory[]> {
    const counted = await this.#search.portalArticleCounts(
      principal,
      config.organizationId,
      config.spaceId,
      language,
    );
    return this.countedCategories(principal, config, counted);
  }

  async countedCategories(
    principal: Principal,
    config: PortalConfig,
    counted: ReadonlyMap<string, number>,
  ): Promise<PortalCategory[]> {
    if (counted.size === 0) return [];
    const result = await this.#database.execute<{
      id: string;
      number: number | string;
      parent_id: string | null;
      level: number;
      title: string;
      description: string;
      icon: string | null;
      contact_email: string | null;
      restricted: boolean;
    }>(sql`
      select c.id, c.number, c.parent_id, cardinality(c.path) as level, c.title, c.description, kc.icon, kc.contact_email,
        exists (select 1 from page_restrictions r where r.item_id = c.id and r.kind = 'view') as restricted
      from tree_items c join spaces s on s.id = c.space_id
      left join knowledge_base_categories kc on kc.item_id = c.id
      where c.space_id = ${config.spaceId} and c.kind = 'folder'
        and c.id = any(${sql.param([...counted.keys()])}::uuid[])
        and ${this.#authorization.portalFilter(principal, sql`c`, sql`s`)}
      order by cardinality(c.path), c.position, c.id`);
    const shown = new Map<string, PortalCategory>();
    const categories: PortalCategory[] = [];
    for (const row of result.rows) {
      const parent = row.parent_id ? shown.get(row.parent_id) : undefined;
      if (row.parent_id !== null && !parent) continue;
      const category: PortalCategory = {
        id: row.id,
        number: Number(row.number),
        slug: slugify(row.title),
        parentId: row.parent_id,
        level: Number(row.level),
        title: row.title,
        description: row.description,
        icon: row.icon,
        contactEmail: row.contact_email ?? parent?.contactEmail ?? config.contactEmail,
        restricted: row.restricted,
        articles: counted.get(row.id) ?? 0,
      };
      shown.set(row.id, category);
      categories.push(category);
    }
    return categories;
  }

  async languageCoverage(principal: Principal, config: PortalConfig): Promise<Map<string, number>> {
    if (config.languages.length < 2) return new Map();
    return this.#search.portalLanguageCounts(principal, config.organizationId, config.spaceId);
  }

  async articles(
    principal: Principal,
    config: PortalConfig,
    options: {
      categoryId?: string | null;
      direct?: boolean;
      type?: PortalArticleFilter | null;
      sort?: ArticleSort;
      limit?: number;
      offset?: number;
      itemIds?: string[] | null;
      exclude?: string[];
      language?: string;
    } = {},
  ): Promise<ArticlePage> {
    const list = await this.#search.portalArticles(principal, config.organizationId, {
      spaceId: config.spaceId,
      categoryId: options.categoryId ?? null,
      direct: options.direct ?? false,
      articleTypes: options.type ? [options.type] : [],
      itemIds: options.itemIds ?? null,
      excludeItemIds: options.exclude ?? [],
      sort: options.sort ?? "views",
      viewsSince: since(FREQUENT_SEARCH_DAYS),
      limit: Math.min(Math.max(options.limit ?? PORTAL_PAGE_SIZE, 1), 50),
      offset: Math.max(options.offset ?? 0, 0),
      language: options.language ?? config.defaultLanguage,
    });
    return {
      articles: await this.#summaries(config, list.articles),
      total: list.total,
      typeCounts: counts(list.articleTypes),
    };
  }

  async #addresses(
    config: PortalConfig,
    itemIds: string[],
  ): Promise<Map<string, { number: number; slug: string; language: string; reviewedAt: Date | null }>> {
    if (itemIds.length === 0) return new Map();
    const result = await this.#database.execute<{
      item_id: string;
      number: number | string;
      title: string | null;
      language: string;
      reviewed_at: Date | string | null;
    }>(sql`
      select t.id as item_id, o.number, v.title,
        case when t.translation_of is null then ${config.defaultLanguage} else t.content_language end as language,
        ${lastReviewedAt(sql`t`)} as reviewed_at
      from tree_items t
      join tree_items o on o.id = coalesce(t.translation_of, t.id)
      left join page_versions v on v.id = t.published_version_id
      where t.space_id = ${config.spaceId} and t.id = any(${sql.param(itemIds)}::uuid[])`);
    return new Map(
      result.rows.map((row) => [
        row.item_id,
        {
          number: Number(row.number),
          slug: slugify(row.title ?? ""),
          language: row.language,
          reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null,
        },
      ]),
    );
  }

  async #summaries(config: PortalConfig, listed: ListedArticle[]): Promise<PortalArticleSummary[]> {
    const addresses = await this.#addresses(
      config,
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
          language: address.language,
          title: article.title,
          type: typeOf(article.articleType),
          folderIds: ancestors,
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
    language: string = config.defaultLanguage,
  ): Promise<ArticleLookup> {
    if (!Number.isSafeInteger(number) || number < 1) return null;
    const found = await this.#database.execute<{
      id: string;
      item_number: number | string;
      space_id: string;
      space_key: string;
      title: string;
      description: string;
      article_type: ArticleType | null;
      path: string[];
      translation_of: string | null;
      language: string;
      version_id: string;
      updated_at: Date;
      reviewed_at: Date | string | null;
    }>(sql`
      select t.id, t.number as item_number, t.space_id, s.key as space_key, v.title, t.description, t.article_type,
        array_remove(t.path, t.translation_of) as path, t.translation_of,
        case when t.translation_of is null then kb.default_language else t.content_language end as language,
        v.id as version_id, v.created_at as updated_at, ${lastReviewedAt(sql`t`)} as reviewed_at
      from tree_items src
      join tree_items t on t.id = src.id or (t.translation_of = src.id and t.space_id = src.space_id)
      join spaces s on s.id = t.space_id
      join knowledge_bases kb on kb.space_id = t.space_id
      join page_versions v on v.id = t.published_version_id
      where src.number = ${number} and src.kind = 'page' and src.translation_of is null
        and t.kind = 'page' and t.reader_visible
        and (t.translation_of is null or t.content_language = any(kb.languages))
        and ${this.#authorization.portalFilter(principal, sql`t`, sql`s`)}`);
    const rows = found.rows.map((row) => ({ ...row, slug: slugify(row.title) }));
    const source = rows.find((row) => row.translation_of === null);
    if (source && source.space_id !== config.spaceId) {
      return { type: "redirect", spaceId: source.space_id, number, slug: source.slug };
    }
    const local = rows.filter((row) => row.space_id === config.spaceId);
    const chosen =
      local.find((row) => row.language === language) ?? local.find((row) => row.translation_of === null);
    if (!chosen) return null;
    const rendered = await this.#renderer.rendered(
      chosen.version_id,
      interfaceLanguage(chosen.language),
      principal,
    );
    if (!rendered) return null;
    const ancestors = chosen.path.filter((id) => id !== chosen.id);
    const contact = await this.#contact(config, ancestors);
    const canEdit =
      principal.type === "account" &&
      (await this.#authorization.decide(principal, "item.edit", { type: "item", id: chosen.id })).allowed;
    return {
      type: "found",
      article: {
        itemId: chosen.id,
        number,
        slug: chosen.slug,
        language: chosen.language,
        title: chosen.title,
        type: chosen.article_type,
        folderIds: ancestors,
        updatedAt: new Date(chosen.updated_at),
        reviewedAt: chosen.reviewed_at ? new Date(chosen.reviewed_at) : null,
        views: 0,
        itemNumber: Number(chosen.item_number),
        spaceKey: chosen.space_key,
        lead: chosen.description,
        html: rendered.html,
        headings: rendered.headings,
        contactEmail: contact,
        canEdit,
        fallback: chosen.language !== language,
        alternates: local
          .map((row) => ({ language: row.language, number, slug: row.slug }))
          .sort((a, b) => a.language.localeCompare(b.language)),
      },
    };
  }

  async #contact(config: PortalConfig, ancestors: string[]): Promise<string | null> {
    if (ancestors.length === 0) return config.contactEmail;
    const result = await this.#database.execute<{ item_id: string; contact_email: string | null }>(sql`
      select item_id, contact_email from knowledge_base_categories
      where item_id = any(${sql.param(ancestors)}::uuid[]) and contact_email is not null`);
    const byId = new Map(result.rows.map((row) => [row.item_id, row.contact_email]));
    for (const id of [...ancestors].reverse()) {
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
      language?: string;
    },
  ): Promise<PortalSearchResult> {
    const language = request.language ?? config.defaultLanguage;
    const response = await this.#search.portalSearch(principal, {
      organizationId: config.organizationId,
      spaceId: config.spaceId,
      query: request.query,
      categoryId: request.categoryId,
      articleTypes: request.type ? [request.type] : [],
      limit: PORTAL_PAGE_SIZE,
      cursor: request.cursor,
      language,
      fallbackLanguage: config.defaultLanguage,
    });
    const ids = response.results.map((hit) => hit.itemId);
    const listed =
      ids.length === 0
        ? []
        : (
            await this.#search.portalArticles(principal, config.organizationId, {
              spaceId: config.spaceId,
              categoryId: null,
              direct: false,
              articleTypes: [],
              itemIds: ids,
              excludeItemIds: [],
              sort: "title",
              viewsSince: since(FREQUENT_SEARCH_DAYS),
              limit: ids.length,
              offset: 0,
              language,
              everyLanguage: true,
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

  async frequentSearches(
    principal: Principal,
    config: PortalConfig,
    language: string = config.defaultLanguage,
  ): Promise<string[]> {
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
        language,
        fallbackLanguage: config.defaultLanguage,
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
    const account = await requestAccount(this.#database, accountId);
    return account?.state === "active"
      ? { name: account.name, email: account.email ?? "", type: account.type }
      : null;
  }

  async admits(principal: Principal, config: PortalConfig): Promise<boolean> {
    if (config.audience === "public") return true;
    if (principal.type !== "account") return false;
    if (await this.#authorization.authorize(principal, "space.view", { type: "space", id: config.spaceId })) {
      return true;
    }
    const result = await this.#database.execute<{ found: boolean }>(sql`
      select exists (select 1 from tree_items t join spaces s on s.id = t.space_id
        where t.space_id = ${config.spaceId} and t.kind in ('page', 'folder')
          and ${this.#authorization.portalFilter(principal, sql`t`, sql`s`)}) as found`);
    return result.rows[0]?.found ?? false;
  }

  async seesSpaces(principal: Principal): Promise<boolean> {
    if (principal.type !== "account") return false;
    const result = await this.#database.execute<{ found: boolean }>(sql`
      select exists (select 1 from spaces s where s.deleted_at is null
        and ${this.#authorization.spaceFilter(principal, sql`s`)}) as found`);
    return result.rows[0]?.found ?? false;
  }
}
