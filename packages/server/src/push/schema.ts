import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { accounts } from "../accounts/schema.js";
import { sessions } from "../auth/schema.js";
import { encrypted } from "../crypto/encrypted-column.js";
import { bytes, primaryId, timestamps } from "../database/columns.js";
import { organizations } from "../organizations/schema.js";

const timestampColumn = () => timestamp({ withTimezone: true, mode: "date" });

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: primaryId(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    sessionId: uuid()
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    endpointHash: bytes().notNull().unique(),
    subscription: encrypted().notNull(),
    browser: text(),
    operatingSystem: text(),
    lastDeliveredAt: timestampColumn(),
    ...timestamps(),
  },
  (table) => [index().on(table.accountId), index().on(table.sessionId)],
);

export const pushOutbox = pgTable(
  "push_outbox",
  {
    id: primaryId(),
    recipientId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    organizationId: uuid().references(() => organizations.id, { onDelete: "cascade" }),
    type: text().notNull(),
    targetId: text(),
    actorId: uuid(),
    actorCount: integer().notNull().default(0),
    params: jsonb().notNull(),
    queuedAt: timestampColumn(),
    createdAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [index().on(table.recipientId), index().on(table.organizationId), index().on(table.queuedAt)],
);
