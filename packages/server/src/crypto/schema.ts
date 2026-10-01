import { index, integer, pgEnum, pgTable, timestamp } from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "../database/columns.js";

export const keyRotationStatus = pgEnum("key_rotation_status", ["running", "completed"]);

/** Re-wrapping of all data keys with a new master key version. */
export const keyRotations = pgTable(
  "key_rotations",
  {
    id: primaryId(),
    targetVersion: integer().notNull(),
    status: keyRotationStatus().notNull().default("running"),
    rewrapped: integer().notNull().default(0),
    completedAt: timestamp({ withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (table) => [index().on(table.targetVersion)],
);
