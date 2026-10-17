import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { accounts } from "../accounts/schema.js";
import { primaryId, timestamps } from "../database/columns.js";
import { organizations } from "../organizations/schema.js";
import { spaces, treeItems } from "../spaces/schema.js";

const timestampColumn = () => timestamp({ withTimezone: true, mode: "date" });

export const copyStates = ["queued", "running", "done", "failed"] as const;
export type CopyState = (typeof copyStates)[number];
export const copyState = pgEnum("copy_state", copyStates);

export const itemCopies = pgTable(
  "item_copies",
  {
    id: primaryId(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    organizationId: uuid().references(() => organizations.id, { onDelete: "set null" }),
    sourceItemId: uuid().references(() => treeItems.id, { onDelete: "set null" }),
    targetSpaceId: uuid().references(() => spaces.id, { onDelete: "set null" }),
    targetParentId: uuid().references(() => treeItems.id, { onDelete: "set null" }),
    placement: jsonb().notNull().default({}),
    descendants: boolean().notNull(),
    title: text().notNull(),
    state: copyState().notNull().default("queued"),
    access: text().notNull().default(""),
    widerAccess: boolean().notNull().default(false),
    jobId: uuid(),
    total: integer().notNull().default(0),
    copied: integer().notNull().default(0),
    hidden: integer().notNull().default(0),
    skipped: integer().notNull().default(0),
    rootCopyId: uuid().references(() => treeItems.id, { onDelete: "set null" }),
    errorCode: text(),
    finishedAt: timestampColumn(),
    ...timestamps(),
  },
  (table) => [
    index().on(table.accountId, table.createdAt),
    index().on(table.finishedAt),
    index().on(table.organizationId),
    index().on(table.sourceItemId),
    index().on(table.targetSpaceId),
    index().on(table.targetParentId),
    index().on(table.rootCopyId),
    index("item_copies_open_index").on(table.createdAt).where(sql`${table.state} in ('queued', 'running')`),
  ],
);
