import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "../accounts/schema.js";
import { timestamps } from "../database/columns.js";
import { spaces, treeItems } from "../spaces/schema.js";

const timestampColumn = () => timestamp({ withTimezone: true, mode: "date" });

export const knowledgeBases = pgTable(
  "knowledge_bases",
  {
    spaceId: uuid()
      .primaryKey()
      .references(() => spaces.id, { onDelete: "cascade" }),
    contactEmail: text(),
    nextArticleNumber: integer().notNull().default(1),
    ...timestamps(),
  },
  (table) => [
    check("knowledge_bases_contact_length", sql`length(${table.contactEmail}) <= 254`),
    check("knowledge_bases_next_number", sql`${table.nextArticleNumber} >= 1`),
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
