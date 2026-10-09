import { isTimeZone, uuidv7 } from "@pagehall/shared";
import { type SQL, sql } from "drizzle-orm";
import { accountPrincipal, type Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database, Transaction } from "../database/database.js";
import type { NotificationService } from "../notifications/service.js";
import { actorIdOf, auditScopeOf, SpaceError } from "../spaces/common.js";
import { insertInitialDocument, normalizeLabel } from "../spaces/documents.js";
import { positionBetween } from "../spaces/fractional-index.js";
import { ITEM_TITLE_MAX_LENGTH, lockSpaces } from "../spaces/items.js";
import type { PeopleService } from "../spaces/people.js";
import { signalSpaceChange } from "../spaces/signals.js";
import type { VersionService } from "../spaces/versions.js";
import { refreshReaderVisibility, spaceKeyFor, spaceNameFor, visibleItem } from "../spaces/visibility.js";

export const EXCERPT_MAX_LENGTH = 500;
export const MAX_BLOG_PAGE = 100;
export const SCHEDULE_MAX_DAYS = 366;
const SCHEDULE_BATCH = 50;

export interface BlogPost {
  id: string;
  spaceId: string;
  spaceKey: string;
  spaceName: string;
  title: string;
  excerpt: string;
  labels: string[];
  author: { id: string; name: string | null } | null;
  published: boolean;
  publishedAt: Date | null;
  scheduledAt: Date | null;
  scheduledTimeZone: string | null;
  scheduledBy: { id: string; name: string | null } | null;
  held: boolean;
  pinnedInSpace: boolean;
  pinnedInOrganization: boolean;
  cover: { attachmentId: string; focusX: number; focusY: number } | null;
  createdAt: Date;
}

export type BlogCursor = [pinned: string, date: string, id: string];

type PostRow = {
  id: string;
  space_id: string;
  key: string;
  space_name: string;
  title: string;
  excerpt: string;
  labels: string[] | null;
  creator_id: string | null;
  creator_name: string | null;
  published_at: Date | string | null;
  scheduled_at: Date | string | null;
  scheduled_time_zone: string | null;
  scheduled_by: string | null;
  scheduler_name: string | null;
  held_at: Date | string | null;
  space_pinned_at: Date | string | null;
  organization_pinned_at: Date | string | null;
  cover_attachment_id: string | null;
  cover_focus_x: number;
  cover_focus_y: number;
  created_at: Date | string;
  sort_pinned: string;
  sort_date: string;
};

function cleanTitle(title: string): string {
  const value = title.replace(/\s+/g, " ").trim();
  if (value.length === 0 || value.length > ITEM_TITLE_MAX_LENGTH) {
    throw new SpaceError("invalidTitle", `The title needs 1 to ${ITEM_TITLE_MAX_LENGTH} characters`);
  }
  return value;
}

function cleanExcerpt(excerpt: string): string {
  const value = excerpt.replace(/\s+/g, " ").trim();
  if (value.length > EXCERPT_MAX_LENGTH) {
    throw new SpaceError("invalidExcerpt", `The excerpt can have up to ${EXCERPT_MAX_LENGTH} characters`);
  }
  return value;
}

function date(value: Date | string | null): Date | null {
  return value === null ? null : new Date(value);
}

function toPost(row: PostRow): BlogPost {
  return {
    id: row.id,
    spaceId: row.space_id,
    spaceKey: row.key,
    spaceName: row.space_name,
    title: row.title,
    excerpt: row.excerpt,
    labels: row.labels ?? [],
    author: row.creator_id ? { id: row.creator_id, name: row.creator_name } : null,
    published: row.published_at !== null,
    publishedAt: date(row.published_at),
    scheduledAt: date(row.scheduled_at),
    scheduledTimeZone: row.scheduled_time_zone,
    scheduledBy: row.scheduled_by ? { id: row.scheduled_by, name: row.scheduler_name } : null,
    held: row.held_at !== null,
    pinnedInSpace: row.space_pinned_at !== null,
    pinnedInOrganization: row.organization_pinned_at !== null,
    cover: row.cover_attachment_id
      ? {
          attachmentId: row.cover_attachment_id,
          focusX: Number(row.cover_focus_x),
          focusY: Number(row.cover_focus_y),
        }
      : null,
    createdAt: new Date(row.created_at),
  };
}

