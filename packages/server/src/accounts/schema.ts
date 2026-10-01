import { sql } from "drizzle-orm";
import {
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

/** Account types (ADR 0015). */
export const accountTypes = ["standard", "guest", "portal", "service"] as const;
export type AccountType = (typeof accountTypes)[number];

/** Account states (ADR 0015). Accounts are deactivated or anonymized, never deleted. */
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
    /** Stored as entered. Unique regardless of case; null for anonymized and service accounts. */
    email: text(),
    name: text().notNull(),
    /** Argon2id hash in PHC format, with its parameters. */
    passwordHash: text(),
    passwordChangedAt: timestamp({ withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (table) => [uniqueIndex("accounts_email_unique").on(sql`lower(${table.email})`)],
);

export const setupCompletedThrough = pgEnum("setup_completed_through", ["assistant", "configuration"]);

/** The single row describing this instance: its owner and the state of the first-start setup. */
export const instance = pgTable(
  "instance",
  {
    id: smallint().primaryKey().default(1),
    ownerAccountId: uuid().references(() => accounts.id),
    setupCompletedAt: timestamp({ withTimezone: true, mode: "date" }),
    setupCompletedThrough: setupCompletedThrough(),
    /** SHA-256 of the current one-time setup code. */
    setupCodeHash: bytes(),
    setupCodeIssuedAt: timestamp({ withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (table) => [check("instance_single_row", sql`${table.id} = 1`), index().on(table.ownerAccountId)],
);
