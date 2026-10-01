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
