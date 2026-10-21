import { type SQL, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database } from "../database/database.js";
import type { FeedbackCursor, FeedbackText, Period, PortalStatistics, TermCount } from "../portal/statistics.js";
import { auditScopeOf, SpaceError } from "../spaces/common.js";
import { visibleItem } from "../spaces/visibility.js";

export const statisticsPeriods = ["7d", "30d", "90d", "12m"] as const;
export type StatisticsPeriod = (typeof statisticsPeriods)[number];
export const STATISTICS_TERMS = 20;
export const STATISTICS_ARTICLES = 10;
export const FEEDBACK_PAGE = 50;
const ARTICLE_CANDIDATES = 200;

export interface StatisticsArticle {
  id: string;
  title: string;
  categoryPath: { id: string; title: string }[];
}

export interface UnhelpfulArticle {
  article: StatisticsArticle;
  helpful: number;
  unhelpful: number;
  feedback: number;
}

export interface ReadArticle {
  article: StatisticsArticle;
  views: number;
}

export interface KnowledgeBaseStatistics {
  period: Period;
  searches: { total: number; zeroResults: number };
  ratings: { helpful: number; unhelpful: number };
  views: number;
  topTerms: TermCount[];
  zeroResultTerms: TermCount[];
  unhelpful: UnhelpfulArticle[];
  mostRead: ReadArticle[];
}

export interface FeedbackPage {
  items: FeedbackText[];
  nextCursor: FeedbackCursor | null;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function periodRange(period: StatisticsPeriod, now: Date): Period {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === "12m") {
    from.setUTCMonth(from.getUTCMonth() - 12);
    from.setUTCDate(from.getUTCDate() + 1);
  } else {
    from.setUTCDate(from.getUTCDate() - (Number.parseInt(period, 10) - 1));
  }
  return { from: isoDay(from), to: isoDay(now) };
}

