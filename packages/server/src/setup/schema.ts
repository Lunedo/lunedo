import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { bytes, primaryId } from "../database/columns.js";

const timestampColumn = () => timestamp({ withTimezone: true, mode: "date" });

export const setupSteps = pgTable("setup_steps", {
  step: text().primaryKey(),
  state: jsonb().notNull().default({}),
  completedAt: timestampColumn(),
  updatedAt: timestampColumn().notNull().defaultNow(),
});

export const setupSessions = pgTable("setup_sessions", {
  id: primaryId(),
  tokenHash: bytes().notNull().unique(),
  origin: text().notNull(),
  expiresAt: timestampColumn().notNull(),
  createdAt: timestampColumn().notNull().defaultNow(),
});
