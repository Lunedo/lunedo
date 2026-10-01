import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    responsibleAccountId: uuid().references(() => accounts.id, { onDelete: "set null" }),
    createdBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [index().on(table.organizationId), index().on(table.responsibleAccountId)],
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
    expiryRecordedAt: timestampColumn(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex().on(table.tokenHash),
    index().on(table.accountId),
    index().on(table.organizationId),
  ],
);
