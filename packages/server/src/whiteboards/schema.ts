import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "../accounts/schema.js";
import { bytes, primaryId, timestamps } from "../database/columns.js";
import { storedFiles } from "../files/schema.js";
import { treeItems, versionReason } from "../spaces/schema.js";

const timestampColumn = () => timestamp({ withTimezone: true, mode: "date" });

export const whiteboardPreviews = pgTable(
  "whiteboard_previews",
  {
    id: primaryId(),
    itemId: uuid()
      .notNull()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    fileId: uuid()
      .notNull()
      .references(() => storedFiles.id, { onDelete: "restrict" }),
    revision: bigint({ mode: "number" }).notNull(),
    createdBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    index().on(table.itemId, table.revision),
    index().on(table.fileId),
    index().on(table.createdBy),
  ],
);

export const whiteboardDocuments = pgTable(
  "whiteboard_documents",
  {
    itemId: uuid()
      .primaryKey()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    state: bytes().notNull(),
    scene: jsonb().notNull(),
    revision: bigint({ mode: "number" }).notNull().default(1),
    versionedRevision: bigint({ mode: "number" }).notNull().default(0),
    previewId: uuid().references((): AnyPgColumn => whiteboardPreviews.id, { onDelete: "set null" }),
    changedAt: timestampColumn().notNull().defaultNow(),
    updatedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [index().on(table.previewId), index().on(table.updatedBy)],
);

export const whiteboardVersions = pgTable(
  "whiteboard_versions",
  {
    id: primaryId(),
    itemId: uuid()
      .notNull()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    number: integer().notNull(),
    title: text().notNull(),
    scene: jsonb().notNull(),
    reason: versionReason().notNull(),
    restoredFrom: integer(),
    copiedFromId: uuid().references(() => treeItems.id, { onDelete: "set null" }),
    copiedFromTitle: text(),
    revision: bigint({ mode: "number" }).notNull(),
    stateVector: bytes().notNull(),
    previewId: uuid().references((): AnyPgColumn => whiteboardPreviews.id, { onDelete: "set null" }),
    contributors: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    createdBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    createdAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("whiteboard_versions_number_unique").on(table.itemId, table.number),
    index().on(table.previewId),
    index().on(table.createdBy),
    index().on(table.copiedFromId),
    check("whiteboard_versions_number_positive", sql`${table.number} > 0`),
  ],
);
