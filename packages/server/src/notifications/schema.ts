import { watchStates } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
import { bytes, primaryId, timestamps } from "../database/columns.js";
import { organizations } from "../organizations/schema.js";
import { spaces, treeItems } from "../spaces/schema.js";

const timestampColumn = () => timestamp({ withTimezone: true, mode: "date" });

export const notificationEmailStatus = pgEnum("notification_email_status", [
  "immediate",
  "digest",
  "sent",
  "skipped",
]);

export const notifications = pgTable(
  "notifications",
  {
    id: primaryId(),
    recipientId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    organizationId: uuid().references(() => organizations.id, { onDelete: "cascade" }),
    type: text().notNull(),
    targetType: text().notNull(),
    targetId: text(),
    actorType: text(),
    actorId: uuid(),
    actorIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    params: jsonb().notNull(),
    groupKey: text().notNull(),
    count: integer().notNull().default(1),
    createdAt: timestampColumn().notNull().defaultNow(),
    updatedAt: timestampColumn().notNull().defaultNow(),
    readAt: timestampColumn(),
    inApp: boolean().notNull().default(true),
    emailStatus: notificationEmailStatus(),
    emailPendingSince: timestampColumn(),
  },
  (table) => [
    index().on(table.recipientId, table.updatedAt, table.id),
    index("notifications_email_pending_index")
      .on(table.recipientId, table.emailPendingSince)
      .where(sql`${table.emailStatus} in ('immediate', 'digest')`),
    index("notifications_unread_group_index")
      .on(table.recipientId, table.groupKey, table.updatedAt)
      .where(sql`${table.readAt} is null`),
    index().on(table.updatedAt),
  ],
);

export const knownDevices = pgTable(
  "known_devices",
  {
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    deviceHash: bytes().notNull(),
    firstSeenAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.deviceHash] })],
);

export const watchState = pgEnum("watch_state", watchStates);

export const watches = pgTable(
  "watches",
  {
    id: primaryId(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    spaceId: uuid().references(() => spaces.id, { onDelete: "cascade" }),
    itemId: uuid().references(() => treeItems.id, { onDelete: "cascade" }),
    state: watchState().notNull(),
    keepActionable: boolean().notNull().default(true),
    automatic: boolean().notNull().default(false),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("watches_account_space_index")
      .on(table.accountId, table.spaceId)
      .where(sql`${table.itemId} is null`),
    uniqueIndex("watches_account_item_index")
      .on(table.accountId, table.itemId)
      .where(sql`${table.itemId} is not null`),
    index().on(table.spaceId, table.state),
    index().on(table.itemId, table.state),
    check("watches_one_target", sql`(${table.spaceId} is null) <> (${table.itemId} is null)`),
  ],
);
