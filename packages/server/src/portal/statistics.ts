import { uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../database/database.js";
import { defineJob, type JobQueue } from "../jobs/job-queue.js";

export const TERM_MAX_LENGTH = 200;
export const FEEDBACK_MAX_LENGTH = 2000;
export const MINIMUM_TERM_SEARCHES = 3;
export const FREQUENT_SEARCH_DAYS = 90;
export const FEEDBACK_SWEEP_SCHEDULE = "41 3 * * *";
export const RAW_SEARCH_MONTHS = 12;
export const SEARCH_AGGREGATION_SCHEDULE = "47 3 * * *";

export const feedbackDeletionJob = defineJob({
  name: "portal.delete-feedback",
  payload: z.object({ feedbackId: z.uuid() }),
  retryLimit: 5,
  retryDelaySeconds: 300,
});

export const feedbackRetentionJob = defineJob({
  name: "portal.feedback-retention",
  payload: z.object({ spaceId: z.uuid().optional() }),
  retryLimit: 3,
  retryDelaySeconds: 300,
});

export const searchAggregationJob = defineJob({
  name: "portal.aggregate-searches",
  payload: z.object({ spaceId: z.uuid().optional() }),
  retryLimit: 3,
  retryDelaySeconds: 300,
});

export interface Period {
  from: string;
  to: string;
}

export interface DailyCount {
  day: string;
  count: number;
}

export interface ArticleCount {
  itemId: string;
  count: number;
}

export interface TermCount {
  term: string;
  searches: number;
  zeroResults: number;
  lastSearchedAt: Date;
}

export interface RatingCount {
  itemId: string;
  helpful: number;
  unhelpful: number;
}

export interface FeedbackText {
  id: string;
  itemId: string;
  day: string;
  text: string;
}

export function normalizeTerm(value: string): string | null {
  const term = [
    ...value
      .normalize("NFC")
      .replace(/\p{Cc}/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase(),
  ]
    .slice(0, TERM_MAX_LENGTH)
    .join("")
    .trim();
  return term.length > 0 ? term : null;
}

export function cleanFeedback(value: string): string | null {
  const text = [
    ...value
      .normalize("NFC")
      .replace(/[\p{Cc}--[\n\t]]/gv, "")
      .trim(),
  ]
    .slice(0, FEEDBACK_MAX_LENGTH)
    .join("")
    .trim();
  return text.length > 0 ? text : null;
}

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function aggregationStart(searchDay: string): Date {
  const start = new Date(`${searchDay}T00:05:00Z`);
  start.setUTCDate(start.getUTCDate() + 1);
  start.setUTCMonth(start.getUTCMonth() + RAW_SEARCH_MONTHS);
  return start;
}

function hour(date: Date): Date {
  const truncated = new Date(date);
  truncated.setUTCMinutes(0, 0, 0);
  return truncated;
}

export class PortalStatistics {
  readonly #database: Database;
  readonly #jobs: JobQueue | undefined;
  readonly #clock: () => Date;
  readonly #aggregationQueued = new Map<string, string>();

  constructor(options: { database: Database; jobs?: JobQueue | undefined; clock?: () => Date }) {
    this.#database = options.database;
    this.#jobs = options.jobs;
    this.#clock = options.clock ?? (() => new Date());
  }

  async recordSearch(
    spaceId: string,
    input: { term: string; results: number; categoryId: string | null },
  ): Promise<void> {
    const term = normalizeTerm(input.term);
    if (!term) return;
    await this.#database.execute(sql`
      insert into portal_searches (id, space_id, term, results, category_id, searched_at)
      select ${uuidv7()}, ${spaceId}, ${term}, ${Math.max(0, input.results)},
        (select id from tree_items where id = ${input.categoryId} and space_id = ${spaceId}),
        ${hour(this.#clock())}`);
    await this.#scheduleAggregation(spaceId);
  }

  async #scheduleAggregation(spaceId: string): Promise<void> {
    const today = day(this.#clock());
    if (!this.#jobs || this.#aggregationQueued.get(spaceId) === today) return;
    await this.#jobs.enqueue(
      searchAggregationJob,
      { spaceId },
      { idempotencyKey: `${spaceId}:${today}`, startAfter: aggregationStart(today) },
    );
    this.#aggregationQueued.set(spaceId, today);
  }

  async aggregateSearches(spaceId?: string): Promise<number> {
    const result = await this.#database.execute<{ moved: string }>(sql`
      with moved as (
        delete from portal_searches
        where searched_at < ${this.#clock()}::timestamptz - make_interval(months => ${RAW_SEARCH_MONTHS})
          ${spaceId ? sql`and space_id = ${spaceId}` : sql``}
        returning space_id, term, searched_at, zero_results
      ),
      grouped as (
        select space_id, term, date_trunc('month', searched_at at time zone 'UTC')::date as month,
          count(*) as searches, count(*) filter (where zero_results) as zero_results
        from moved group by 1, 2, 3
      ),
      merged as (
        insert into portal_search_months (space_id, term, month, searches, zero_results)
        select g.space_id, g.term, g.month, g.searches, g.zero_results from grouped g
        where coalesce((select m.searches from portal_search_months m
            where m.space_id = g.space_id and m.month = g.month and m.term = g.term), 0)
          + (select count(*) from portal_searches r
            where r.space_id = g.space_id and r.term = g.term
              and r.searched_at >= g.month::timestamp at time zone 'UTC'
              and r.searched_at < (g.month + interval '1 month')::timestamp at time zone 'UTC')
          >= ${MINIMUM_TERM_SEARCHES}
        on conflict (space_id, month, term) do update set
          searches = portal_search_months.searches + excluded.searches,
          zero_results = portal_search_months.zero_results + excluded.zero_results
        returning 1
      )
      select count(*) as moved from moved`);
    return Number(result.rows[0]?.moved ?? 0);
  }

  async recordView(spaceId: string, itemId: string): Promise<void> {
    await this.#database.execute(sql`
      insert into portal_article_views (item_id, space_id, day, views)
      values (${itemId}, ${spaceId}, ${day(this.#clock())}, 1)
      on conflict (item_id, day) do update set views = portal_article_views.views + 1`);
  }

  async recordRating(spaceId: string, itemId: string, helpful: boolean): Promise<void> {
    await this.#database.execute(sql`
      insert into portal_ratings (item_id, space_id, day, helpful, unhelpful)
      values (${itemId}, ${spaceId}, ${day(this.#clock())}, ${helpful ? 1 : 0}, ${helpful ? 0 : 1})
      on conflict (item_id, day) do update set
        helpful = portal_ratings.helpful + excluded.helpful,
        unhelpful = portal_ratings.unhelpful + excluded.unhelpful`);
  }

  async recordFeedback(spaceId: string, itemId: string, value: string): Promise<boolean> {
    const text = cleanFeedback(value);
    if (!text) return false;
    const id = uuidv7();
    const inserted = await this.#database.execute<{ due: string }>(sql`
      insert into portal_feedback (id, item_id, space_id, day, text)
      values (${id}, ${itemId}, ${spaceId}, ${day(this.#clock())}, ${text})
      returning (select (current_date + make_interval(months => kb.feedback_retention_months))::date::text
        from knowledge_bases kb where kb.space_id = ${spaceId}) as due`);
    const due = inserted.rows[0]?.due;
    if (due) await this.#scheduleDeletion(id, due);
    return true;
  }

  async #scheduleDeletion(feedbackId: string, due: string): Promise<void> {
    await this.#jobs?.enqueue(
      feedbackDeletionJob,
      { feedbackId },
      { idempotencyKey: `${feedbackId}:${due}`, startAfter: new Date(`${due}T00:05:00Z`) },
    );
  }

  async deleteFeedbackWhenDue(feedbackId: string): Promise<"deleted" | "rescheduled" | "gone"> {
    const result = await this.#database.execute<{ due: string; deleted: boolean }>(sql`
      with target as (
        select f.id, (f.day + make_interval(months => kb.feedback_retention_months))::date as due
        from portal_feedback f join knowledge_bases kb on kb.space_id = f.space_id where f.id = ${feedbackId}
      ),
      removed as (
        delete from portal_feedback f using target t
        where f.id = t.id and t.due <= ${day(this.#clock())}::date returning f.id
      )
      select t.due::text as due, exists (select 1 from removed) as deleted from target t`);
    const row = result.rows[0];
    if (!row) return "gone";
    if (row.deleted) return "deleted";
    await this.#scheduleDeletion(feedbackId, row.due);
    return "rescheduled";
  }

  async applyRetention(spaceId?: string): Promise<number> {
    const result = await this.#database.execute<{ id: string }>(sql`
      delete from portal_feedback f using knowledge_bases kb
      where kb.space_id = f.space_id ${spaceId ? sql`and f.space_id = ${spaceId}` : sql``}
        and (f.day + make_interval(months => kb.feedback_retention_months))::date <= ${day(this.#clock())}::date
      returning f.id`);
    return result.rows.length;
  }

  async retentionChanged(spaceId: string): Promise<void> {
    await this.applyRetention(spaceId);
    const pending = await this.#database.execute<{ id: string; due: string }>(sql`
      select f.id, (f.day + make_interval(months => kb.feedback_retention_months))::date::text as due
      from portal_feedback f join knowledge_bases kb on kb.space_id = f.space_id where f.space_id = ${spaceId}`);
    for (const row of pending.rows) await this.#scheduleDeletion(row.id, row.due);
  }

  async views(spaceId: string, period: Period): Promise<DailyCount[]> {
    const result = await this.#database.execute<{ day: string; count: string }>(sql`
      select day::text as day, sum(views) as count from portal_article_views
      where space_id = ${spaceId} and day between ${period.from}::date and ${period.to}::date
      group by day order by day`);
    return result.rows.map((row) => ({ day: row.day, count: Number(row.count) }));
  }

  async articleViews(spaceId: string, period: Period, limit = 50): Promise<ArticleCount[]> {
    const result = await this.#database.execute<{ item_id: string; count: string }>(sql`
      select item_id, sum(views) as count from portal_article_views
      where space_id = ${spaceId} and day between ${period.from}::date and ${period.to}::date
      group by item_id order by count desc, item_id limit ${limit}`);
    return result.rows.map((row) => ({ itemId: row.item_id, count: Number(row.count) }));
  }

  async searches(spaceId: string, period: Period): Promise<{ searches: number; zeroResults: number }> {
    const result = await this.#database.execute<{ searches: string; zero: string }>(sql`
      select count(*) as searches, count(*) filter (where zero_results) as zero from portal_searches
      where space_id = ${spaceId} and searched_at >= ${period.from}::date
        and searched_at < ${period.to}::date + 1`);
    const row = result.rows[0];
    return { searches: Number(row?.searches ?? 0), zeroResults: Number(row?.zero ?? 0) };
  }

  topTerms(
    spaceId: string,
    period: Period,
    options: { limit?: number; minimum?: number } = {},
  ): Promise<TermCount[]> {
    return this.#terms(spaceId, period, sql`true`, options);
  }

  zeroResultTerms(
    spaceId: string,
    period: Period,
    options: { limit?: number; minimum?: number } = {},
  ): Promise<TermCount[]> {
    return this.#terms(spaceId, period, sql`zero_results`, options);
  }

  async #terms(
    spaceId: string,
    period: Period,
    condition: ReturnType<typeof sql>,
    options: { limit?: number; minimum?: number },
  ): Promise<TermCount[]> {
    const result = await this.#database.execute<{
      term: string;
      searches: string;
      zero: string;
      last: Date;
    }>(sql`
      select term, count(*) as searches, count(*) filter (where zero_results) as zero, max(searched_at) as last
      from portal_searches
      where space_id = ${spaceId} and searched_at >= ${period.from}::date
        and searched_at < ${period.to}::date + 1 and ${condition}
      group by term having count(*) >= ${options.minimum ?? MINIMUM_TERM_SEARCHES}
      order by searches desc, term limit ${options.limit ?? 50}`);
    return result.rows.map((row) => ({
      term: row.term,
      searches: Number(row.searches),
      zeroResults: Number(row.zero),
      lastSearchedAt: new Date(row.last),
    }));
  }

  async frequentSearches(spaceId: string, limit = 4): Promise<string[]> {
    const result = await this.#database.execute<{ term: string }>(sql`
      select term from portal_searches
      where space_id = ${spaceId} and not zero_results
        and searched_at >= now() - make_interval(days => ${FREQUENT_SEARCH_DAYS})
      group by term having count(*) >= ${MINIMUM_TERM_SEARCHES}
      order by count(*) desc, term limit ${limit}`);
    return result.rows.map((row) => row.term);
  }

  async ratings(spaceId: string, period: Period, itemId?: string): Promise<RatingCount[]> {
    const result = await this.#database.execute<{ item_id: string; helpful: string; unhelpful: string }>(sql`
      select item_id, sum(helpful) as helpful, sum(unhelpful) as unhelpful from portal_ratings
      where space_id = ${spaceId} and day between ${period.from}::date and ${period.to}::date
        ${itemId ? sql`and item_id = ${itemId}` : sql``}
      group by item_id order by item_id`);
    return result.rows.map((row) => ({
      itemId: row.item_id,
      helpful: Number(row.helpful),
      unhelpful: Number(row.unhelpful),
    }));
  }

  async feedbackCounts(spaceId: string, period: Period): Promise<ArticleCount[]> {
    const result = await this.#database.execute<{ item_id: string; count: string }>(sql`
      select item_id, count(*) as count from portal_feedback
      where space_id = ${spaceId} and day between ${period.from}::date and ${period.to}::date
      group by item_id order by item_id`);
    return result.rows.map((row) => ({ itemId: row.item_id, count: Number(row.count) }));
  }

  async feedback(
    spaceId: string,
    options: { itemId?: string; period?: Period; limit?: number; before?: string } = {},
  ): Promise<FeedbackText[]> {
    const result = await this.#database.execute<{
      id: string;
      item_id: string;
      day: string;
      text: string;
    }>(sql`
      select id, item_id, day::text as day, text from portal_feedback
      where space_id = ${spaceId} ${options.itemId ? sql`and item_id = ${options.itemId}` : sql``}
        ${options.period ? sql`and day between ${options.period.from}::date and ${options.period.to}::date` : sql``}
        ${options.before ? sql`and id < ${options.before}::uuid` : sql``}
      order by id desc limit ${options.limit ?? 50}`);
    return result.rows.map((row) => ({ id: row.id, itemId: row.item_id, day: row.day, text: row.text }));
  }
}
