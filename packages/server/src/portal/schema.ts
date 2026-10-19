import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sessions } from "../auth/schema.js";
import { bytes, primaryId } from "../database/columns.js";
import { portalDomains } from "../knowledge-bases/schema.js";
import { pageVersions, spaces, treeItems } from "../spaces/schema.js";

const timestampColumn = () => timestamp({ withTimezone: true, mode: "date" });

export const portalSessions = pgTable(
  "portal_sessions",
  {
    id: primaryId(),
    tokenHash: bytes().notNull().unique(),
    sessionId: uuid()
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    domain: text()
      .notNull()
      .references(() => portalDomains.domain, { onDelete: "cascade", onUpdate: "cascade" }),
    createdAt: timestampColumn().notNull().defaultNow(),
    lastUsedAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [index().on(table.sessionId), index().on(table.domain)],
);

export const portalHandoffs = pgTable(
  "portal_handoffs",
  {
    codeHash: bytes().primaryKey(),
    stateHash: bytes().notNull(),
    domain: text()
      .notNull()
      .references(() => portalDomains.domain, { onDelete: "cascade", onUpdate: "cascade" }),
    sessionId: uuid()
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    expiresAt: timestampColumn().notNull(),
    consumedAt: timestampColumn(),
  },
  (table) => [index().on(table.sessionId), index().on(table.domain), index().on(table.expiresAt)],
);

export interface RenderedHeading {
  id: string;
  title: string;
  level: number;
}

export const articleRenders = pgTable(
  "article_renders",
  {
    versionId: uuid()
      .notNull()
      .references(() => pageVersions.id, { onDelete: "cascade" }),
    language: text().notNull(),
    renderer: integer().notNull(),
    html: text().notNull(),
    headings: jsonb().$type<RenderedHeading[]>().notNull(),
    createdAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.versionId, table.language] })],
);

export const portalSearches = pgTable(
  "portal_searches",
  {
    id: primaryId(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    term: text().notNull(),
    results: integer().notNull(),
    categoryId: uuid().references(() => treeItems.id, { onDelete: "set null" }),
    zeroResults: boolean().notNull().generatedAlwaysAs(sql`results = 0`),
    searchedAt: timestampColumn().notNull(),
  },
  (table) => [
    index().on(table.spaceId, table.searchedAt),
    index().on(table.categoryId),
    check("portal_searches_term", sql`length(${table.term}) between 1 and 200`),
    check("portal_searches_results", sql`${table.results} >= 0`),
    check("portal_searches_hour", sql`${table.searchedAt} = date_trunc('hour', ${table.searchedAt})`),
  ],
);

export const portalSearchMonths = pgTable(
  "portal_search_months",
  {
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    term: text().notNull(),
    month: date({ mode: "string" }).notNull(),
    searches: integer().notNull(),
    zeroResults: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.spaceId, table.month, table.term] }),
    check("portal_search_months_term", sql`length(${table.term}) between 1 and 200`),
    check("portal_search_months_month", sql`${table.month} = date_trunc('month', ${table.month})`),
    check(
      "portal_search_months_counts",
      sql`${table.searches} > 0 and ${table.zeroResults} between 0 and ${table.searches}`,
    ),
  ],
);

export const portalArticleViews = pgTable(
  "portal_article_views",
  {
    itemId: uuid()
      .notNull()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    day: date({ mode: "string" }).notNull(),
    views: integer().notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.itemId, table.day] }),
    index().on(table.spaceId, table.day),
    check("portal_article_views_positive", sql`${table.views} >= 0`),
  ],
);

export const portalRatings = pgTable(
  "portal_ratings",
  {
    itemId: uuid()
      .notNull()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    day: date({ mode: "string" }).notNull(),
    helpful: integer().notNull().default(0),
    unhelpful: integer().notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.itemId, table.day] }),
    index().on(table.spaceId, table.day),
    check("portal_ratings_positive", sql`${table.helpful} >= 0 and ${table.unhelpful} >= 0`),
  ],
);

export const portalFeedback = pgTable(
  "portal_feedback",
  {
    id: primaryId(),
    itemId: uuid()
      .notNull()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    day: date({ mode: "string" }).notNull(),
    text: text().notNull(),
  },
  (table) => [
    index().on(table.spaceId, table.day),
    index().on(table.itemId),
    check("portal_feedback_text", sql`length(${table.text}) between 1 and 2000`),
  ],
);
