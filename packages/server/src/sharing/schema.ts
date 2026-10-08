import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "../accounts/schema.js";
import { encrypted } from "../crypto/encrypted-column.js";
import { bytes, primaryId, timestamps } from "../database/columns.js";
import { invitations, principalKind } from "../organizations/access-schema.js";
import { spaceRole, spaces, treeItems } from "../spaces/schema.js";

const timestampColumn = () => timestamp({ withTimezone: true, mode: "date" });

export const shareRoles = ["reader", "commenter", "editor"] as const;
export type ShareRole = (typeof shareRoles)[number];

export const restrictionKinds = ["view", "edit"] as const;
export type RestrictionKind = (typeof restrictionKinds)[number];
export const restrictionKind = pgEnum("page_restriction_kind", restrictionKinds);

export const shareLinkScopes = ["people", "organization", "instance", "anyone"] as const;
export type ShareLinkScope = (typeof shareLinkScopes)[number];
export const shareLinkScope = pgEnum("share_link_scope", shareLinkScopes);

export const accessRequestStatuses = ["open", "approved", "declined", "withdrawn", "satisfied"] as const;
export type AccessRequestStatus = (typeof accessRequestStatuses)[number];
export const accessRequestStatus = pgEnum("access_request_status", accessRequestStatuses);

export const pageShares = pgTable(
  "page_shares",
  {
    id: primaryId(),
    itemId: uuid()
      .notNull()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    principalKind: principalKind().notNull(),
    principalId: uuid().notNull(),
    role: spaceRole().notNull(),
    includeDescendants: boolean().notNull().default(false),
    createdBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("page_shares_holder_unique").on(table.itemId, table.principalKind, table.principalId),
    index().on(table.principalKind, table.principalId),
    index().on(table.createdBy),
    check("page_shares_principal", sql`${table.principalKind} in ('account', 'group')`),
    check("page_shares_role", sql`${table.role} <> 'admin'`),
  ],
);

export const pageRestrictions = pgTable(
  "page_restrictions",
  {
    itemId: uuid()
      .notNull()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    kind: restrictionKind().notNull(),
    setBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    orphanedAt: timestampColumn(),
    ...timestamps(),
  },
  (table) => [primaryKey({ columns: [table.itemId, table.kind] }), index().on(table.setBy)],
);

export const shareLinks = pgTable(
  "share_links",
  {
    id: primaryId(),
    itemId: uuid()
      .notNull()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    lookup: text().notNull(),
    secretHash: bytes().notNull(),
    secret: encrypted(),
    scope: shareLinkScope().notNull(),
    passwordHash: text(),
    expiresAt: timestampColumn(),
    createdBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    revokedAt: timestampColumn(),
    revokedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("share_links_lookup_unique").on(table.lookup),
    index().on(table.itemId),
    index().on(table.createdBy),
    index().on(table.revokedBy),
    check("share_links_anyone_expires", sql`${table.scope} <> 'anyone' or ${table.expiresAt} is not null`),
  ],
);

export const shareLinkPeople = pgTable(
  "share_link_people",
  {
    linkId: uuid()
      .notNull()
      .references(() => shareLinks.id, { onDelete: "cascade" }),
    principalKind: principalKind().notNull(),
    principalId: uuid().notNull(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ columns: [table.linkId, table.principalKind, table.principalId] }),
    index().on(table.principalKind, table.principalId),
    check("share_link_people_principal", sql`${table.principalKind} in ('account', 'group')`),
  ],
);

export const shareLinkAccesses = pgTable(
  "share_link_accesses",
  {
    linkId: uuid()
      .notNull()
      .references(() => shareLinks.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    lastOpenedAt: timestampColumn().notNull().defaultNow(),
    ...timestamps(),
  },
  (table) => [primaryKey({ columns: [table.linkId, table.accountId] }), index().on(table.accountId)],
);

export const accessRequests = pgTable(
  "access_requests",
  {
    id: primaryId(),
    requesterId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    itemId: uuid().references(() => treeItems.id, { onDelete: "cascade" }),
    message: text().notNull().default(""),
    status: accessRequestStatus().notNull().default("open"),
    role: spaceRole(),
    decidedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    decidedAt: timestampColumn(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("access_requests_open_unique")
      .on(
        table.requesterId,
        table.spaceId,
        sql`coalesce(${table.itemId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      )
      .where(sql`${table.status} = 'open'`),
    index().on(table.spaceId, table.status),
    index().on(table.itemId),
    index().on(table.decidedBy),
    check("access_requests_message_length", sql`length(${table.message}) <= 1000`),
  ],
);

export const invitationShares = pgTable(
  "invitation_shares",
  {
    invitationId: uuid()
      .notNull()
      .references(() => invitations.id, { onDelete: "cascade" }),
    itemId: uuid()
      .notNull()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    role: spaceRole().notNull(),
    includeDescendants: boolean().notNull().default(false),
    sharedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ columns: [table.invitationId, table.itemId] }),
    index().on(table.itemId),
    index().on(table.sharedBy),
    check("invitation_shares_role", sql`${table.role} <> 'admin'`),
  ],
);
