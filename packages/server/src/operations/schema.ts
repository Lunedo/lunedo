import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "../accounts/schema.js";

const timestampColumn = () => timestamp({ withTimezone: true, mode: "date" });

export const operationsErrorEvents = pgTable(
  "operations_error_events",
  {
    hour: timestampColumn().notNull(),
    service: text().notNull(),
    type: text().notNull(),
    code: text().notNull().default(""),
    count: integer().notNull(),
    lastAt: timestampColumn().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.hour, table.service, table.type, table.code] }),
    check("operations_error_events_count", sql`${table.count} > 0`),
  ],
);

export const maintenanceState = pgTable(
  "maintenance_state",
  {
    singleton: boolean().primaryKey().default(true),
    enabled: boolean().notNull().default(false),
    message: text().notNull().default(""),
    blockSignIn: boolean().notNull().default(false),
    changedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    changedAt: timestampColumn(),
    startedAt: timestampColumn(),
    lastStartedAt: timestampColumn(),
    lastEndedAt: timestampColumn(),
  },
  (table) => [
    check("maintenance_state_singleton", sql`${table.singleton}`),
    check("maintenance_state_message", sql`char_length(${table.message}) <= 500`),
  ],
);

export const updateCheckState = pgTable(
  "update_check_state",
  {
    singleton: boolean().primaryKey().default(true),
    checkedAt: timestampColumn(),
    succeeded: boolean().notNull().default(false),
    failure: text(),
    releases: jsonb().notNull().default([]),
    notifiedVersion: text(),
  },
  (table) => [check("update_check_state_singleton", sql`${table.singleton}`)],
);
