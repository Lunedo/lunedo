import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "../accounts/schema.js";
import { primaryId, timestamps } from "../database/columns.js";
import { attachments } from "../files/schema.js";
import { spaces, treeItems } from "../spaces/schema.js";

const timestampColumn = () => timestamp({ withTimezone: true, mode: "date" });

export const comments = pgTable(
  "comments",
  {
    id: primaryId(),
    itemId: uuid()
      .notNull()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    parentId: uuid().references((): AnyPgColumn => comments.id, { onDelete: "cascade" }),
    authorId: uuid().references(() => accounts.id, { onDelete: "set null" }),
    body: jsonb(),
    quote: text(),
    quotePrefix: text(),
    quoteSuffix: text(),
    quotePublic: boolean().notNull().default(false),
    detachedAt: timestampColumn(),
    resolvedAt: timestampColumn(),
    resolvedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    editedAt: timestampColumn(),
    deletedAt: timestampColumn(),
    deletedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    index().on(table.itemId, table.createdAt),
    index().on(table.parentId),
    index().on(table.authorId),
    index().on(table.resolvedBy),
    index().on(table.deletedBy),
    check("comments_reply_has_no_quote", sql`${table.parentId} is null or ${table.quote} is null`),
    check("comments_body_kept", sql`${table.body} is not null or ${table.deletedAt} is not null`),
  ],
);

export const reactions = pgTable(
  "reactions",
  {
    itemId: uuid()
      .notNull()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    commentId: uuid().references(() => comments.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    emoji: text().notNull(),
    createdAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [
    unique("reactions_unique")
      .on(table.itemId, table.commentId, table.accountId, table.emoji)
      .nullsNotDistinct(),
    index().on(table.commentId),
    index().on(table.accountId),
  ],
);

export const contentMentions = pgTable(
  "content_mentions",
  {
    id: primaryId(),
    itemId: uuid()
      .notNull()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    commentId: uuid().references(() => comments.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    actorId: uuid().references(() => accounts.id, { onDelete: "set null" }),
    notifiedAt: timestampColumn(),
    createdAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [
    unique("content_mentions_unique").on(table.itemId, table.commentId, table.accountId).nullsNotDistinct(),
    index().on(table.accountId, table.notifiedAt),
    index().on(table.commentId),
    index().on(table.actorId),
    index("content_mentions_pending_index").on(table.createdAt).where(sql`${table.notifiedAt} is null`),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid().primaryKey(),
    itemId: uuid()
      .notNull()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    published: boolean().notNull().default(false),
    assigneeId: uuid().references(() => accounts.id, { onDelete: "set null" }),
    dueDate: date({ mode: "string" }),
    text: text().notNull().default(""),
    position: integer().notNull().default(0),
    done: boolean().notNull().default(false),
    statusChangedAt: timestampColumn(),
    statusChangedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    notifiedAssigneeId: uuid().references(() => accounts.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    index().on(table.itemId),
    index("tasks_assignee_index")
      .on(table.assigneeId, table.done, table.dueDate)
      .where(sql`${table.published}`),
    index().on(table.statusChangedBy),
    index().on(table.notifiedAssigneeId),
  ],
);

export const taskStatusChanges = pgTable(
  "task_status_changes",
  {
    id: primaryId(),
    taskId: uuid()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    done: boolean().notNull(),
    actorId: uuid().references(() => accounts.id, { onDelete: "set null" }),
    changedAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [index().on(table.taskId, table.changedAt), index().on(table.actorId)],
);

export const blogPosts = pgTable(
  "blog_posts",
  {
    itemId: uuid()
      .primaryKey()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    excerpt: text().notNull().default(""),
    scheduledAt: timestampColumn(),
    scheduledBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    scheduledTimeZone: text(),
    heldAt: timestampColumn(),
    coverAttachmentId: uuid().references(() => attachments.id, { onDelete: "set null" }),
    coverFocusX: real().notNull().default(0.5),
    coverFocusY: real().notNull().default(0.5),
    publishedAt: timestampColumn(),
    spacePinnedAt: timestampColumn(),
    spacePinnedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    organizationPinnedAt: timestampColumn(),
    organizationPinnedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    index().on(table.publishedAt),
    index("blog_posts_scheduled_index").on(table.scheduledAt).where(sql`${table.scheduledAt} is not null`),
    index().on(table.scheduledBy),
    index().on(table.spacePinnedBy),
    index().on(table.organizationPinnedBy),
    index().on(table.coverAttachmentId),
    check(
      "blog_posts_cover_focus",
      sql`${table.coverFocusX} between 0 and 1 and ${table.coverFocusY} between 0 and 1`,
    ),
    check("blog_posts_excerpt_length", sql`length(${table.excerpt}) <= 500`),
  ],
);

export const stars = pgTable(
  "stars",
  {
    id: primaryId(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    itemId: uuid().references(() => treeItems.id, { onDelete: "cascade" }),
    spaceId: uuid().references(() => spaces.id, { onDelete: "cascade" }),
    createdAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("stars_item_unique")
      .on(table.accountId, table.itemId)
      .where(sql`${table.itemId} is not null`),
    uniqueIndex("stars_space_unique")
      .on(table.accountId, table.spaceId)
      .where(sql`${table.spaceId} is not null`),
    index().on(table.itemId),
    index().on(table.spaceId),
    check("stars_one_target", sql`(${table.itemId} is null) <> (${table.spaceId} is null)`),
  ],
);

export const recentViews = pgTable(
  "recent_views",
  {
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    itemId: uuid()
      .notNull()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    viewedAt: timestampColumn().notNull().defaultNow(),
    views: integer().notNull().default(1),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.itemId] }),
    index().on(table.accountId, table.viewedAt),
    index().on(table.itemId),
    index().on(table.viewedAt),
  ],
);

export const blogSubscriptions = pgTable(
  "blog_subscriptions",
  {
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (table) => [primaryKey({ columns: [table.spaceId, table.accountId] }), index().on(table.accountId)],
);

export const blogPostAnnouncements = pgTable("blog_post_announcements", {
  itemId: uuid()
    .primaryKey()
    .references(() => treeItems.id, { onDelete: "cascade" }),
  deliveredThrough: uuid(),
  ...timestamps(),
});
