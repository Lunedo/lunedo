import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { bytes, primaryId, timestamps } from "../database/columns.js";
import { organizations } from "../organizations/schema.js";

export const accountTypes = ["standard", "guest", "portal", "service"] as const;
export type AccountType = (typeof accountTypes)[number];

export const accountStates = ["invited", "active", "deactivated", "anonymized", "placeholder"] as const;
export type AccountState = (typeof accountStates)[number];

export const accountType = pgEnum("account_type", accountTypes);
export const accountState = pgEnum("account_state", accountStates);

export const accounts = pgTable(
  "accounts",
  {
    id: primaryId(),
    type: accountType().notNull(),
    state: accountState().notNull(),
    email: text(),
    name: text().notNull(),
    passwordHash: text(),
    passwordChangedAt: timestamp({ withTimezone: true, mode: "date" }),
    emailVerifiedAt: timestamp({ withTimezone: true, mode: "date" }),
    homeOrganizationId: uuid().references(() => organizations.id),
    lastActiveAt: timestamp({ withTimezone: true, mode: "date" }),
    inactivityNotifiedAt: timestamp({ withTimezone: true, mode: "date" }),
    secondFactorResetAt: timestamp({ withTimezone: true, mode: "date" }),
    lastSignInAt: timestamp({ withTimezone: true, mode: "date" }),
    mergedIntoId: uuid().references((): AnyPgColumn => accounts.id),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("accounts_email_unique").on(sql`lower(${table.email})`),
    index().on(table.homeOrganizationId),
    index("accounts_name_id_index").on(sql`lower(${table.name})`, table.id),
  ],
);

export const setupCompletedThrough = pgEnum("setup_completed_through", ["assistant", "configuration"]);

export const instance = pgTable(
  "instance",
  {
    id: smallint().primaryKey().default(1),
    ownerAccountId: uuid().references(() => accounts.id),
    setupCompletedAt: timestamp({ withTimezone: true, mode: "date" }),
    setupCompletedThrough: setupCompletedThrough(),
    setupCodeHash: bytes(),
    setupCodeIssuedAt: timestamp({ withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (table) => [check("instance_single_row", sql`${table.id} = 1`), index().on(table.ownerAccountId)],
);
