import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "../accounts/schema.js";
import { bytes, primaryId, timestamps } from "../database/columns.js";
import { discardedDrafts, treeItems } from "../spaces/schema.js";

const timestampColumn = () => timestamp({ withTimezone: true, mode: "date" });

export const storedFileStates = ["pending", "stored", "ready", "orphaned"] as const;
export type StoredFileState = (typeof storedFileStates)[number];
export const storedFileState = pgEnum("stored_file_state", storedFileStates);

export const displayVersionStates = ["pending", "done", "none", "failed"] as const;
export type DisplayVersionState = (typeof displayVersionStates)[number];
export const displayVersionState = pgEnum("display_version_state", displayVersionStates);

export const displayVersionSizes = ["display", "preview"] as const;
export type DisplayVersionSize = (typeof displayVersionSizes)[number];

export const storedFiles = pgTable(
  "stored_files",
  {
    id: primaryId(),
    storageKey: text().notNull(),
    size: bigint({ mode: "number" }).notNull().default(0),
    contentDigest: bytes(),
    contentType: text().notNull().default("application/octet-stream"),
    masterKeyVersion: integer(),
    state: storedFileState().notNull().default("pending"),
    displayVersionState: displayVersionState(),
    displayVersionAttempts: integer().notNull().default(0),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("stored_files_storage_key_unique").on(table.storageKey),
    index("stored_files_display_versions_pending")
      .on(table.id)
      .where(sql`${table.displayVersionState} = 'pending'`),
    index().on(table.state, table.updatedAt),
    index().on(table.masterKeyVersion),
    index().on(table.contentDigest),
  ],
);

export const attachments = pgTable(
  "attachments",
  {
    id: primaryId(),
    itemId: uuid()
      .notNull()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    name: text().notNull(),
    nameKey: text().notNull(),
    currentVersionId: uuid().references((): AnyPgColumn => attachmentVersions.id, { onDelete: "set null" }),
    publishedVersionId: uuid().references((): AnyPgColumn => attachmentVersions.id, { onDelete: "set null" }),
    discardedDraftId: uuid().references(() => discardedDrafts.id, { onDelete: "cascade" }),
    createdBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    deletedAt: timestampColumn(),
    deletedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("attachments_name_unique")
      .on(table.itemId, table.nameKey)
      .where(sql`${table.deletedAt} is null`),
    index().on(table.itemId),
    index().on(table.currentVersionId),
    index().on(table.publishedVersionId),
    index().on(table.discardedDraftId),
    index().on(table.createdBy),
    index().on(table.deletedBy),
    check("attachments_name_length", sql`length(${table.name}) between 1 and 255`),
  ],
);

export const attachmentVersions = pgTable(
  "attachment_versions",
  {
    id: primaryId(),
    attachmentId: uuid()
      .notNull()
      .references((): AnyPgColumn => attachments.id, { onDelete: "cascade" }),
    number: integer().notNull(),
    fileId: uuid()
      .notNull()
      .references(() => storedFiles.id),
    name: text().notNull(),
    restoredFrom: integer(),
    kept: boolean().notNull().default(false),
    publishedAt: timestampColumn(),
    uploadedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("attachment_versions_number_unique").on(table.attachmentId, table.number),
    index().on(table.fileId),
    index().on(table.uploadedBy),
  ],
);

export const displayVersions = pgTable(
  "display_versions",
  {
    sourceFileId: uuid()
      .notNull()
      .references(() => storedFiles.id, { onDelete: "cascade" }),
    size: text({ enum: displayVersionSizes }).notNull(),
    fileId: uuid()
      .notNull()
      .references(() => storedFiles.id),
    width: integer().notNull(),
    height: integer().notNull(),
    createdAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.sourceFileId, table.size] }),
    uniqueIndex("display_versions_file_unique").on(table.fileId),
    check("display_versions_size", sql`${table.size} in ('display', 'preview')`),
  ],
);
