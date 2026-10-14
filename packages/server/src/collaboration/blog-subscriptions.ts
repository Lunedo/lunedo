import { sql } from "drizzle-orm";
import { accountPrincipal, type Principal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import type { NotificationService } from "../notifications/service.js";
import { actorIdOf } from "../spaces/common.js";

export const BLOG_ANNOUNCEMENTS_CHANNEL = "pagehall_blog_announcements";
export const ANNOUNCEMENT_BATCH = 200;
const MAX_FOLLOWED_BLOGS = 500;

export interface FollowedBlog {
  spaceId: string;
  spaceKey: string;
  spaceName: string;
  personal: boolean;
  followedAt: Date;
}

export async function queueBlogAnnouncement(tx: Transaction, itemId: string): Promise<void> {
  await tx.execute(
    sql`insert into blog_post_announcements (item_id) values (${itemId}) on conflict do nothing`,
  );
  await tx.execute(sql`select pg_notify(${BLOG_ANNOUNCEMENTS_CHANNEL}, ${itemId})`);
}

export class BlogSubscriptionService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #notifications: NotificationService;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    notifications: NotificationService;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#notifications = options.notifications;
  }

  #accountOf(actor: Principal): string {
    const accountId = actorIdOf(actor);
    if (!accountId) throw new Error("Only accounts follow blogs");
    return accountId;
  }

  async follow(actor: Principal, spaceId: string): Promise<void> {
    const accountId = this.#accountOf(actor);
    await this.#database.execute(sql`
      insert into blog_subscriptions (space_id, account_id) values (${spaceId}, ${accountId})
      on conflict do nothing`);
  }

  async unfollow(actor: Principal, spaceId: string): Promise<void> {
    const accountId = this.#accountOf(actor);
    await this.#database.execute(
      sql`delete from blog_subscriptions where space_id = ${spaceId} and account_id = ${accountId}`,
    );
  }

  async following(viewer: Principal, spaceId: string, executor: Executor = this.#database): Promise<boolean> {
    const accountId = actorIdOf(viewer);
    if (!accountId) return false;
    const result = await executor.execute(
      sql`select 1 from blog_subscriptions where space_id = ${spaceId} and account_id = ${accountId}`,
    );
    return result.rows.length > 0;
  }

  async list(viewer: Principal): Promise<{ blogs: FollowedBlog[]; unavailable: number }> {
    const accountId = this.#accountOf(viewer);
    const visible = this.#authorization.spaceFilter(viewer, sql`s`);
    const result = await this.#database.execute<{
      space_id: string;
      key: string;
      name: string;
      personal: boolean;
      created_at: Date | string;
    }>(sql`
      select s.id as space_id, s.key, s.name, s.personal_of is not null as personal, b.created_at
      from blog_subscriptions b join spaces s on s.id = b.space_id
      where b.account_id = ${accountId} and ${visible}
      order by lower(s.name), s.id
      limit ${MAX_FOLLOWED_BLOGS}`);
    const hidden = await this.#database.execute<{ count: number }>(sql`
      select count(*)::int as count from blog_subscriptions b join spaces s on s.id = b.space_id
      where b.account_id = ${accountId} and not ${visible}`);
    return {
      blogs: result.rows.map((row) => ({
        spaceId: row.space_id,
        spaceKey: row.key,
        spaceName: row.name,
        personal: row.personal,
        followedAt: new Date(row.created_at),
      })),
      unavailable: Number(hidden.rows[0]?.count ?? 0),
    };
  }

  async removeUnavailable(viewer: Principal): Promise<number> {
    const accountId = this.#accountOf(viewer);
    const removed = await this.#database.execute(sql`
      delete from blog_subscriptions b using spaces s
      where s.id = b.space_id and b.account_id = ${accountId}
        and not ${this.#authorization.spaceFilter(viewer, sql`s`)}`);
    return removed.rowCount ?? 0;
  }

  async deliverPending(options: { signal?: AbortSignal } = {}): Promise<number> {
    let delivered = 0;
    for (;;) {
      options.signal?.throwIfAborted();
      const batch = await this.#deliverBatch();
      if (batch === null) return delivered;
      delivered += batch;
    }
  }

  async #deliverBatch(): Promise<number | null> {
    return this.#database.transaction(async (tx) => {
      const pending = await tx.execute<{ item_id: string; delivered_through: string | null }>(sql`
        select item_id, delivered_through from blog_post_announcements
        order by created_at, item_id limit 1 for update skip locked`);
      const announcement = pending.rows[0];
      if (!announcement) return null;
      const itemId = announcement.item_id;
      const post = await tx.execute<{
        title: string;
        space_id: string;
        key: string;
        name: string;
        organization_id: string | null;
      }>(sql`
        select t.title, t.space_id, s.key, s.name, s.organization_id
        from tree_items t join blog_posts b on b.item_id = t.id join spaces s on s.id = t.space_id
        where t.id = ${itemId} and b.published_at is not null and t.trash_entry_id is null
          and t.archived_root_id is null and s.deleted_at is null`);
      const facts = post.rows[0];
      if (!facts) {
        await tx.execute(sql`delete from blog_post_announcements where item_id = ${itemId}`);
        return 0;
      }
      const followers = await tx.execute<{ account_id: string }>(sql`
        select b.account_id from blog_subscriptions b join accounts a on a.id = b.account_id
        where b.space_id = ${facts.space_id} and a.state = 'active'
          and b.account_id > coalesce(${announcement.delivered_through}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
        order by b.account_id
        limit ${ANNOUNCEMENT_BATCH}`);
      const authors = await tx.execute<{ account_id: string }>(sql`
        select creator_id as account_id from tree_items where id = ${itemId} and creator_id is not null
        union select created_by from page_versions where item_id = ${itemId} and created_by is not null
        union select unnest(contributors) from page_versions where item_id = ${itemId}`);
      const excluded = new Set(authors.rows.map((row) => row.account_id));
      const recipients: string[] = [];
      for (const follower of followers.rows) {
        if (excluded.has(follower.account_id)) continue;
        const decision = await this.#authorization.explain(
          accountPrincipal(follower.account_id),
          "item.view",
          { type: "item", id: itemId },
          { executor: tx, fresh: true },
        );
        if (decision.allowed) recipients.push(follower.account_id);
      }
      if (recipients.length > 0) {
        await this.#notifications.notify(tx, {
          type: "blogPost.published",
          recipients,
          organizationId: facts.organization_id,
          targetId: itemId,
          params: {
            itemTitle: facts.title,
            itemKind: "blogPost",
            spaceKey: facts.key,
            spaceName: facts.name,
          },
        });
      }
      const last = followers.rows.at(-1)?.account_id;
      if (followers.rows.length < ANNOUNCEMENT_BATCH || !last) {
        await tx.execute(sql`delete from blog_post_announcements where item_id = ${itemId}`);
      } else {
        await tx.execute(sql`
          update blog_post_announcements set delivered_through = ${last}, updated_at = now()
          where item_id = ${itemId}`);
      }
      return recipients.length;
    });
  }
}
