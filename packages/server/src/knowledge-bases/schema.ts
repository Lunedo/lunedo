import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "../accounts/schema.js";
import { bytes, timestamps } from "../database/columns.js";
import { organizations } from "../organizations/schema.js";
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
    portalPath: text().notNull(),
    portalDomain: text().references(() => portalDomains.domain, { onDelete: "set null" }),
    brandColor: text().notNull().default("petrol"),
    brandLight: text(),
    brandDark: text(),
    welcomeHeading: text().notNull().default(""),
    welcomeText: text().notNull().default(""),
    topBarThreshold: integer().notNull().default(10),
    poweredBy: boolean().notNull().default(true),
    feedbackRetentionMonths: integer().notNull().default(12),
    logoRef: text(),
    ...timestamps(),
  },
  (table) => [
    check("knowledge_bases_contact_length", sql`length(${table.contactEmail}) <= 254`),
    check("knowledge_bases_next_number", sql`${table.nextArticleNumber} >= 1`),
    uniqueIndex("knowledge_bases_portal_path_unique").on(table.portalPath),
    uniqueIndex("knowledge_bases_portal_domain_unique").on(table.portalDomain),
    check(
      "knowledge_bases_portal_path",
      sql`${table.portalPath} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(${table.portalPath}) <= 60`,
    ),
    check(
      "knowledge_bases_brand",
      sql`(${table.brandColor} = 'custom') = (${table.brandLight} is not null and ${table.brandDark} is not null)
        and (${table.brandLight} is null or ${table.brandLight} ~ '^#[0-9A-F]{6}$')
        and (${table.brandDark} is null or ${table.brandDark} ~ '^#[0-9A-F]{6}$')`,
    ),
    check(
      "knowledge_bases_welcome_length",
      sql`length(${table.welcomeHeading}) <= 120 and length(${table.welcomeText}) <= 400`,
    ),
    check("knowledge_bases_top_bar_threshold", sql`${table.topBarThreshold} between 1 and 100`),
    check("knowledge_bases_feedback_retention", sql`${table.feedbackRetentionMonths} between 1 and 60`),
  ],
);

export const portalDomains = pgTable(
  "portal_domains",
  {
    domain: text().primaryKey(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    createdBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    createdAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [
    index().on(table.organizationId),
    index().on(table.createdBy),
    check(
      "portal_domains_domain",
      sql`${table.domain} ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z]{2,63}$' and length(${table.domain}) <= 253`,
    ),
  ],
);

export const knowledgeBasePaths = pgTable(
  "knowledge_base_paths",
  {
    path: text().primaryKey(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    createdAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [index().on(table.spaceId)],
);

export const knowledgeBaseLogos = pgTable("knowledge_base_logos", {
  spaceId: uuid()
    .primaryKey()
    .references(() => spaces.id, { onDelete: "cascade" }),
  contentType: text().notNull(),
  data: bytes().notNull(),
  ref: text().notNull(),
  ...timestamps(),
});

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
