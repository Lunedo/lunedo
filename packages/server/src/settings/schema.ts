import { boolean, index, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "../database/columns.js";

export const settingLevels = ["instance", "organization", "space", "user"] as const;

export const settingLevel = pgEnum("setting_level", settingLevels);

/** One row per setting and scope. `value` is null when the scope only locks the inherited value. */
export const settingValues = pgTable(
  "setting_values",
  {
    id: primaryId(),
    level: settingLevel().notNull(),
    scopeId: uuid().notNull(),
    key: text().notNull(),
    value: jsonb(),
    locked: boolean().notNull().default(false),
    ...timestamps(),
  },
  (table) => [uniqueIndex().on(table.level, table.scopeId, table.key), index().on(table.key)],
);