export class KnowledgeBaseStatisticsService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #audit: AuditLog;
  readonly #statistics: PortalStatistics;
  readonly #clock: () => Date;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    audit: AuditLog;
    statistics: PortalStatistics;
    clock?: () => Date;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#audit = options.audit;
    this.#statistics = options.statistics;
    this.#clock = options.clock ?? (() => new Date());
  }

  async #requireKnowledgeBase(spaceId: string): Promise<void> {
    const result = await this.#database.execute<{ id: string }>(sql`
      select id from spaces where id = ${spaceId} and type = 'knowledgeBase' and deleted_at is null`);
    if (!result.rows[0]) throw new SpaceError("notKnowledgeBase", "The space is not a knowledge base");
  }

  #category(viewer: Principal, index: number): SQL {
    return sql`(select c.id from tree_items c join spaces cs on cs.id = c.space_id
      where c.id = t.path[${index}] and c.kind = 'folder' and c.id <> t.id
        and ${visibleItem(this.#authorization, viewer, sql`c`, sql`cs`)})`;
  }

  async #articles(
    viewer: Principal,
    spaceId: string,
    ids: string[],
  ): Promise<Map<string, StatisticsArticle>> {
    if (ids.length === 0) return new Map();
    const result = await this.#database.execute<{
      id: string;
      title: string;
      category_ids: string[];
      category_titles: string[];
    }>(sql`
      select t.id, t.title,
        array_remove(array[${this.#category(viewer, 1)}, ${this.#category(viewer, 2)}], null) as category_ids,
        array(select c.title from tree_items c
          where c.id = any(array[${this.#category(viewer, 1)}, ${this.#category(viewer, 2)}])
          order by cardinality(c.path)) as category_titles
      from tree_items t join spaces s on s.id = t.space_id
      where t.id = any(${sql.param(ids)}::uuid[]) and t.space_id = ${spaceId} and t.kind = 'page'
        and t.archived_root_id is null and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}`);
    return new Map(
      result.rows.map((row) => [
        row.id,
        {
          id: row.id,
          title: row.title,
          categoryPath: row.category_ids.map((id, index) => ({
            id,
            title: row.category_titles[index] ?? "",
          })),
        },
      ]),
    );
  }

  async overview(
    viewer: Principal,
    spaceId: string,
    period: StatisticsPeriod,
  ): Promise<KnowledgeBaseStatistics> {
    await this.#requireKnowledgeBase(spaceId);
    const range = periodRange(period, this.#clock());
    const [searches, topTerms, zeroResultTerms, ratings, views, feedback] = await Promise.all([
      this.#statistics.searches(spaceId, range),
      this.#statistics.topTerms(spaceId, range, { limit: STATISTICS_TERMS }),
      this.#statistics.zeroResultTerms(spaceId, range, { limit: STATISTICS_TERMS }),
      this.#statistics.ratings(spaceId, range),
      this.#statistics.articleViews(spaceId, range, ARTICLE_CANDIDATES),
      this.#statistics.feedbackCounts(spaceId, range),
    ]);
    const articles = await this.#articles(viewer, spaceId, [
      ...new Set([...ratings.map((row) => row.itemId), ...views.map((row) => row.itemId)]),
    ]);
    const visibleRatings = ratings.filter((row) => articles.has(row.itemId));
    const notes = new Map(feedback.map((row) => [row.itemId, row.count]));
    const unhelpful = visibleRatings
      .filter((row) => row.unhelpful > 0)
      .sort(
        (a, b) =>
          b.unhelpful - a.unhelpful ||
          b.unhelpful / (b.helpful + b.unhelpful) - a.unhelpful / (a.helpful + a.unhelpful) ||
          a.itemId.localeCompare(b.itemId),
      )
      .slice(0, STATISTICS_ARTICLES)
      .flatMap((row) => {
        const article = articles.get(row.itemId);
        return article
          ? [
              {
                article,
                helpful: row.helpful,
                unhelpful: row.unhelpful,
                feedback: notes.get(row.itemId) ?? 0,
              },
            ]
          : [];
      });
    const visibleViews = views.filter((row) => articles.has(row.itemId));
    const mostRead = visibleViews.slice(0, STATISTICS_ARTICLES).flatMap((row) => {
      const article = articles.get(row.itemId);
      return article ? [{ article, views: row.count }] : [];
    });
    return {
      period: range,
      searches: { total: searches.searches, zeroResults: searches.zeroResults },
      ratings: {
        helpful: visibleRatings.reduce((sum, row) => sum + row.helpful, 0),
        unhelpful: visibleRatings.reduce((sum, row) => sum + row.unhelpful, 0),
      },
      views: visibleViews.reduce((sum, row) => sum + row.count, 0),
      topTerms,
      zeroResultTerms,
      unhelpful,
      mostRead,
    };
  }

  async feedback(
    viewer: Principal,
    spaceId: string,
    itemId: string,
    options: { period: StatisticsPeriod; before?: FeedbackCursor | undefined; limit?: number | undefined },
  ): Promise<FeedbackPage> {
    await this.#requireKnowledgeBase(spaceId);
    const article = itemId.toLowerCase();
    if (!(await this.#articles(viewer, spaceId, [article])).has(article)) {
      throw new SpaceError("notFound", "The article does not exist or you cannot see it");
    }
    const limit = options.limit ?? FEEDBACK_PAGE;
    const items = await this.#statistics.feedback(spaceId, {
      itemId: article,
      period: periodRange(options.period, this.#clock()),
      limit: limit + 1,
      ...(options.before ? { before: options.before } : {}),
    });
    const page = items.slice(0, limit);
    const last = page.at(-1);
    return { items: page, nextCursor: items.length > limit && last ? { day: last.day, id: last.id } : null };
  }

  async deleteFeedback(actor: Principal, spaceId: string, feedbackId: string): Promise<void> {
    await this.#requireKnowledgeBase(spaceId);
    await this.#database.transaction(async (tx) => {
      const found = await tx.execute<{
        item_id: string;
        day: string;
        title: string;
        organization_id: string | null;
      }>(sql`
        select f.item_id, f.day::text as day, t.title, s.organization_id
        from portal_feedback f join tree_items t on t.id = f.item_id join spaces s on s.id = t.space_id
        where f.id = ${feedbackId.toLowerCase()} and f.space_id = ${spaceId}
          and ${visibleItem(this.#authorization, actor, sql`t`, sql`s`)}
        for update of f`);
      const row = found.rows[0];
      if (!row) throw new SpaceError("feedbackNotFound", "The note does not exist anymore");
      await tx.execute(sql`delete from portal_feedback where id = ${feedbackId.toLowerCase()}`);
      await this.#audit.record(tx, {
        name: "article.feedbackDeleted",
        actor,
        targetId: row.item_id,
        fields: { spaceId, title: row.title, day: row.day },
        scope: auditScopeOf({ organizationId: row.organization_id }),
      });
    });
  }
}
