import { sql } from "drizzle-orm";
import { check, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

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
