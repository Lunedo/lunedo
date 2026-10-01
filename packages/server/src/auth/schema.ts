import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "../accounts/schema.js";
import { signInMethods } from "../audit/catalog.js";
import { encrypted } from "../crypto/encrypted-column.js";
import { bytes, primaryId, timestamps } from "../database/columns.js";

const timestampColumn = () => timestamp({ withTimezone: true, mode: "date" });

export const signInMethod = pgEnum("sign_in_method", signInMethods);

export const sessionKind = pgEnum("session_kind", ["full", "secondFactorSetup"]);

export const sessions = pgTable(
  "sessions",
  {
    id: primaryId(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    tokenHash: bytes().notNull(),
    kind: sessionKind().notNull(),
    deviceHash: bytes(),
    methods: signInMethod().array().notNull(),
    clientIp: text(),
    browser: text(),
    operatingSystem: text(),
    createdAt: timestampColumn().notNull().defaultNow(),
    lastUsedAt: timestampColumn().notNull().defaultNow(),
    reauthenticatedAt: timestampColumn(),
  },
  (table) => [
    uniqueIndex().on(table.tokenHash),
    index().on(table.accountId, table.lastUsedAt),
    index().on(table.deviceHash),
  ],
);

export const challengePurpose = pgEnum("challenge_purpose", [
  "secondFactor",
  "passkeySignIn",
  "passkeyRegistration",
  "reauthentication",
]);

export const authChallenges = pgTable(
  "auth_challenges",
  {
    id: primaryId(),
    purpose: challengePurpose().notNull(),
    tokenHash: bytes(),
    accountId: uuid().references(() => accounts.id, { onDelete: "cascade" }),
    sessionId: uuid().references(() => sessions.id, { onDelete: "cascade" }),
    challenge: text(),
    methods: signInMethod().array().notNull().default(sql`'{}'`),
    failedAttempts: integer().notNull().default(0),
    deviceHash: bytes(),
    expiresAt: timestampColumn().notNull(),
    createdAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [uniqueIndex().on(table.tokenHash), index().on(table.expiresAt), index().on(table.sessionId)],
);

export const accountTokenPurpose = pgEnum("account_token_purpose", ["passwordReset", "emailChange"]);

export const accountTokens = pgTable(
  "account_tokens",
  {
    id: primaryId(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    purpose: accountTokenPurpose().notNull(),
    tokenHash: bytes().notNull(),
    newEmail: text(),
    expiresAt: timestampColumn().notNull(),
    usedAt: timestampColumn(),
    createdAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [uniqueIndex().on(table.tokenHash), index().on(table.accountId, table.purpose)],
);

export const totpCredentials = pgTable(
  "totp_credentials",
  {
    id: primaryId(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    secret: encrypted().notNull(),
    confirmedAt: timestampColumn(),
    lastUsedStep: bigint({ mode: "number" }),
    ...timestamps(),
  },
  (table) => [uniqueIndex().on(table.accountId)],
);

export const webauthnCredentials = pgTable(
  "webauthn_credentials",
  {
    id: primaryId(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    credentialId: text().notNull(),
    publicKey: bytes().notNull(),
    signCount: bigint({ mode: "number" }).notNull(),
    transports: text().array().notNull().default(sql`'{}'`),
    deviceType: text().notNull(),
    backedUp: boolean().notNull(),
    name: text().notNull(),
    lastUsedAt: timestampColumn(),
    ...timestamps(),
  },
  (table) => [uniqueIndex().on(table.credentialId), index().on(table.accountId)],
);

export const recoveryCodes = pgTable(
  "recovery_codes",
  {
    id: primaryId(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    codeHash: bytes().notNull(),
    usedAt: timestampColumn(),
    createdAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [uniqueIndex().on(table.accountId, table.codeHash)],
);

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text().primaryKey(),
    windowStart: timestampColumn().notNull(),
    count: integer().notNull(),
  },
  (table) => [index().on(table.windowStart)],
);

export const signInFailures = pgTable(
  "sign_in_failures",
  {
    key: text().primaryKey(),
    failures: integer().notNull().default(0),
    firstFailureAt: timestampColumn(),
    lockedUntil: timestampColumn(),
    lockouts: integer().notNull().default(0),
    lastLockoutAt: timestampColumn(),
    updatedAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [index().on(table.updatedAt)],
);
