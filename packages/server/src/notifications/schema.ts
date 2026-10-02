import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { accounts } from "../accounts/schema.js";
import { bytes, primaryId } from "../database/columns.js";
import { organizations } from "../organizations/schema.js";

const timestampColumn = () => timestamp({ withTimezone: true, mode: "date" });

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
    params: jsonb().notNull(),
    groupKey: text().notNull(),
    count: integer().notNull().default(1),
    createdAt: timestampColumn().notNull().defaultNow(),
    updatedAt: timestampColumn().notNull().defaultNow(),
    readAt: timestampColumn(),
  },
  (table) => [
    index().on(table.recipientId, table.updatedAt, table.id),
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
