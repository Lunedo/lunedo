import { sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, smallint, text, timestamp } from "drizzle-orm/pg-core";
import { encrypted } from "../crypto/encrypted-column.js";
import { primaryId, timestamps } from "../database/columns.js";

export const mailStatus = pgEnum("mail_status", ["pending", "sending", "failed"]);

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

export const mailCredentialKind = pgEnum("mail_credential_kind", ["clientSecret", "certificate"]);

export const mailCredentials = pgTable(
  "mail_credentials",
  {
    id: primaryId(),
    kind: mailCredentialKind().notNull(),
    secret: encrypted().notNull(),
    certificate: text(),
    keyId: text(),
    expiresAt: timestamp({ withTimezone: true, mode: "date" }),
    notifiedThirtyDaysAt: timestamp({ withTimezone: true, mode: "date" }),
    notifiedSevenDaysAt: timestamp({ withTimezone: true, mode: "date" }),
    createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [index().on(table.expiresAt)],
);

export const mailDeliveryStatus = pgTable(
  "mail_delivery_status",
  {
    id: smallint().primaryKey().default(1),
    lastSuccessAt: timestamp({ withTimezone: true, mode: "date" }),
    lastFailureAt: timestamp({ withTimezone: true, mode: "date" }),
    lastFailureCode: text(),
    lastFailureResponseCode: integer(),
    lastFailureStep: text(),
  },
  (table) => [check("mail_delivery_status_single_row", sql`${table.id} = 1`)],
);
