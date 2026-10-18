import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
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
    reconcileRun: uuid(),
    reconcilePages: integer().notNull().default(0),
    reconcileFetching: boolean().notNull().default(false),
    reconcileDone: boolean().notNull().default(false),
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

export const storageReconcileDeltas = pgTable(
  "storage_reconcile_deltas",
  {
    id: uuid().primaryKey(),
    run: uuid().notNull(),
    key: text().notNull(),
    delta: bigint({ mode: "number" }).notNull(),
    pages: integer().notNull(),
    fetching: boolean().notNull(),
    done: boolean().notNull(),
    createdAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [index().on(table.run)],
);
