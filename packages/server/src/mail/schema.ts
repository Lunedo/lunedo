import { index, integer, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { encrypted } from "../crypto/encrypted-column.js";
import { primaryId, timestamps } from "../database/columns.js";

export const mailStatus = pgEnum("mail_status", ["pending", "failed"]);

export const mailOutbox = pgTable(
  "mail_outbox",
  {
    id: primaryId(),
    template: text().notNull(),
    message: encrypted(),
    status: mailStatus().notNull().default("pending"),
    attempts: integer().notNull().default(0),
    ...timestamps(),
  },
  (table) => [index().on(table.status, table.createdAt)],
);

export const instanceSecrets = pgTable("instance_secrets", {
  name: text().primaryKey(),
  value: encrypted().notNull(),
  updatedAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
});
