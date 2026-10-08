import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "../accounts/schema.js";
import { bytes, primaryId, timestamps } from "../database/columns.js";
import { treeItems } from "../spaces/schema.js";

const timestampColumn = () => timestamp({ withTimezone: true, mode: "date" });

export const storedFileStates = ["pending", "ready", "orphaned"] as const;
export type StoredFileState = (typeof storedFileStates)[number];
export const storedFileState = pgEnum("stored_file_state", storedFileStates);

export const storedFiles = pgTable(
  "stored_files",
  {
    id: primaryId(),
    storageKey: text().notNull(),
    size: bigint({ mode: "number" }).notNull().default(0),
    sha256: bytes(),
    contentType: text().notNull().default("application/octet-stream"),
    masterKeyVersion: integer(),
    state: storedFileState().notNull().default("pending"),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("stored_files_storage_key_unique").on(table.storageKey),
    index().on(table.state, table.updatedAt),
    index().on(table.masterKeyVersion),
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
    uploadedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("attachment_versions_number_unique").on(table.attachmentId, table.number),
    index().on(table.fileId),
    index().on(table.uploadedBy),
  ],
);
