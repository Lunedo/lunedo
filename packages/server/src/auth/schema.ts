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

/**
 * `full` sessions may use the application. A `secondFactorSetup` session belongs to an account
 * that must set up a second factor first and may only do that.
 */
export const sessionKind = pgEnum("session_kind", ["full", "secondFactorSetup"]);

/** Server-side sessions. The cookie holds a random ID; only its SHA-256 hash is stored. */
export const sessions = pgTable(
  "sessions",
  {
    id: primaryId(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    tokenHash: bytes().notNull(),
    kind: sessionKind().notNull(),
    /** SHA-256 of the device cookie of the browser that holds the session. */
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

/**
 * Short-lived state between two requests: a pending sign-in waiting for its second factor, or a
 * WebAuthn challenge. Pending sign-ins are identified by a cookie whose hash is stored here.
 */
export const authChallenges = pgTable(
  "auth_challenges",
  {
    id: primaryId(),
    purpose: challengePurpose().notNull(),
    tokenHash: bytes(),
    accountId: uuid().references(() => accounts.id, { onDelete: "cascade" }),
    sessionId: uuid().references(() => sessions.id, { onDelete: "cascade" }),
    /** WebAuthn challenge, base64url. */
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

/** Single-use tokens sent by e-mail. Only the SHA-256 hash of a token is stored. */
export const accountTokens = pgTable(
  "account_tokens",
  {
    id: primaryId(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    purpose: accountTokenPurpose().notNull(),
    tokenHash: bytes().notNull(),
    /** The address to confirm, for e-mail changes. */
    newEmail: text(),
    expiresAt: timestampColumn().notNull(),
    usedAt: timestampColumn(),
    createdAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [uniqueIndex().on(table.tokenHash), index().on(table.accountId, table.purpose)],
);

/** TOTP secret of an account. `confirmedAt` is null until the first valid code was entered. */
export const totpCredentials = pgTable(
  "totp_credentials",
  {
    id: primaryId(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    secret: encrypted().notNull(),
    confirmedAt: timestampColumn(),
    /** Time step of the last accepted code; a code is accepted once only. */
    lastUsedStep: bigint({ mode: "number" }),
    ...timestamps(),
  },
  (table) => [uniqueIndex().on(table.accountId)],
);

/** WebAuthn credentials: passkeys and hardware security keys. */
export const webauthnCredentials = pgTable(
  "webauthn_credentials",
  {
    id: primaryId(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** Credential ID chosen by the authenticator, base64url. */
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

/** Single-use recovery codes, stored as SHA-256 hashes. */
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

/** Request counters per key and window, shared by all nodes. */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text().primaryKey(),
    windowStart: timestampColumn().notNull(),
    count: integer().notNull(),
  },
  (table) => [index().on(table.windowStart)],
);

/** Failed sign-ins per account address or client, and temporary lockouts with increasing duration. */
export const signInFailures = pgTable(
  "sign_in_failures",
  {
    key: text().primaryKey(),
    failures: integer().notNull().default(0),
    firstFailureAt: timestampColumn(),
    lockedUntil: timestampColumn(),
    /** Lockouts in a row; each one doubles the duration of the next. */
    lockouts: integer().notNull().default(0),
    lastLockoutAt: timestampColumn(),
    updatedAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [index().on(table.updatedAt)],
);
