import { index, integer, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { encrypted } from "../crypto/encrypted-column.js";
import { primaryId, timestamps } from "../database/columns.js";

export const mailStatus = pgEnum("mail_status", ["pending", "failed"]);

/**
 * E-mails waiting for delivery. A mail is written in the transaction of the change that causes
 * it and delivered by a job; delivered mails are deleted. The message is encrypted because it can
 * contain links with single-use tokens.
 */
export const mailOutbox = pgTable(
  "mail_outbox",
  {
    id: primaryId(),
    /** Template name, for logs and metrics. */
    template: text().notNull(),
    /** Null once delivery failed for good. */
    message: encrypted(),
    status: mailStatus().notNull().default("pending"),
    attempts: integer().notNull().default(0),
    ...timestamps(),
  },
  (table) => [index().on(table.status, table.createdAt)],
);

/** Instance-wide secrets such as the SMTP password, with envelope encryption. */
export const instanceSecrets = pgTable("instance_secrets", {
  name: text().primaryKey(),
  value: encrypted().notNull(),
  updatedAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
});
