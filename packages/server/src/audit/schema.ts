import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { principalTypes } from "../accounts/principal.js";
import { encrypted } from "../crypto/encrypted-column.js";
import { bytes, primaryId } from "../database/columns.js";

export const auditScopeType = pgEnum("audit_scope_type", ["instance", "organization"]);
export const principalType = pgEnum("principal_type", principalTypes);

export const auditChains = pgTable(
  "audit_chains",
  {
    scopeType: auditScopeType().notNull(),
    scopeId: uuid().notNull(),
    lastSequence: bigint({ mode: "number" }).notNull().default(0),
    lastHash: bytes(),
    anchorSequence: bigint({ mode: "number" }),
    anchorHash: bytes(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.scopeType, table.scopeId] })],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: primaryId(),
    scopeType: auditScopeType().notNull(),
    scopeId: uuid().notNull(),
    sequence: bigint({ mode: "number" }).notNull(),
    name: text().notNull(),
    actorType: principalType().notNull(),
    actorId: uuid(),
    targetType: text().notNull(),
    targetId: text(),
    fields: jsonb().notNull(),
    labels: jsonb(),
    sealed: jsonb(),
    occurredAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    requestId: text(),
    clientIp: text(),
    userAgent: text(),
    previousHash: bytes().notNull(),
    hash: bytes().notNull(),
  },
  (table) => [
    uniqueIndex().on(table.scopeType, table.scopeId, table.sequence),
    index().on(table.occurredAt),
    index().on(table.actorId).where(sql`${table.actorId} is not null`),
    index().on(table.targetType, table.targetId),
  ],
);

export const auditConfidentialEvents = pgTable(
  "audit_confidential_events",
  {
    eventId: uuid()
      .notNull()
      .references(() => auditEvents.id, { onDelete: "cascade" }),
    spaceId: uuid().notNull(),
  },
  (table) => [primaryKey({ columns: [table.eventId, table.spaceId] }), index().on(table.spaceId)],
);

export const auditSubjectKeys = pgTable(
  "audit_subject_keys",
  {
    subjectId: uuid().primaryKey(),
    accountId: uuid(),
    key: encrypted().notNull(),
    addressDigest: text(),
    createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index().on(table.accountId),
    index().on(table.addressDigest).where(sql`${table.addressDigest} is not null`),
  ],
);
