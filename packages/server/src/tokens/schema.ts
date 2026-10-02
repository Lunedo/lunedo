import { index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { accounts } from "../accounts/schema.js";
import { bytes, primaryId, timestamps } from "../database/columns.js";
import { organizations } from "../organizations/schema.js";

const timestampColumn = () => timestamp({ withTimezone: true, mode: "date" });

export const serviceAccounts = pgTable(
  "service_accounts",
  {
    accountId: uuid()
      .primaryKey()
      .references(() => accounts.id, { onDelete: "cascade" }),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    description: text().notNull().default(""),
    unattendedNotifiedAt: timestampColumn(),
    createdBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [index().on(table.organizationId)],
);

export const serviceAccountResponsibles = pgTable(
  "service_account_responsibles",
  {
    serviceAccountId: uuid()
      .notNull()
      .references(() => serviceAccounts.accountId, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    createdAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.serviceAccountId, table.accountId] }),
    index().on(table.accountId),
  ],
);

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: primaryId(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    organizationId: uuid().references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    tokenHash: bytes().notNull(),
    tokenPrefix: text().notNull(),
    scopes: jsonb().notNull(),
    expiresAt: timestampColumn(),
    createdBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    lastUsedAt: timestampColumn(),
    lastUsedIp: text(),
    revokedAt: timestampColumn(),
    expiryRemindedAt: timestampColumn(),
    unusedNoticedAt: timestampColumn(),
    expiryRecordedAt: timestampColumn(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex().on(table.tokenHash),
    index().on(table.accountId, table.id),
    index().on(table.organizationId, table.id),
  ],
);
