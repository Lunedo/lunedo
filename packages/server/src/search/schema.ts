import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "../accounts/schema.js";
import { primaryId, timestamps } from "../database/columns.js";
import { storedFiles } from "../files/schema.js";
import { organizations } from "../organizations/schema.js";
import { spaces, treeItems } from "../spaces/schema.js";

const timestampColumn = () => timestamp({ withTimezone: true, mode: "date" });
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

export const searchSources = ["item", "comment", "attachment", "decision"] as const;
export type SearchSource = (typeof searchSources)[number];
export const searchSource = pgEnum("search_source", searchSources);

export const searchChunks = pgTable(
  "search_chunks",
  {
    id: primaryId(),
    organizationId: uuid().references(() => organizations.id, { onDelete: "cascade" }),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    itemId: uuid()
      .notNull()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    source: searchSource().notNull(),
    sourceId: uuid().notNull(),
    position: integer().notNull(),
    contentType: text().notNull(),
    title: text().notNull(),
    heading: text().notNull().default(""),
    anchor: text(),
    body: text().notNull(),
    labels: text().array().notNull().default(sql`'{}'::text[]`),
    status: text(),
    language: text().notNull(),
    config: text().notNull(),
    authorId: uuid().references(() => accounts.id, { onDelete: "set null" }),
    contentCreatedAt: timestampColumn().notNull(),
    contentUpdatedAt: timestampColumn().notNull(),
    archived: boolean().notNull().default(false),
    readers: text().array().notNull(),
    restrictions: uuid().array().notNull(),
    contextItemId: uuid().references(() => treeItems.id, { onDelete: "cascade" }),
    contextReaders: text().array(),
    contextRestrictions: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    attachment: jsonb(),
    document: tsvector().notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("search_chunks_source_unique").on(table.source, table.sourceId, table.position),
    index().on(table.itemId),
    index().on(table.spaceId),
    index().on(table.authorId),
    index().on(table.contextItemId),
    index("search_chunks_organization_config_index").on(table.organizationId, table.config),
    index("search_chunks_organization_updated_index").on(table.organizationId, table.contentUpdatedAt),
    index("search_chunks_updated_index").on(table.contentUpdatedAt, table.id),
    index("search_chunks_document_index").using("gin", table.document),
    index("search_chunks_readers_index").using("gin", table.readers),
    index("search_chunks_labels_index").using("gin", table.labels),
    check("search_chunks_position", sql`${table.position} >= 0`),
  ],
);

export const searchFileTextStates = ["extracted", "skipped"] as const;
export type SearchFileTextState = (typeof searchFileTextStates)[number];
export const searchFileTextState = pgEnum("search_file_text_state", searchFileTextStates);

export const searchFileTexts = pgTable(
  "search_file_texts",
  {
    fileId: uuid()
      .primaryKey()
      .references(() => storedFiles.id, { onDelete: "cascade" }),
    extractorVersion: integer().notNull(),
    state: searchFileTextState().notNull(),
    reason: text(),
    truncated: boolean().notNull().default(false),
    sections: jsonb().notNull().default(sql`'[]'::jsonb`),
    ...timestamps(),
  },
  (table) => [
    check("search_file_texts_reason", sql`(${table.state} = 'skipped') = (${table.reason} is not null)`),
  ],
);

export const searchTerms = pgTable(
  "search_terms",
  {
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    word: text().notNull(),
    ...timestamps(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.word] })],
);

export const searchItemTerms = pgTable(
  "search_item_terms",
  {
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    word: text().notNull(),
    itemId: uuid()
      .notNull()
      .references(() => treeItems.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.word, table.itemId] }),
    index().on(table.itemId),
  ],
);

export const searchPendingItems = pgTable(
  "search_pending_items",
  {
    itemId: uuid().primaryKey(),
    generation: bigint({ mode: "number" }).notNull().default(1),
    dueAt: timestampColumn().notNull().defaultNow(),
    attempts: integer().notNull().default(0),
    ...timestamps(),
  },
  (table) => [index().on(table.dueAt)],
);

export const searchPendingSpaces = pgTable("search_pending_spaces", {
  spaceId: uuid().primaryKey(),
  generation: bigint({ mode: "number" }).notNull().default(1),
  ...timestamps(),
});

export const recentSearches = pgTable(
  "recent_searches",
  {
    id: primaryId(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    query: text().notNull(),
    filters: jsonb().notNull(),
    fingerprint: text().notNull(),
    searchedAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex().on(table.organizationId, table.accountId, table.fingerprint),
    index().on(table.organizationId, table.accountId, table.searchedAt),
    index().on(table.accountId),
  ],
);

export const savedSearches = pgTable(
  "saved_searches",
  {
    id: primaryId(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    name: text().notNull(),
    query: text().notNull(),
    filters: jsonb().notNull(),
    ...timestamps(),
  },
  (table) => [index().on(table.organizationId, table.accountId), index().on(table.accountId)],
);

export const searchIndexState = pgTable(
  "search_index_state",
  {
    id: integer().primaryKey().default(1),
    buildingSince: timestampColumn(),
    buildTotal: integer().notNull().default(0),
    ...timestamps(),
  },
  (table) => [check("search_index_state_single_row", sql`${table.id} = 1`)],
);
