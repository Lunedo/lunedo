import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { bytes, primaryId } from "../database/columns.js";

const timestampColumn = () => timestamp({ withTimezone: true, mode: "date" });

/** Progress of the setup assistant, one row per completed or started step. */
export const setupSteps = pgTable("setup_steps", {
  step: text().primaryKey(),
  /** Step-specific state, for example when the key backup was downloaded. Never holds secrets. */
  state: jsonb().notNull().default({}),
  completedAt: timestampColumn(),
  updatedAt: timestampColumn().notNull().defaultNow(),
});

/** Sessions of the setup assistant, created in exchange for the setup code. */
export const setupSessions = pgTable("setup_sessions", {
  id: primaryId(),
  tokenHash: bytes().notNull().unique(),
  expiresAt: timestampColumn().notNull(),
  createdAt: timestampColumn().notNull().defaultNow(),
});
