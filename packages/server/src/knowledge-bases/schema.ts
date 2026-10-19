import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "../accounts/schema.js";
import { timestamps } from "../database/columns.js";
import { spaces, treeItems } from "../spaces/schema.js";

const timestampColumn = () => timestamp({ withTimezone: true, mode: "date" });

export const reviewIntervals = [3, 6, 12] as const;
export type ReviewInterval = (typeof reviewIntervals)[number];
export const reviewLeadDays = [0, 7, 14, 30] as const;
export type ReviewLeadDays = (typeof reviewLeadDays)[number];
export const reviewRecipients = ["owner", "ownerAndAdministrators"] as const;
export type ReviewRecipients = (typeof reviewRecipients)[number];
export const reviewRecipient = pgEnum("review_recipients", reviewRecipients);
export const reviewVia = ["marked", "published"] as const;
export type ReviewVia = (typeof reviewVia)[number];
export const articleReviewVia = pgEnum("article_review_via", reviewVia);

export const knowledgeBases = pgTable(
  "knowledge_bases",
  {
    spaceId: uuid()
      .primaryKey()
      .references(() => spaces.id, { onDelete: "cascade" }),
    contactEmail: text(),
    nextArticleNumber: integer().notNull().default(1),
    reviewIntervalMonths: smallint(),
    reviewLeadDays: smallint().notNull().default(14),
    reviewRecipients: reviewRecipient().notNull().default("owner"),
    ...timestamps(),
  },
  (table) => [
    check("knowledge_bases_contact_length", sql`length(${table.contactEmail}) <= 254`),
    check("knowledge_bases_next_number", sql`${table.nextArticleNumber} >= 1`),
    check("knowledge_bases_review_interval", sql`${table.reviewIntervalMonths} in (3, 6, 12)`),
    check("knowledge_bases_review_lead", sql`${table.reviewLeadDays} in (0, 7, 14, 30)`),
  ],
);

export const knowledgeBaseCategories = pgTable(
  "knowledge_base_categories",
  {
    itemId: uuid()
      .primaryKey()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    icon: text(),
    contactEmail: text(),
    ...timestamps(),
  },
  (table) => [
    check(
      "knowledge_base_categories_icon",
      sql`${table.icon} ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and length(${table.icon}) <= 60`,
    ),
    check("knowledge_base_categories_contact_length", sql`length(${table.contactEmail}) <= 254`),
  ],
);

export const articleNumbers = pgTable(
  "article_numbers",
  {
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    number: integer().notNull(),
    itemId: uuid().references(() => treeItems.id, { onDelete: "set null" }),
    createdAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.spaceId, table.number] }),
    unique("article_numbers_item_unique").on(table.itemId, table.spaceId),
    check("article_numbers_positive", sql`${table.number} >= 1`),
  ],
);

export const articleSlugs = pgTable(
  "article_slugs",
  {
    itemId: uuid()
      .notNull()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    slug: text().notNull(),
    createdAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.itemId, table.slug] })],
);

export const requiredSections = pgTable(
  "knowledge_base_required_sections",
  {
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    templateId: text().notNull(),
    sectionKey: text().notNull(),
    sectionTitle: text().notNull().default(""),
    createdBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ columns: [table.spaceId, table.templateId, table.sectionKey] }),
    index().on(table.createdBy),
    check("knowledge_base_required_sections_key", sql`${table.sectionKey} ~ '^[a-z][a-zA-Z0-9]{0,39}$'`),
  ],
);

export const articleReviews = pgTable(
  "article_reviews",
  {
    itemId: uuid()
      .primaryKey()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    intervalMonths: smallint(),
    publishedAt: timestampColumn(),
    reviewedAt: timestampColumn(),
    reviewedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    dueAt: timestampColumn(),
    leadRemindedAt: timestampColumn(),
    dueRemindedAt: timestampColumn(),
    remindersQueuedAt: timestampColumn(),
    sourceChangedAt: timestampColumn(),
    ...timestamps(),
  },
  (table) => [
    index().on(table.reviewedBy),
    index("article_reviews_due_index").on(table.dueAt).where(sql`${table.dueAt} is not null`),
    index("article_reviews_unqueued_index")
      .on(table.itemId)
      .where(sql`${table.dueAt} is not null and ${table.remindersQueuedAt} is null`),
    check("article_reviews_interval", sql`${table.intervalMonths} in (0, 3, 6, 12)`),
  ],
);

export const articleSources = pgTable(
  "article_sources",
  {
    articleId: uuid()
      .notNull()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    sourceId: uuid()
      .notNull()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    changedAt: timestampColumn(),
    addedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    createdAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.articleId, table.sourceId] }),
    index().on(table.sourceId),
    index().on(table.addedBy),
    check("article_sources_distinct", sql`${table.articleId} <> ${table.sourceId}`),
  ],
);

export const articleReviewEvents = pgTable(
  "article_review_events",
  {
    id: uuid().primaryKey(),
    itemId: uuid()
      .notNull()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    actorId: uuid().references(() => accounts.id, { onDelete: "set null" }),
    via: articleReviewVia().notNull(),
    reviewedAt: timestampColumn().notNull(),
    previousReviewedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    previousState: jsonb().notNull(),
  },
  (table) => [
    index().on(table.itemId, table.reviewedAt),
    index().on(table.actorId),
    index().on(table.previousReviewedBy),
  ],
);
