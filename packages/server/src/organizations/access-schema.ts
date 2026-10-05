import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "../accounts/schema.js";
import { bytes, primaryId, timestamps } from "../database/columns.js";
import { organizations } from "./schema.js";

const timestampColumn = () => timestamp({ withTimezone: true, mode: "date" });

export const membershipKinds = ["member", "collaborator", "guest"] as const;
export type MembershipKind = (typeof membershipKinds)[number];
export const membershipKind = pgEnum("membership_kind", membershipKinds);

export const memberships = pgTable(
  "memberships",
  {
    id: primaryId(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    kind: membershipKind().notNull(),
    expiresAt: timestampColumn(),
    responsibleAccountId: uuid().references(() => accounts.id, { onDelete: "set null" }),
    expiryRemindedAt: timestampColumn(),
    createdBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex().on(table.organizationId, table.accountId),
    index().on(table.accountId),
    index().on(table.expiresAt).where(sql`${table.expiresAt} is not null`),
  ],
);

export const roleScopes = ["instance", "organization"] as const;
export type RoleScope = (typeof roleScopes)[number];
export const roleScope = pgEnum("role_scope", roleScopes);

export const builtInRoleKeys = ["owner", "administrator", "member", "securityAuditor"] as const;
export type BuiltInRoleKey = (typeof builtInRoleKeys)[number];
export const builtInRole = pgEnum("built_in_role", builtInRoleKeys);

export const customRoles = pgTable(
  "custom_roles",
  {
    id: primaryId(),
    scope: roleScope().notNull(),
    organizationId: uuid().references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    areas: jsonb().notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("custom_roles_name_unique").on(
      table.scope,
      sql`coalesce(${table.organizationId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`lower(${table.name})`,
    ),
    check("custom_roles_scope", sql`(${table.scope} = 'instance') = (${table.organizationId} is null)`),
  ],
);

export const principalKinds = ["account", "group", "organizationMembers", "instanceUsers"] as const;
export type PrincipalKind = (typeof principalKinds)[number];
export const principalKind = pgEnum("principal_kind", principalKinds);

export const roleAssignments = pgTable(
  "role_assignments",
  {
    id: primaryId(),
    scope: roleScope().notNull(),
    organizationId: uuid().references(() => organizations.id, { onDelete: "cascade" }),
    principalKind: principalKind().notNull(),
    principalId: uuid(),
    builtInRole: builtInRole(),
    customRoleId: uuid().references(() => customRoles.id, { onDelete: "cascade" }),
    expiresAt: timestampColumn(),
    expiryRemindedAt: timestampColumn(),
    createdBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    unique("role_assignments_unique")
      .on(
        table.scope,
        table.organizationId,
        table.principalKind,
        table.principalId,
        table.builtInRole,
        table.customRoleId,
      )
      .nullsNotDistinct(),
    index().on(table.principalKind, table.principalId),
    index().on(table.organizationId, table.id),
    check(
      "role_assignments_one_role",
      sql`(${table.builtInRole} is null) <> (${table.customRoleId} is null)`,
    ),
    check("role_assignments_scope", sql`(${table.scope} = 'instance') = (${table.organizationId} is null)`),
    check(
      "role_assignments_principal",
      sql`(${table.principalKind} in ('account', 'group')) = (${table.principalId} is not null)`,
    ),
  ],
);

export const groups = pgTable(
  "groups",
  {
    id: primaryId(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    description: text().notNull().default(""),
    formerProvider: text(),
    createdBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [uniqueIndex("groups_name_unique").on(table.organizationId, sql`lower(${table.name})`)],
);

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid()
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    expiresAt: timestampColumn(),
    expiryRemindedAt: timestampColumn(),
    createdBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.accountId] }), index().on(table.accountId)],
);

export const groupManagers = pgTable(
  "group_managers",
  {
    groupId: uuid()
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.accountId] }), index().on(table.accountId)],
);

export const invitations = pgTable(
  "invitations",
  {
    id: primaryId(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text().notNull(),
    kind: membershipKind().notNull(),
    builtInRole: builtInRole(),
    customRoleId: uuid().references(() => customRoles.id, { onDelete: "set null" }),
    tokenHash: bytes().notNull(),
    invitedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    responsibleAccountId: uuid().references(() => accounts.id, { onDelete: "set null" }),
    membershipExpiresAt: timestampColumn(),
    expiresAt: timestampColumn().notNull(),
    acceptedAt: timestampColumn(),
    revokedAt: timestampColumn(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex().on(table.tokenHash),
    index("invitations_organization_email_id_index").on(
      table.organizationId,
      sql`lower(${table.email})`,
      table.id,
    ),
  ],
);

export const registrationTokens = pgTable(
  "registration_tokens",
  {
    id: primaryId(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text().notNull(),
    tokenHash: bytes().notNull(),
    expiresAt: timestampColumn().notNull(),
    usedAt: timestampColumn(),
    createdAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [uniqueIndex().on(table.tokenHash)],
);

export const breakGlassAccesses = pgTable(
  "break_glass_accesses",
  {
    id: primaryId(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    reason: text().notNull(),
    startedAt: timestampColumn().notNull().defaultNow(),
    expiresAt: timestampColumn().notNull(),
    endedAt: timestampColumn(),
    endRecordedAt: timestampColumn(),
  },
  (table) => [index().on(table.accountId, table.organizationId), index().on(table.expiresAt)],
);
