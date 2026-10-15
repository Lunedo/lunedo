import { sql } from "drizzle-orm";
import { bigint, boolean, check, pgTable, smallint, timestamp } from "drizzle-orm/pg-core";
import { timestamps } from "../database/columns.js";

const timestampColumn = () => timestamp({ withTimezone: true, mode: "date" });

export const storageState = pgTable(
  "storage_state",
  {
    singleton: boolean().primaryKey().default(true),
    usedBytes: bigint({ mode: "number" }).notNull().default(0),
    reconciledAt: timestampColumn(),
    activeLevel: smallint().notNull().default(0),
    reachedLevel: smallint().notNull().default(0),
    notifiedAt: timestampColumn(),
    checkedAt: timestampColumn(),
    ...timestamps(),
  },
  (table) => [
    check("storage_state_singleton", sql`${table.singleton}`),
    check(
      "storage_state_levels",
      sql`${table.activeLevel} between 0 and 3 and ${table.reachedLevel} between 0 and 3`,
    ),
    check("storage_state_used", sql`${table.usedBytes} >= 0`),
  ],
);
