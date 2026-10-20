import { uuidv7 } from "@pagehall/shared";
import { type SQL, sql } from "drizzle-orm";
import { accountPrincipal, type Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import { type KeysetKey, type Page, type PageRequest, pageLimit, toPage } from "../database/keyset.js";
import type { NotificationService } from "../notifications/service.js";
import { actorIdOf, auditScopeOf, SpaceError } from "../spaces/common.js";
import { managedItemCondition, ownerActiveCondition } from "../spaces/ownership.js";
import type { PeopleService } from "../spaces/people.js";
import type { ArticleType } from "../spaces/schema.js";
import { signalSpaceChange } from "../spaces/signals.js";
import { visibleItem } from "../spaces/visibility.js";
import type { ReviewInterval, ReviewLeadDays, ReviewRecipients, ReviewVia } from "./schema.js";

export function lastReviewedAt(item: SQL): SQL {
  return sql`(select r.reviewed_at from article_reviews r left join knowledge_bases kb on kb.space_id = ${item}.space_id
    where r.item_id = ${item}.id
      and (r.interval_months > 0 or (r.interval_months is null and kb.review_interval_months is not null)))`;
}

export const REVIEW_CHANGES_CHANNEL = "pagehall_review_changes";
export const SOON_DAYS = 30;
export const UNDO_SECONDS = 120;
export const MAX_SOURCES = 20;
export const MAX_HOME_REVIEWS = 20;
const OVERDUE_GRACE_MINUTES = 10;
const DISPATCH_BATCH = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ReviewReminderKind = "lead" | "due";
export type ReviewState = "overdue" | "sourceChanged" | "dueSoon" | "current" | "off";
export type ReviewFilter = "all" | "due" | "soon" | "unowned";
export type ArticleInterval = ReviewInterval | 0 | null;

export interface ReviewSettings {
  intervalMonths: ReviewInterval | null;
  leadDays: ReviewLeadDays;
  recipients: ReviewRecipients;
}

export interface PersonReference {
  id: string;
  name: string | null;
}

export interface ArticleReview {
  itemId: string;
  intervalMonths: ArticleInterval;
  effectiveIntervalMonths: ReviewInterval | null;
  inherited: boolean;
  publishedAt: Date | null;
  reviewedAt: Date | null;
  reviewedBy: PersonReference | null;
  dueAt: Date | null;
  sourceChangedAt: Date | null;
  state: ReviewState;
}

export interface ReviewListItem {
  id: string;
  title: string;
  type: ArticleType | null;
  categoryPath: { id: string; title: string }[];
  owner: PersonReference | null;
  ownerActive: boolean;
  formerOwner: PersonReference | null;
  intervalMonths: ReviewInterval | null;
  inherited: boolean;
  publishedAt: Date | null;
  reviewedAt: Date | null;
  dueAt: Date | null;
  sourceChangedAt: Date | null;
  state: ReviewState;
}

export interface ReviewCounts {
  all: number;
  due: number;
  soon: number;
  unowned: number;
}

export interface ReviewList extends Page<ReviewListItem> {
  counts: ReviewCounts;
}

export interface HomeReview {
  id: string;
  title: string;
  type: ArticleType | null;
  spaceKey: string;
  spaceName: string;
  dueAt: Date | null;
  sourceChangedAt: Date | null;
  state: ReviewState;
}

export interface ReviewRecord {
  reviewId: string;
  reviewedAt: Date;
  dueAt: Date | null;
}

export interface ReviewEvent {
  id: string;
  actor: PersonReference | null;
  via: ReviewVia;
  at: Date;
}

export interface ArticleSource {
  id: string;
  title: string;
  spaceKey: string;
  spaceName: string;
  changedAt: Date | null;
}

interface PreviousState {
  reviewedAt: string | null;
  leadRemindedAt: string | null;
  dueRemindedAt: string | null;
  sourceChangedAt: string | null;
  sources: { sourceId: string; changedAt: string }[];
}

export interface ReviewReminder {
  itemId: string;
  kind: ReviewReminderKind;
  dueAt: string;
  leadDays: number;
}

const iso = (value: Date | string | null): string | null =>
  value === null ? null : new Date(value).toISOString();
const date = (value: Date | string | null): Date | null => (value === null ? null : new Date(value));

function effectiveInterval(own: number | null, inherited: number | null): ReviewInterval | null {
  const value = own ?? inherited;
  return value === null || value === 0 ? null : (value as ReviewInterval);
}

export function reviewState(
  review: { dueAt: Date | null; sourceChangedAt: Date | null },
  interval: ReviewInterval | null,
  now: Date,
): ReviewState {
  if (review.dueAt && review.dueAt.getTime() <= now.getTime()) return "overdue";
  if (review.sourceChangedAt) return "sourceChanged";
  if (review.dueAt && review.dueAt.getTime() <= now.getTime() + SOON_DAYS * DAY_MS) return "dueSoon";
  return interval === null ? "off" : "current";
}

export class ReviewService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #audit: AuditLog;
  readonly #people: PeopleService;
  readonly #notifications: NotificationService;
  readonly #administrators: (executor: Executor, spaceId: string) => Promise<string[]>;
  readonly #clock: () => Date;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    audit: AuditLog;
    people: PeopleService;
    notifications: NotificationService;
    administrators: (executor: Executor, spaceId: string) => Promise<string[]>;
    clock?: () => Date;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#audit = options.audit;
    this.#people = options.people;
    this.#notifications = options.notifications;
    this.#administrators = options.administrators;
    this.#clock = options.clock ?? (() => new Date());
  }

  async #requireKnowledgeBase(
    executor: Executor,
    spaceId: string,
  ): Promise<{ name: string; organizationId: string | null }> {
    const result = await executor.execute<{ name: string; organization_id: string | null }>(sql`
      select name, organization_id from spaces where id = ${spaceId} and type = 'knowledgeBase' and deleted_at is null`);
    const row = result.rows[0];
    if (!row) throw new SpaceError("notKnowledgeBase", "The space is not a knowledge base");
    return { name: row.name, organizationId: row.organization_id };
  }

  async settings(spaceId: string): Promise<ReviewSettings> {
    await this.#requireKnowledgeBase(this.#database, spaceId);
    const result = await this.#database.execute<{
      review_interval_months: number | null;
      review_lead_days: number;
      review_recipients: ReviewRecipients;
    }>(sql`
      select review_interval_months, review_lead_days, review_recipients from knowledge_bases where space_id = ${spaceId}`);
    const row = result.rows[0];
    return {
      intervalMonths: (row?.review_interval_months ?? null) as ReviewInterval | null,
      leadDays: (row?.review_lead_days ?? 14) as ReviewLeadDays,
      recipients: row?.review_recipients ?? "owner",
    };
  }

  async updateSettings(
    actor: Principal,
    spaceId: string,
    changes: Partial<ReviewSettings>,
  ): Promise<ReviewSettings> {
    await this.#database.transaction(async (tx) => {
      const space = await this.#requireKnowledgeBase(tx, spaceId);
      await tx.execute(
        sql`insert into knowledge_bases (space_id) values (${spaceId}) on conflict do nothing`,
      );
      const before = await tx.execute<{
        review_interval_months: number | null;
        review_lead_days: number;
        review_recipients: ReviewRecipients;
      }>(sql`
        select review_interval_months, review_lead_days, review_recipients from knowledge_bases
        where space_id = ${spaceId} for update`);
      const previous = before.rows[0];
      if (!previous) throw new SpaceError("notKnowledgeBase", "The space is not a knowledge base");
      const next = {
        intervalMonths:
          changes.intervalMonths === undefined ? previous.review_interval_months : changes.intervalMonths,
        leadDays: changes.leadDays ?? previous.review_lead_days,
        recipients: changes.recipients ?? previous.review_recipients,
      };
      if (
        next.intervalMonths === previous.review_interval_months &&
        next.leadDays === previous.review_lead_days &&
        next.recipients === previous.review_recipients
      ) {
        return;
      }
      await tx.execute(sql`
        update knowledge_bases set review_interval_months = ${next.intervalMonths},
          review_lead_days = ${next.leadDays}, review_recipients = ${next.recipients}, updated_at = now()
        where space_id = ${spaceId}`);
      await this.#audit.record(tx, {
        name: "knowledgeBase.reviewSettingsChanged",
        actor,
        targetId: spaceId,
        fields: {
          name: space.name,
          intervalMonths: next.intervalMonths,
          previousIntervalMonths: previous.review_interval_months,
          leadDays: next.leadDays,
          previousLeadDays: previous.review_lead_days,
          recipients: next.recipients,
          previousRecipients: previous.review_recipients,
        },
        scope: auditScopeOf(space),
      });
      await signalSpaceChange(tx, { spaceId, kind: "space", itemId: null });
    });
    return this.settings(spaceId);
  }

  async #requireArticle(
    executor: Executor,
    itemId: string,
    lock = false,
  ): Promise<{ spaceId: string; title: string; organizationId: string | null }> {
    const result = await executor.execute<{
      space_id: string;
      title: string;
      organization_id: string | null;
    }>(
      sql`
      select t.space_id, t.title, s.organization_id from tree_items t join spaces s on s.id = t.space_id
      where t.id = ${itemId} and t.kind = 'page' and s.type = 'knowledgeBase' and t.trash_entry_id is null
      ${lock ? sql`for update of t` : sql``}`,
    );
    const row = result.rows[0];
    if (!row) throw new SpaceError("notArticle", "Only articles of a knowledge base are reviewed");
    await executor.execute(sql`
      insert into article_reviews (item_id, published_at)
      values (${itemId}, (select min(created_at) from page_versions where item_id = ${itemId}))
      on conflict do nothing`);
    return { spaceId: row.space_id, title: row.title, organizationId: row.organization_id };
  }

  async article(viewer: Principal, itemId: string): Promise<ArticleReview> {
    await this.#requireArticle(this.#database, itemId);
    const result = await this.#database.execute<{
      interval_months: number | null;
      inherited_months: number | null;
      published_at: Date | string | null;
      reviewed_at: Date | string | null;
      reviewed_by: string | null;
      due_at: Date | string | null;
      source_changed_at: Date | string | null;
    }>(sql`
      select r.interval_months, kb.review_interval_months as inherited_months, r.published_at, r.reviewed_at,
        r.reviewed_by, r.due_at, r.source_changed_at
      from article_reviews r join tree_items t on t.id = r.item_id
      left join knowledge_bases kb on kb.space_id = t.space_id
      where r.item_id = ${itemId}`);
    const row = result.rows[0];
    if (!row) throw new SpaceError("notArticle", "Only articles of a knowledge base are reviewed");
    const names = await this.#people.visibleNames(viewer, row.reviewed_by ? [row.reviewed_by] : []);
    const interval = effectiveInterval(row.interval_months, row.inherited_months);
    const editor = await this.#authorization.explain(viewer, "item.edit", { type: "item", id: itemId });
    const review = {
      dueAt: date(row.due_at),
      sourceChangedAt: editor.allowed ? date(row.source_changed_at) : null,
    };
    return {
      itemId,
      intervalMonths: row.interval_months as ArticleInterval,
      effectiveIntervalMonths: interval,
      inherited: row.interval_months === null,
      publishedAt: date(row.published_at),
      reviewedAt: date(row.reviewed_at),
      reviewedBy: row.reviewed_by ? { id: row.reviewed_by, name: names.get(row.reviewed_by) ?? null } : null,
      ...review,
      state: reviewState(review, interval, this.#clock()),
    };
  }

  async setInterval(viewer: Principal, itemId: string, interval: ArticleInterval): Promise<ArticleReview> {
    await this.#database.transaction(async (tx) => {
      const article = await this.#requireArticle(tx, itemId, true);
      await tx.execute(sql`
        update article_reviews set interval_months = ${interval}, updated_at = now() where item_id = ${itemId}`);
      await signalSpaceChange(tx, { spaceId: article.spaceId, kind: "tree", itemId });
    });
    return this.article(viewer, itemId);
  }

  async markReviewed(actor: Principal, itemId: string): Promise<ReviewRecord> {
    return this.#database.transaction(async (tx) => {
      const article = await this.#requireArticle(tx, itemId, true);
      const published = await tx.execute<{ published: boolean }>(
        sql`select published_version_id is not null as published from tree_items where id = ${itemId}`,
      );
      if (!published.rows[0]?.published) {
        throw new SpaceError("articleNotPublished", "Publish the article before marking it as reviewed");
      }
      return this.#record(tx, actor, itemId, article, "marked");
    });
  }

  async reviewedOnPublish(tx: Transaction, actor: Principal, itemId: string): Promise<void> {
    const article = await this.#requireArticle(tx, itemId);
    await this.#record(tx, actor, itemId, article, "published");
  }

  async #record(
    tx: Transaction,
    actor: Principal,
    itemId: string,
    article: { spaceId: string; title: string; organizationId: string | null },
    via: ReviewVia,
  ): Promise<ReviewRecord> {
    const now = this.#clock();
    const current = await tx.execute<{
      reviewed_at: Date | string | null;
      reviewed_by: string | null;
      lead_reminded_at: Date | string | null;
      due_reminded_at: Date | string | null;
      source_changed_at: Date | string | null;
    }>(sql`
      select reviewed_at, reviewed_by, lead_reminded_at, due_reminded_at, source_changed_at
      from article_reviews where item_id = ${itemId} for update`);
    const row = current.rows[0];
    const sources = await tx.execute<{ source_id: string; changed_at: Date | string }>(sql`
      select source_id, changed_at from article_sources where article_id = ${itemId} and changed_at is not null
      order by source_id`);
    const previous: PreviousState = {
      reviewedAt: iso(row?.reviewed_at ?? null),
      leadRemindedAt: iso(row?.lead_reminded_at ?? null),
      dueRemindedAt: iso(row?.due_reminded_at ?? null),
      sourceChangedAt: iso(row?.source_changed_at ?? null),
      sources: sources.rows.map((source) => ({
        sourceId: source.source_id,
        changedAt: new Date(source.changed_at).toISOString(),
      })),
    };
    const reviewId = uuidv7();
    await tx.execute(sql`
      insert into article_review_events (id, item_id, actor_id, via, reviewed_at, previous_reviewed_by, previous_state)
      values (${reviewId}, ${itemId}, ${actorIdOf(actor)}, ${via}, ${now}::timestamptz, ${row?.reviewed_by ?? null},
        ${JSON.stringify(previous)}::jsonb)`);
    const updated = await tx.execute<{ due_at: Date | string | null }>(sql`
      update article_reviews set reviewed_at = ${now}::timestamptz, reviewed_by = ${actorIdOf(actor)},
        source_changed_at = null, updated_at = now()
      where item_id = ${itemId} returning due_at`);
    await tx.execute(sql`update article_sources set changed_at = null where article_id = ${itemId}`);
    await this.#audit.record(tx, {
      name: "article.reviewed",
      actor,
      targetId: itemId,
      fields: { spaceId: article.spaceId, title: article.title, via },
      scope: auditScopeOf(article),
    });
    await signalSpaceChange(tx, { spaceId: article.spaceId, kind: "tree", itemId });
    return { reviewId, reviewedAt: now, dueAt: date(updated.rows[0]?.due_at ?? null) };
  }

  async undoReview(actor: Principal, itemId: string, reviewId: string): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const article = await this.#requireArticle(tx, itemId, true);
      const latest = await tx.execute<{
        id: string;
        actor_id: string | null;
        reviewed_at: Date | string;
        previous_reviewed_by: string | null;
        previous_state: PreviousState;
      }>(sql`
        select id, actor_id, reviewed_at, previous_reviewed_by, previous_state from article_review_events
        where item_id = ${itemId} order by reviewed_at desc, id desc limit 1`);
      const event = latest.rows[0];
      const now = this.#clock();
      if (
        !event ||
        event.id !== reviewId.toLowerCase() ||
        event.actor_id === null ||
        event.actor_id !== actorIdOf(actor) ||
        now.getTime() - new Date(event.reviewed_at).getTime() > UNDO_SECONDS * 1000
      ) {
        throw new SpaceError(
          "reviewNotUndoable",
          "Only the latest review can be undone, by the person who made it and shortly afterwards",
        );
      }
      const previous = event.previous_state;
      await tx.execute(sql`
        update article_reviews set reviewed_at = ${previous.reviewedAt}::timestamptz,
          reviewed_by = ${event.previous_reviewed_by}, lead_reminded_at = ${previous.leadRemindedAt}::timestamptz,
          due_reminded_at = ${previous.dueRemindedAt}::timestamptz,
          source_changed_at = ${previous.sourceChangedAt}::timestamptz, reminders_queued_at = null, updated_at = now()
        where item_id = ${itemId}`);
      for (const source of previous.sources) {
        await tx.execute(sql`
          update article_sources set changed_at = ${source.changedAt}::timestamptz
          where article_id = ${itemId} and source_id = ${source.sourceId}`);
      }
      await tx.execute(sql`delete from article_review_events where id = ${event.id}`);
      await this.#audit.record(tx, {
        name: "article.reviewUndone",
        actor,
        targetId: itemId,
        fields: { spaceId: article.spaceId, title: article.title },
        scope: auditScopeOf(article),
      });
      await signalSpaceChange(tx, { spaceId: article.spaceId, kind: "tree", itemId });
    });
  }

  async history(viewer: Principal, itemId: string): Promise<ReviewEvent[]> {
    const result = await this.#database.execute<{
      id: string;
      actor_id: string | null;
      via: ReviewVia;
      reviewed_at: Date | string;
    }>(sql`
      select id, actor_id, via, reviewed_at from article_review_events where item_id = ${itemId}
      order by reviewed_at desc, id desc limit 200`);
    const names = await this.#people.visibleNames(
      viewer,
      result.rows.map((row) => row.actor_id).filter((id): id is string => id !== null),
    );
    return result.rows.map((row) => ({
      id: row.id,
      actor: row.actor_id ? { id: row.actor_id, name: names.get(row.actor_id) ?? null } : null,
      via: row.via,
      at: new Date(row.reviewed_at),
    }));
  }

  #editable(viewer: Principal): SQL {
    return sql`(t.trash_entry_id is null and t.archived_root_id is null and s.deleted_at is null
      and s.archived_at is null and ${this.#authorization.itemFilter(viewer, sql`t`, sql`s`, "editor", {
        editRestriction: true,
      })})`;
  }

  #category(viewer: Principal, index: number): SQL {
    return sql`(select c.id from tree_items c join spaces cs on cs.id = c.space_id
      where c.id = t.path[${index}] and c.kind = 'folder' and c.id <> t.id
        and ${visibleItem(this.#authorization, viewer, sql`c`, sql`cs`)})`;
  }

  async list(
    viewer: Principal,
    spaceId: string,
    options: { filter?: ReviewFilter; mine?: boolean; page: PageRequest },
  ): Promise<ReviewList> {
    await this.#requireKnowledgeBase(this.#database, spaceId);
    const now = this.#clock();
    const soon = new Date(now.getTime() + SOON_DAYS * DAY_MS);
    const ownerActive = ownerActiveCondition(sql`t`, sql`s`);
    const due = sql`(r.due_at <= ${now}::timestamptz or r.source_changed_at is not null)`;
    const upcoming = sql`(r.due_at > ${now}::timestamptz and r.due_at <= ${soon}::timestamptz and r.source_changed_at is null)`;
    const unowned = sql`(${managedItemCondition(sql`t`, sql`s`)} and not ${ownerActive})`;
    const mine = options.mine && viewer.type === "account" ? sql`and t.owner_id = ${viewer.id}` : sql``;
    const base = sql`from article_reviews r join tree_items t on t.id = r.item_id join spaces s on s.id = t.space_id
      left join knowledge_bases kb on kb.space_id = s.id left join accounts o on o.id = t.owner_id
      where t.space_id = ${spaceId} and t.kind = 'page' and ${this.#editable(viewer)}
        and (${due} or ${upcoming} or ${unowned}) ${mine}`;
    const counted = await this.#database.execute<{
      all: number;
      due: number;
      soon: number;
      unowned: number;
    }>(sql`
      select count(*)::int as all, count(*) filter (where ${due})::int as due,
        count(*) filter (where ${upcoming})::int as soon, count(*) filter (where ${unowned})::int as unowned
      ${base}`);
    const filter =
      options.filter === "due"
        ? due
        : options.filter === "soon"
          ? upcoming
          : options.filter === "unowned"
            ? unowned
            : sql`true`;
    const page = options.page;
    const result = await this.#database.execute<{
      id: string;
      title: string;
      article_type: ArticleType | null;
      category_ids: string[];
      category_titles: string[];
      owner_id: string | null;
      owner_name: string | null;
      owner_active: boolean;
      interval_months: number | null;
      inherited_months: number | null;
      published_at: Date | string | null;
      reviewed_at: Date | string | null;
      due_at: Date | string | null;
      source_changed_at: Date | string | null;
      sort_key: string;
    }>(
      sql`
      select * from (select t.id, t.title, t.article_type,
        array_remove(array[${this.#category(viewer, 1)}, ${this.#category(viewer, 2)}], null) as category_ids,
        array(select c.title from tree_items c
          where c.id = any(array[${this.#category(viewer, 1)}, ${this.#category(viewer, 2)}])
          order by cardinality(c.path)) as category_titles,
        t.owner_id, ${this.#people.visibleName(viewer, sql`o`)} as owner_name, ${ownerActive} as owner_active,
        r.interval_months, kb.review_interval_months as inherited_months, r.published_at, r.reviewed_at, r.due_at,
        r.source_changed_at,
        (case when ${due} then '0' when ${upcoming} then '1' else '2' end) || '|' ||
          coalesce(to_char(least(r.due_at, r.source_changed_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
            '9999') || '|' || lower(t.title) as sort_key
      ${base} and ${filter}) found
      where true ${page.after ? sql`and (found.sort_key, found.id) > (${page.after[0] ?? ""}, ${page.after[1] ?? ""}::uuid)` : sql``}
      order by found.sort_key, found.id
      limit ${pageLimit(page)}`,
    );
    const listed = toPage(
      result.rows,
      page,
      (row): KeysetKey => [row.sort_key, row.id],
      (row): ReviewListItem => {
        const interval = effectiveInterval(row.interval_months, row.inherited_months);
        const review = { dueAt: date(row.due_at), sourceChangedAt: date(row.source_changed_at) };
        const person = row.owner_id ? { id: row.owner_id, name: row.owner_name } : null;
        return {
          id: row.id,
          title: row.title,
          type: row.article_type,
          categoryPath: row.category_ids.map((id, index) => ({
            id,
            title: row.category_titles[index] ?? "",
          })),
          owner: row.owner_active ? person : null,
          ownerActive: row.owner_active,
          formerOwner: row.owner_active ? null : person,
          intervalMonths: interval,
          inherited: row.interval_months === null,
          publishedAt: date(row.published_at),
          reviewedAt: date(row.reviewed_at),
          ...review,
          state: reviewState(review, interval, now),
        };
      },
    );
    const counts = counted.rows[0];
    return {
      ...listed,
      counts: {
        all: Number(counts?.all ?? 0),
        due: Number(counts?.due ?? 0),
        soon: Number(counts?.soon ?? 0),
        unowned: Number(counts?.unowned ?? 0),
      },
    };
  }

  async mine(viewer: Principal): Promise<{ items: HomeReview[]; total: number }> {
    if (viewer.type !== "account") return { items: [], total: 0 };
    const now = this.#clock();
    const soon = new Date(now.getTime() + SOON_DAYS * DAY_MS);
    const result = await this.#database.execute<{
      id: string;
      title: string;
      article_type: ArticleType | null;
      key: string;
      name: string;
      interval_months: number | null;
      inherited_months: number | null;
      due_at: Date | string | null;
      source_changed_at: Date | string | null;
      total: number;
    }>(sql`
      select t.id, t.title, t.article_type, s.key, s.name, r.interval_months,
        kb.review_interval_months as inherited_months, r.due_at, r.source_changed_at, count(*) over ()::int as total
      from article_reviews r join tree_items t on t.id = r.item_id join spaces s on s.id = t.space_id
      left join knowledge_bases kb on kb.space_id = s.id
      where t.owner_id = ${viewer.id} and t.kind = 'page' and s.type = 'knowledgeBase' and ${this.#editable(viewer)}
        and (r.due_at <= ${soon}::timestamptz or r.source_changed_at is not null)
      order by least(r.due_at, r.source_changed_at), t.id
      limit ${MAX_HOME_REVIEWS}`);
    return {
      total: Number(result.rows[0]?.total ?? 0),
      items: result.rows.map((row) => {
        const review = { dueAt: date(row.due_at), sourceChangedAt: date(row.source_changed_at) };
        return {
          id: row.id,
          title: row.title,
          type: row.article_type,
          spaceKey: row.key,
          spaceName: row.name,
          ...review,
          state: reviewState(review, effectiveInterval(row.interval_months, row.inherited_months), now),
        };
      }),
    };
  }

  async sources(viewer: Principal, articleId: string): Promise<ArticleSource[]> {
    const result = await this.#database.execute<{
      id: string;
      title: string;
      key: string;
      name: string;
      changed_at: Date | string | null;
    }>(sql`
      select t.id, t.title, s.key, s.name, a.changed_at
      from article_sources a join tree_items t on t.id = a.source_id join spaces s on s.id = t.space_id
      where a.article_id = ${articleId} and s.deleted_at is null
        and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}
      order by a.created_at, t.id`);
    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      spaceKey: row.key,
      spaceName: row.name,
      changedAt: date(row.changed_at),
    }));
  }

  async addSource(actor: Principal, articleId: string, sourceId: string): Promise<ArticleSource[]> {
    const source = sourceId.toLowerCase();
    await this.#database.transaction(async (tx) => {
      const article = await this.#requireArticle(tx, articleId, true);
      const readable = await this.#authorization.explain(
        actor,
        "item.view",
        { type: "item", id: source },
        { executor: tx },
      );
      const target = await tx.execute<{
        kind: string;
        type: string;
        confidential: boolean;
        organization_id: string | null;
      }>(sql`
        select t.kind, s.type, s.confidential, s.organization_id from tree_items t join spaces s on s.id = t.space_id
        where t.id = ${source} and t.trash_entry_id is null and s.deleted_at is null`);
      const found = target.rows[0];
      if (!readable.allowed || !found) {
        throw new SpaceError("sourceNotFound", "The source page does not exist or you cannot read it");
      }
      if (found.kind !== "page" || found.type === "knowledgeBase") {
        throw new SpaceError(
          "invalidSourcePage",
          "A source is a page of an internal space, not another article",
        );
      }
      if (found.confidential || found.organization_id !== article.organizationId) {
        throw new SpaceError(
          "invalidSourcePage",
          "A source is a page of a space of the same organization that is not confidential",
        );
      }
      const count = await tx.execute<{ sources: number }>(
        sql`select count(*)::int as sources from article_sources where article_id = ${articleId}`,
      );
      if (Number(count.rows[0]?.sources ?? 0) >= MAX_SOURCES) {
        throw new SpaceError("tooManySources", `An article links to at most ${MAX_SOURCES} source pages`);
      }
      const inserted = await tx.execute(sql`
        insert into article_sources (article_id, source_id, added_by) values (${articleId}, ${source}, ${actorIdOf(actor)})
        on conflict do nothing`);
      if (!inserted.rowCount) return;
      await this.#audit.record(tx, {
        name: "article.sourceAdded",
        actor,
        targetId: articleId,
        fields: { spaceId: article.spaceId, title: article.title, sourceId: source },
        scope: auditScopeOf(article),
      });
      await signalSpaceChange(tx, { spaceId: article.spaceId, kind: "tree", itemId: articleId });
    });
    return this.sources(actor, articleId);
  }

  async removeSource(actor: Principal, articleId: string, sourceId: string): Promise<ArticleSource[]> {
    const source = sourceId.toLowerCase();
    await this.#database.transaction(async (tx) => {
      const article = await this.#requireArticle(tx, articleId, true);
      const readable = await this.#authorization.explain(
        actor,
        "item.view",
        { type: "item", id: source },
        { executor: tx },
      );
      const removed = readable.allowed
        ? await tx.execute(
            sql`delete from article_sources where article_id = ${articleId} and source_id = ${source}`,
          )
        : null;
      if (!removed?.rowCount) {
        throw new SpaceError("sourceNotFound", "The article has no such source page");
      }
      await tx.execute(sql`
        update article_reviews set source_changed_at = (select min(changed_at) from article_sources
          where article_id = ${articleId}), updated_at = now()
        where item_id = ${articleId}`);
      await this.#audit.record(tx, {
        name: "article.sourceRemoved",
        actor,
        targetId: articleId,
        fields: { spaceId: article.spaceId, title: article.title, sourceId: source },
        scope: auditScopeOf(article),
      });
      await signalSpaceChange(tx, { spaceId: article.spaceId, kind: "tree", itemId: articleId });
    });
    return this.sources(actor, articleId);
  }

  async sourceChanged(tx: Transaction, sourceId: string): Promise<void> {
    const now = this.#clock();
    const flagged = await tx.execute<{ article_id: string }>(sql`
      update article_sources a set changed_at = ${now}::timestamptz
      from tree_items t join spaces s on s.id = t.space_id, tree_items st join spaces ss on ss.id = st.space_id
      where a.source_id = ${sourceId} and a.changed_at is null and t.id = a.article_id
        and t.trash_entry_id is null and s.type = 'knowledgeBase' and s.deleted_at is null
        and st.id = a.source_id and st.kind = 'page' and st.trash_entry_id is null and ss.deleted_at is null
        and ss.type = 'standard' and not ss.confidential
        and ss.organization_id is not distinct from s.organization_id
      returning a.article_id`);
    if (flagged.rows.length === 0) return;
    const articleIds = flagged.rows.map((row) => row.article_id);
    const newly = await tx.execute<{
      item_id: string;
      title: string;
      space_id: string;
      key: string;
      organization_id: string | null;
      owner_id: string | null;
      recipients: ReviewRecipients;
    }>(sql`
      with changed as (
        update article_reviews r set source_changed_at = ${now}::timestamptz, updated_at = now()
        where r.item_id = any(${sql.param(articleIds)}::uuid[]) and r.source_changed_at is null
        returning r.item_id)
      select t.id as item_id, t.title, s.id as space_id, s.key, s.organization_id,
        case when ${ownerActiveCondition(sql`t`, sql`s`)} then t.owner_id end as owner_id,
        coalesce(kb.review_recipients, 'owner') as recipients
      from changed c join tree_items t on t.id = c.item_id join spaces s on s.id = t.space_id
      left join knowledge_bases kb on kb.space_id = s.id
      where t.archived_root_id is null and s.archived_at is null
      order by t.id`);
    for (const article of newly.rows) {
      const recipients = await this.#recipients(tx, article);
      if (recipients.length > 0) {
        await this.#notifications.notify(tx, {
          type: "article.sourceChanged",
          recipients,
          organizationId: article.organization_id,
          targetId: article.item_id,
          params: { itemTitle: article.title, spaceKey: article.key },
        });
      }
      await signalSpaceChange(tx, { spaceId: article.space_id, kind: "tree", itemId: article.item_id });
    }
  }

  async #recipients(
    tx: Transaction,
    article: { item_id: string; space_id: string; owner_id: string | null; recipients: ReviewRecipients },
  ): Promise<string[]> {
    const candidates = [
      ...(article.owner_id === null ? [] : [article.owner_id]),
      ...(article.owner_id === null || article.recipients === "ownerAndAdministrators"
        ? await this.#administrators(tx, article.space_id)
        : []),
    ];
    const recipients: string[] = [];
    for (const accountId of new Set(candidates)) {
      const decision = await this.#authorization.explain(
        accountPrincipal(accountId),
        "item.view",
        { type: "item", id: article.item_id },
        { executor: tx, fresh: true },
      );
      if (decision.allowed) recipients.push(accountId);
    }
    return recipients;
  }

  async queuePending(
    enqueue: (reminder: ReviewReminder, startAfter: Date) => Promise<void>,
  ): Promise<number> {
    const result = await this.#database.execute<{
      item_id: string;
      due_at: Date | string;
      lead_days: number;
      lead_reminded_at: Date | string | null;
      due_reminded_at: Date | string | null;
    }>(sql`
      select r.item_id, r.due_at, coalesce(kb.review_lead_days, 14) as lead_days, r.lead_reminded_at, r.due_reminded_at
      from article_reviews r join tree_items t on t.id = r.item_id left join knowledge_bases kb on kb.space_id = t.space_id
      where r.due_at is not null and r.reminders_queued_at is null
      order by r.due_at, r.item_id
      limit ${DISPATCH_BATCH}`);
    const now = this.#clock();
    let queued = 0;
    for (const row of result.rows) {
      const dueAt = new Date(row.due_at);
      const leadDays = Number(row.lead_days);
      const later = (at: Date) => (at.getTime() > now.getTime() ? at : now);
      if (row.due_reminded_at === null) {
        if (leadDays > 0 && row.lead_reminded_at === null && dueAt.getTime() > now.getTime()) {
          await enqueue(
            { itemId: row.item_id, kind: "lead", dueAt: dueAt.toISOString(), leadDays },
            later(new Date(dueAt.getTime() - leadDays * DAY_MS)),
          );
        }
        await enqueue(
          { itemId: row.item_id, kind: "due", dueAt: dueAt.toISOString(), leadDays },
          later(dueAt),
        );
      }
      const marked = await this.#database.execute(sql`
        update article_reviews set reminders_queued_at = ${now}::timestamptz
        where item_id = ${row.item_id} and due_at = ${dueAt.toISOString()}::timestamptz and reminders_queued_at is null`);
      queued += marked.rowCount ?? 0;
    }
    return queued;
  }

  async remind(reminder: ReviewReminder): Promise<boolean> {
    return this.#database.transaction(async (tx) => {
      const now = this.#clock();
      const result = await tx.execute<{
        item_id: string;
        title: string;
        space_id: string;
        key: string;
        organization_id: string | null;
        owner_id: string | null;
        recipients: ReviewRecipients;
        due_at: Date | string;
        lead_days: number;
        lead_reminded_at: Date | string | null;
        due_reminded_at: Date | string | null;
      }>(sql`
        select t.id as item_id, t.title, s.id as space_id, s.key, s.organization_id,
          case when ${ownerActiveCondition(sql`t`, sql`s`)} then t.owner_id end as owner_id,
          coalesce(kb.review_recipients, 'owner') as recipients, r.due_at,
          coalesce(kb.review_lead_days, 14) as lead_days, r.lead_reminded_at, r.due_reminded_at
        from article_reviews r join tree_items t on t.id = r.item_id join spaces s on s.id = t.space_id
        left join knowledge_bases kb on kb.space_id = s.id
        where r.item_id = ${reminder.itemId} and r.due_at = ${reminder.dueAt}::timestamptz
          and t.trash_entry_id is null and t.archived_root_id is null and t.published_version_id is not null
          and s.deleted_at is null and s.archived_at is null and s.type = 'knowledgeBase'
        for update of r`);
      const row = result.rows[0];
      if (!row || row.due_reminded_at !== null) return false;
      const dueAt = new Date(row.due_at);
      if (reminder.kind === "lead") {
        const leadDays = Number(row.lead_days);
        if (
          row.lead_reminded_at !== null ||
          leadDays !== reminder.leadDays ||
          leadDays === 0 ||
          now.getTime() >= dueAt.getTime() ||
          now.getTime() < dueAt.getTime() - leadDays * DAY_MS
        ) {
          return false;
        }
        await tx.execute(
          sql`update article_reviews set lead_reminded_at = ${now}::timestamptz where item_id = ${row.item_id}`,
        );
      } else {
        if (now.getTime() < dueAt.getTime()) return false;
        await tx.execute(
          sql`update article_reviews set due_reminded_at = ${now}::timestamptz where item_id = ${row.item_id}`,
        );
      }
      const recipients = await this.#recipients(tx, row);
      if (recipients.length === 0) return true;
      await this.#notifications.notify(tx, {
        type: "article.reviewDue",
        recipients,
        organizationId: row.organization_id,
        targetId: row.item_id,
        params: { itemTitle: row.title, spaceKey: row.key, dueAt: dueAt.toISOString() },
      });
      return true;
    });
  }

  async remindOverdue(): Promise<number> {
    const now = this.#clock();
    const grace = new Date(now.getTime() - OVERDUE_GRACE_MINUTES * 60 * 1000);
    const missed = await this.#database.execute<{
      item_id: string;
      due_at: Date | string;
      lead_days: number;
    }>(sql`
      select r.item_id, r.due_at, coalesce(kb.review_lead_days, 14) as lead_days
      from article_reviews r join tree_items t on t.id = r.item_id left join knowledge_bases kb on kb.space_id = t.space_id
      where r.due_at is not null and r.due_reminded_at is null and r.reminders_queued_at < ${grace}::timestamptz
        and (r.due_at <= ${grace}::timestamptz
          or (r.lead_reminded_at is null and coalesce(kb.review_lead_days, 14) > 0 and r.due_at > ${now}::timestamptz
            and r.due_at - make_interval(days => coalesce(kb.review_lead_days, 14)) <= ${grace}::timestamptz))
      order by r.due_at, r.item_id
      limit ${DISPATCH_BATCH}`);
    let sent = 0;
    for (const row of missed.rows) {
      const dueAt = new Date(row.due_at);
      const kind: ReviewReminderKind = dueAt.getTime() <= grace.getTime() ? "due" : "lead";
      if (
        await this.remind({
          itemId: row.item_id,
          kind,
          dueAt: dueAt.toISOString(),
          leadDays: Number(row.lead_days),
        })
      )
        sent += 1;
    }
    return sent;
  }
}