export class BlogService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #versions: VersionService;
  readonly #audit: AuditLog;
  readonly #people: PeopleService;
  readonly #notifications: NotificationService;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    versions: VersionService;
    audit: AuditLog;
    people: PeopleService;
    notifications: NotificationService;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#versions = options.versions;
    this.#audit = options.audit;
    this.#people = options.people;
    this.#notifications = options.notifications;
  }

  #select(viewer: Principal, pinned: SQL): SQL {
    return sql`
      select t.id, t.space_id, ${spaceKeyFor(this.#authorization, viewer, sql`s`)} as key,
        ${spaceNameFor(this.#authorization, viewer, sql`s`)} as space_name, t.title, b.excerpt,
        (select array_agg(l.label order by l.label) from page_labels l where l.item_id = t.id) as labels,
        t.creator_id, ${this.#people.visibleName(viewer, sql`a`)} as creator_name, b.published_at, b.scheduled_at, b.scheduled_time_zone,
        b.scheduled_by, ${this.#people.visibleName(viewer, sql`scheduler`)} as scheduler_name, b.held_at,
        b.space_pinned_at, b.organization_pinned_at, b.cover_attachment_id, b.cover_focus_x, b.cover_focus_y,
        t.created_at,
        coalesce(${pinned}, '-infinity'::timestamptz)::text as sort_pinned,
        coalesce(b.published_at, b.scheduled_at, t.created_at)::text as sort_date
      from blog_posts b join tree_items t on t.id = b.item_id join spaces s on s.id = t.space_id
      left join accounts a on a.id = t.creator_id left join accounts scheduler on scheduler.id = b.scheduled_by`;
  }

  #page(rows: PostRow[], limit: number): { posts: BlogPost[]; next: BlogCursor | null } {
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      posts: page.map(toPost),
      next: rows.length > limit && last ? [last.sort_pinned, last.sort_date, last.id] : null,
    };
  }

  #after(cursor: BlogCursor | undefined, pinned: SQL): SQL {
    if (!cursor) return sql``;
    return sql`and (coalesce(${pinned}, '-infinity'::timestamptz), coalesce(b.published_at, b.scheduled_at, t.created_at), t.id)
      < (${cursor[0]}::timestamptz, ${cursor[1]}::timestamptz, ${cursor[2]}::uuid)`;
  }

  async get(viewer: Principal, itemId: string): Promise<BlogPost | null> {
    const result = await this.#database.execute<PostRow>(sql`
      ${this.#select(viewer, sql`b.space_pinned_at`)}
      where t.id = ${itemId} and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}`);
    const row = result.rows[0];
    return row ? toPost(row) : null;
  }

  async create(actor: Principal, spaceId: string, input: { title: string; excerpt?: string | undefined }) {
    const title = cleanTitle(input.title);
    const excerpt = cleanExcerpt(input.excerpt ?? "");
    const actorId = actorIdOf(actor);
    const id = await this.#database.transaction(async (tx) => {
      await lockSpaces(tx, [spaceId]);
      const last = await tx.execute<{ position: string | null }>(sql`
        select max(position) as position from tree_items where space_id = ${spaceId} and parent_id is null`);
      const itemId = uuidv7();
      await tx.execute(sql`
        insert into tree_items (id, space_id, parent_id, kind, position, title, mode, creator_id, owner_id)
        values (${itemId}, ${spaceId}, null, 'blogPost', ${positionBetween(last.rows[0]?.position ?? null, null)},
          ${title}, 'publish', ${actorId}, ${actorId})`);
      await insertInitialDocument(tx, itemId, actorId);
      await tx.execute(sql`insert into blog_posts (item_id, excerpt) values (${itemId}, ${excerpt})`);
      await refreshReaderVisibility(tx, [itemId]);
      await signalSpaceChange(tx, { spaceId, kind: "blog", itemId });
      return itemId;
    });
    const post = await this.get(actor, id);
    if (!post) throw new Error("The blog post was not created");
    return post;
  }

  async #locked(tx: Transaction, itemId: string) {
    const result = await tx.execute<{
      space_id: string;
      organization_id: string | null;
      title: string;
      published_at: Date | string | null;
      held_at: Date | string | null;
      scheduled_by: string | null;
    }>(sql`
      select t.space_id, s.organization_id, t.title, b.published_at, b.held_at, b.scheduled_by from blog_posts b
      join tree_items t on t.id = b.item_id join spaces s on s.id = t.space_id
      where b.item_id = ${itemId} for update of b`);
    const row = result.rows[0];
    if (!row) throw new SpaceError("itemNotFound", "The blog post does not exist");
    return {
      spaceId: row.space_id,
      organizationId: row.organization_id,
      title: row.title,
      published: row.published_at !== null,
      held: row.held_at !== null,
      scheduledBy: row.scheduled_by,
    };
  }

  async update(actor: Principal, itemId: string, input: { excerpt?: string | undefined }): Promise<BlogPost> {
    const excerpt = input.excerpt === undefined ? undefined : cleanExcerpt(input.excerpt);
    await this.#database.transaction(async (tx) => {
      const post = await this.#locked(tx, itemId);
      if (excerpt !== undefined) {
        await tx.execute(
          sql`update blog_posts set excerpt = ${excerpt}, updated_at = now() where item_id = ${itemId}`,
        );
      }
      await signalSpaceChange(tx, { spaceId: post.spaceId, kind: "blog", itemId });
    });
    const post = await this.get(actor, itemId);
    if (!post) throw new SpaceError("itemNotFound", "The blog post does not exist");
    return post;
  }

  async setCover(
    actor: Principal,
    itemId: string,
    cover: { attachmentId: string; focusX: number; focusY: number } | null,
  ): Promise<BlogPost> {
    if (
      cover &&
      [cover.focusX, cover.focusY].some((value) => !Number.isFinite(value) || value < 0 || value > 1)
    ) {
      throw new SpaceError("invalidFocus", "The focal point must lie inside the image");
    }
    await this.#database.transaction(async (tx) => {
      const post = await this.#locked(tx, itemId);
      if (cover) {
        const image = await tx.execute<{ content_type: string }>(sql`
          select f.content_type from attachments a join attachment_versions v on v.id = a.current_version_id
          join stored_files f on f.id = v.file_id
          where a.id = ${cover.attachmentId} and a.item_id = ${itemId} and a.deleted_at is null`);
        const type = image.rows[0]?.content_type ?? "";
        if (!["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"].includes(type)) {
          throw new SpaceError("invalidCover", "Choose an image attached to this post as cover");
        }
      }
      await tx.execute(sql`
        update blog_posts set cover_attachment_id = ${cover?.attachmentId ?? null},
          cover_focus_x = ${cover?.focusX ?? 0.5}, cover_focus_y = ${cover?.focusY ?? 0.5}, updated_at = now()
        where item_id = ${itemId}`);
      await signalSpaceChange(tx, { spaceId: post.spaceId, kind: "blog", itemId });
    });
    const post = await this.get(actor, itemId);
    if (!post) throw new SpaceError("itemNotFound", "The blog post does not exist");
    return post;
  }

  async schedule(
    actor: Principal,
    itemId: string,
    input: { at: Date; timeZone: string } | null,
  ): Promise<BlogPost> {
    if (input) {
      if (!isTimeZone(input.timeZone)) throw new SpaceError("invalidTimeZone", "The time zone is not known");
      const now = Date.now();
      if (input.at.getTime() <= now) {
        throw new SpaceError("scheduleInPast", "Choose a date and time in the future");
      }
      if (input.at.getTime() > now + SCHEDULE_MAX_DAYS * 86_400_000) {
        throw new SpaceError(
          "scheduleTooLate",
          `Publishing can be scheduled up to ${SCHEDULE_MAX_DAYS} days ahead`,
        );
      }
    }
    await this.#database.transaction(async (tx) => {
      const post = await this.#locked(tx, itemId);
      await tx.execute(sql`
        update blog_posts set scheduled_at = ${input?.at ?? null}, scheduled_by = ${input ? actorIdOf(actor) : null},
          scheduled_time_zone = ${input?.timeZone ?? null}, held_at = null, updated_at = now()
        where item_id = ${itemId}`);
      if (post.held && !input) await this.#recordHeldCancelled(tx, actor, itemId, post);
      await signalSpaceChange(tx, { spaceId: post.spaceId, kind: "blog", itemId });
    });
    const post = await this.get(actor, itemId);
    if (!post) throw new SpaceError("itemNotFound", "The blog post does not exist");
    return post;
  }

  async #recordHeldCancelled(
    tx: Transaction,
    actor: Principal,
    itemId: string,
    post: { spaceId: string; organizationId: string | null; title: string; scheduledBy: string | null },
  ) {
    await this.#audit.record(tx, {
      name: "blogPost.heldCancelled",
      actor,
      targetId: itemId,
      fields: { spaceId: post.spaceId, title: post.title, scheduledBy: post.scheduledBy },
      scope: auditScopeOf(post),
    });
  }

  async publishHeld(actor: Principal, itemId: string): Promise<BlogPost> {
    await this.#versions.publishHeld(actor, itemId);
    const post = await this.get(actor, itemId);
    if (!post) throw new SpaceError("itemNotFound", "The blog post does not exist");
    return post;
  }

  async cancelHeld(actor: Principal, itemId: string): Promise<BlogPost> {
    await this.#database.transaction(async (tx) => {
      const post = await this.#locked(tx, itemId);
      if (!post.held) throw new SpaceError("notHeld", "The blog post is not waiting for approval");
      await tx.execute(sql`
        update blog_posts set scheduled_at = null, scheduled_by = null, scheduled_time_zone = null, held_at = null,
          updated_at = now()
        where item_id = ${itemId}`);
      await this.#recordHeldCancelled(tx, actor, itemId, post);
      await signalSpaceChange(tx, { spaceId: post.spaceId, kind: "blog", itemId });
    });
    const post = await this.get(actor, itemId);
    if (!post) throw new SpaceError("itemNotFound", "The blog post does not exist");
    return post;
  }

  async listScheduled(viewer: Principal, spaceId: string): Promise<BlogPost[]> {
    const result = await this.#database.execute<PostRow>(sql`
      ${this.#select(viewer, sql`null::timestamptz`)}
      where t.space_id = ${spaceId} and b.scheduled_at is not null and t.archived_root_id is null
        and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}
      order by b.held_at is null, b.scheduled_at, t.id
      limit ${MAX_BLOG_PAGE}`);
    return result.rows.map(toPost);
  }

  async #hold(tx: Transaction, itemId: string, scheduledBy: string | null) {
    const result = await tx.execute<{
      space_id: string;
      organization_id: string | null;
      title: string;
      key: string;
    }>(sql`
      select t.space_id, s.organization_id, t.title, s.key from tree_items t join spaces s on s.id = t.space_id
      where t.id = ${itemId}`);
    const row = result.rows[0];
    if (!row) return;
    await this.#audit.record(tx, {
      name: "blogPost.scheduleHeld",
      actor: { type: "system" },
      targetId: itemId,
      fields: { spaceId: row.space_id, title: row.title, scheduledBy },
      scope: auditScopeOf({ organizationId: row.organization_id }),
    });
    const admins = await tx.execute<{ id: string }>(sql`
      select distinct a.id from space_permissions p
      left join group_members gm on p.principal_kind = 'group' and gm.group_id = p.principal_id
        and (gm.expires_at is null or gm.expires_at > now())
      join accounts a on a.id = case when p.principal_kind = 'account' then p.principal_id else gm.account_id end
      where p.space_id = ${row.space_id} and p.role = 'admin' and a.state = 'active'`);
    const approvers: string[] = [];
    for (const admin of admins.rows) {
      const decision = await this.#authorization.explain(
        accountPrincipal(admin.id),
        "item.approveSchedule",
        { type: "item", id: itemId },
        { executor: tx, fresh: true },
      );
      if (decision.allowed) approvers.push(admin.id);
    }
    const recipients = [...new Set([...(scheduledBy ? [scheduledBy] : []), ...approvers])];
    if (recipients.length === 0) return;
    await this.#notifications.notify(tx, {
      type: "blogPost.scheduleHeld",
      recipients,
      organizationId: row.organization_id,
      targetId: itemId,
      actor: scheduledBy ? accountPrincipal(scheduledBy) : null,
      params: {
        itemTitle: row.title,
        itemKind: "blogPost",
        spaceKey: row.key,
        reason: scheduledBy ? "noEditAccess" : "accountRemoved",
        scheduledBy,
        spaceId: row.space_id,
      },
    });
  }

  async pin(
    actor: Principal,
    itemId: string,
    level: "space" | "organization",
    pinned: boolean,
  ): Promise<BlogPost> {
    await this.#database.transaction(async (tx) => {
      const post = await this.#locked(tx, itemId);
      if (!post.published) throw new SpaceError("notPublished", "Publish the blog post before pinning it");
      if (level === "organization" && !post.organizationId) {
        throw new SpaceError(
          "notInOrganization",
          "Only blog posts of an organization's spaces can be pinned there",
        );
      }
      const by = pinned ? actorIdOf(actor) : null;
      const changed =
        level === "space"
          ? await tx.execute(sql`
              update blog_posts set space_pinned_at = ${pinned ? sql`now()` : null}, space_pinned_by = ${by},
                updated_at = now()
              where item_id = ${itemId} and (space_pinned_at is null) = ${pinned}`)
          : await tx.execute(sql`
              update blog_posts set organization_pinned_at = ${pinned ? sql`now()` : null},
                organization_pinned_by = ${by}, updated_at = now()
              where item_id = ${itemId} and (organization_pinned_at is null) = ${pinned}`);
      if ((changed.rowCount ?? 0) === 0) return;
      await this.#audit.record(tx, {
        name: pinned ? "blogPost.pinned" : "blogPost.unpinned",
        actor,
        targetId: itemId,
        fields: { spaceId: post.spaceId, title: post.title, level },
        scope: auditScopeOf(post),
      });
      await signalSpaceChange(tx, { spaceId: post.spaceId, kind: "blog", itemId });
    });
    const post = await this.get(actor, itemId);
    if (!post) throw new SpaceError("itemNotFound", "The blog post does not exist");
    return post;
  }

  async listSpace(
    viewer: Principal,
    spaceId: string,
    options: { after?: BlogCursor | undefined; limit?: number | undefined } = {},
  ): Promise<{ posts: BlogPost[]; next: BlogCursor | null }> {
    const limit = Math.min(Math.max(options.limit ?? 30, 1), MAX_BLOG_PAGE);
    const pinned = sql`b.space_pinned_at`;
    const result = await this.#database.execute<PostRow>(sql`
      ${this.#select(viewer, pinned)}
      where t.space_id = ${spaceId} and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}
        and t.archived_root_id is null
        ${this.#after(options.after, pinned)}
      order by coalesce(${pinned}, '-infinity'::timestamptz) desc,
        coalesce(b.published_at, b.scheduled_at, t.created_at) desc, t.id desc
      limit ${limit + 1}`);
    return this.#page(result.rows, limit);
  }

  async listOrganization(
    viewer: Principal,
    organizationId: string,
    options: {
      spaceId?: string | undefined;
      label?: string | undefined;
      after?: BlogCursor | undefined;
      limit?: number | undefined;
    } = {},
  ): Promise<{ posts: BlogPost[]; next: BlogCursor | null }> {
    const limit = Math.min(Math.max(options.limit ?? 30, 1), MAX_BLOG_PAGE);
    const pinned = sql`b.organization_pinned_at`;
    const label = options.label ? normalizeLabel(options.label) : null;
    const result = await this.#database.execute<PostRow>(sql`
      ${this.#select(viewer, pinned)}
      where s.organization_id = ${organizationId} and b.published_at is not null and s.archived_at is null
        and t.archived_root_id is null and t.reader_visible
        and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}
        ${options.spaceId ? sql`and t.space_id = ${options.spaceId}` : sql``}
        ${label ? sql`and exists (select 1 from page_labels l where l.item_id = t.id and l.label = ${label})` : sql``}
        ${this.#after(options.after, pinned)}
      order by coalesce(${pinned}, '-infinity'::timestamptz) desc, coalesce(b.published_at, b.scheduled_at, t.created_at) desc,
        t.id desc
      limit ${limit + 1}`);
    return this.#page(result.rows, limit);
  }

  async recent(viewer: Principal, limit: number): Promise<BlogPost[]> {
    const result = await this.#database.execute<PostRow>(sql`
      ${this.#select(viewer, sql`null::timestamptz`)}
      where b.published_at > now() - interval '30 days' and t.reader_visible and s.archived_at is null
        and t.archived_root_id is null and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}
      order by b.published_at desc, t.id desc
      limit ${limit}`);
    return result.rows.map(toPost);
  }

  async publishDue(): Promise<number> {
    const due = await this.#database.execute<{ item_id: string }>(sql`
      select item_id from blog_posts where scheduled_at <= now() and held_at is null
      order by scheduled_at limit ${SCHEDULE_BATCH}`);
    let published = 0;
    for (const row of due.rows) {
      const result = await this.#versions.publishScheduled(row.item_id, {
        mayPublish: async (tx, accountId) => {
          const decision = await this.#authorization.explain(
            accountPrincipal(accountId),
            "item.edit",
            { type: "item", id: row.item_id },
            { executor: tx, fresh: true },
          );
          return decision.allowed;
        },
        onHeld: (tx, held) => this.#hold(tx, row.item_id, held.scheduledBy),
      });
      if (result) published += 1;
    }
    return published;
  }
}
