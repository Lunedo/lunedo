import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
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
import { principalKind } from "../organizations/access-schema.js";
import { organizations } from "../organizations/schema.js";

const timestampColumn = () => timestamp({ withTimezone: true, mode: "date" });

const binaryOrderedText = customType<{ data: string }>({ dataType: () => 'text COLLATE "C"' });

export const spaceVisibilities = ["private", "organization", "instance"] as const;
export type SpaceVisibility = (typeof spaceVisibilities)[number];
export const spaceVisibility = pgEnum("space_visibility", spaceVisibilities);

export const spaceRoles = ["reader", "commenter", "editor", "admin"] as const;
export type SpaceRole = (typeof spaceRoles)[number];
export const spaceRole = pgEnum("space_role", spaceRoles);

export const treeItemKinds = ["page", "folder", "link", "blogPost"] as const;
export type TreeItemKind = (typeof treeItemKinds)[number];
export const treeItemKind = pgEnum("tree_item_kind", treeItemKinds);

export const pageWidths = ["fixed", "full"] as const;
export type PageWidth = (typeof pageWidths)[number];
export const pageWidth = pgEnum("page_width", pageWidths);

export const pageModes = ["publish", "live"] as const;
export type PageMode = (typeof pageModes)[number];
export const pageMode = pgEnum("page_mode", pageModes);

export const versionReasons = ["published", "session", "restored", "modeChanged"] as const;
export type VersionReason = (typeof versionReasons)[number];
export const versionReason = pgEnum("version_reason", versionReasons);

export const trashEntryKinds = ["items", "space"] as const;
export type TrashEntryKind = (typeof trashEntryKinds)[number];
export const trashEntryKind = pgEnum("trash_entry_kind", trashEntryKinds);

export const discardReasons = ["discarded", "replaced"] as const;
export type DiscardReason = (typeof discardReasons)[number];
export const discardReason = pgEnum("discard_reason", discardReasons);

export const spaces = pgTable(
  "spaces",
  {
    id: primaryId(),
    organizationId: uuid().references(() => organizations.id, { onDelete: "cascade" }),
    personalOf: uuid().references(() => accounts.id, { onDelete: "cascade" }),
    ownerAccountId: uuid().references(() => accounts.id, { onDelete: "set null" }),
    key: text().notNull(),
    name: text().notNull(),
    description: text().notNull().default(""),
    visibility: spaceVisibility().notNull().default("private"),
    overviewItemId: uuid().references((): AnyPgColumn => treeItems.id, { onDelete: "set null" }),
    createdBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    archivedAt: timestampColumn(),
    archivedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    deletedAt: timestampColumn(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("spaces_key_unique").on(table.key),
    uniqueIndex("spaces_personal_of_unique").on(table.personalOf),
    index("spaces_organization_name_index").on(table.organizationId, sql`lower(${table.name})`, table.id),
    index().on(table.ownerAccountId),
    index().on(table.overviewItemId),
    index().on(table.createdBy),
    index().on(table.archivedBy),
    check("spaces_key_format", sql`${table.key} ~ '^[A-Z0-9]{2,10}$'`),
    check(
      "spaces_personal_or_organization",
      sql`(${table.personalOf} is null) <> (${table.organizationId} is null)`,
    ),
    check("spaces_personal_private", sql`${table.personalOf} is null or ${table.visibility} = 'private'`),
  ],
);

export const spaceKeyAliases = pgTable(
  "space_key_aliases",
  {
    key: text().primaryKey(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (table) => [index().on(table.spaceId)],
);

export const spacePermissions = pgTable(
  "space_permissions",
  {
    id: primaryId(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    principalKind: principalKind().notNull(),
    principalId: uuid(),
    role: spaceRole().notNull(),
    createdBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    unique("space_permissions_holder_unique")
      .on(table.spaceId, table.principalKind, table.principalId)
      .nullsNotDistinct(),
    index().on(table.principalKind, table.principalId),
    index().on(table.createdBy),
    check(
      "space_permissions_principal",
      sql`(${table.principalKind} in ('account', 'group')) = (${table.principalId} is not null)`,
    ),
  ],
);

export const treeItems = pgTable(
  "tree_items",
  {
    id: primaryId(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    parentId: uuid().references((): AnyPgColumn => treeItems.id, { onDelete: "cascade" }),
    kind: treeItemKind().notNull(),
    position: binaryOrderedText().notNull(),
    title: text().notNull(),
    description: text().notNull().default(""),
    width: pageWidth().notNull().default("fixed"),
    linkItemId: uuid().references((): AnyPgColumn => treeItems.id, { onDelete: "set null" }),
    linkUrl: text(),
    mode: pageMode().notNull().default("live"),
    publishedVersionId: uuid().references((): AnyPgColumn => pageVersions.id, { onDelete: "set null" }),
    readerVisible: boolean().notNull().default(true),
    trashEntryId: uuid().references((): AnyPgColumn => trashEntries.id),
    archivedRootId: uuid().references((): AnyPgColumn => treeItems.id),
    archivedAt: timestampColumn(),
    archivedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    restoreParentId: uuid(),
    restorePosition: binaryOrderedText(),
    creatorId: uuid().references(() => accounts.id, { onDelete: "set null" }),
    ownerId: uuid().references(() => accounts.id, { onDelete: "set null" }),
    contentUpdatedAt: timestampColumn().notNull().defaultNow(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("tree_items_position_unique")
      .on(
        table.spaceId,
        sql`coalesce(${table.parentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        table.position,
      )
      .where(sql`${table.trashEntryId} is null and ${table.archivedRootId} is distinct from ${table.id}`),
    index("tree_items_title_index").on(table.spaceId, sql`lower(${table.title})`),
    index().on(table.parentId),
    index().on(table.linkItemId),
    index().on(table.creatorId),
    index().on(table.ownerId),
    index().on(table.publishedVersionId),
    index().on(table.trashEntryId),
    index().on(table.archivedRootId),
    index().on(table.archivedBy),
    check(
      "tree_items_link_target",
      sql`(${table.kind} = 'link') = (${table.linkItemId} is not null or ${table.linkUrl} is not null)`,
    ),
    check("tree_items_not_own_parent", sql`${table.parentId} is distinct from ${table.id}`),
  ],
);

export const pageDocuments = pgTable("page_documents", {
  itemId: uuid()
    .primaryKey()
    .references(() => treeItems.id, { onDelete: "cascade" }),
  state: bytes().notNull(),
  snapshot: jsonb().notNull(),
  schemaVersion: integer().notNull(),
  revision: bigint({ mode: "number" }).notNull().default(1),
  draftTitle: text(),
  versionedRevision: bigint({ mode: "number" }).notNull().default(0),
  changedAt: timestampColumn().notNull().defaultNow(),
  updatedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
  ...timestamps(),
});

export const pageVersions = pgTable(
  "page_versions",
  {
    id: primaryId(),
    itemId: uuid()
      .notNull()
      .references((): AnyPgColumn => treeItems.id, { onDelete: "cascade" }),
    number: integer().notNull(),
    title: text().notNull(),
    document: jsonb().notNull(),
    schemaVersion: integer().notNull(),
    note: text().notNull().default(""),
    reason: versionReason().notNull(),
    restoredFrom: integer(),
    revision: bigint({ mode: "number" }).notNull(),
    stateVector: bytes().notNull(),
    contributors: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    createdBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    createdAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("page_versions_number_unique").on(table.itemId, table.number),
    index().on(table.createdBy),
    check("page_versions_note_length", sql`length(${table.note}) <= 500`),
  ],
);

export const discardedDrafts = pgTable(
  "discarded_drafts",
  {
    id: primaryId(),
    itemId: uuid()
      .notNull()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    title: text().notNull(),
    document: jsonb().notNull(),
    schemaVersion: integer().notNull(),
    reason: discardReason().notNull(),
    contributors: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    discardedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    discardedAt: timestampColumn().notNull().defaultNow(),
    expiresAt: timestampColumn().notNull(),
  },
  (table) => [index().on(table.itemId), index().on(table.discardedBy), index().on(table.expiresAt)],
);

export const trashEntries = pgTable(
  "trash_entries",
  {
    id: primaryId(),
    spaceId: uuid()
      .notNull()
      .references((): AnyPgColumn => spaces.id, { onDelete: "cascade" }),
    kind: trashEntryKind().notNull(),
    rootItemId: uuid(),
    title: text().notNull(),
    itemKind: treeItemKind(),
    descendants: integer().notNull().default(0),
    stage: integer().notNull().default(1),
    purging: boolean().notNull().default(false),
    deletedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    deletedAt: timestampColumn().notNull().defaultNow(),
    stageTwoAt: timestampColumn(),
  },
  (table) => [
    index().on(table.spaceId, table.stage),
    index().on(table.deletedBy),
    uniqueIndex("trash_entries_space_unique").on(table.spaceId).where(sql`${table.kind} = 'space'`),
    check("trash_entries_stage", sql`${table.stage} in (1, 2)`),
    check("trash_entries_root", sql`(${table.kind} = 'items') = (${table.rootItemId} is not null)`),
  ],
);

export const collaborationPresence = pgTable(
  "collaboration_presence",
  {
    itemId: uuid()
      .notNull()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    node: text().notNull(),
    connections: integer().notNull(),
    seenAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.itemId, table.node] })],
);

export const pageLabels = pgTable(
  "page_labels",
  {
    itemId: uuid()
      .notNull()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    label: text().notNull(),
    createdBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ columns: [table.itemId, table.label] }),
    index().on(table.label),
    index().on(table.createdBy),
    check(
      "page_labels_format",
      sql`${table.label} = lower(${table.label}) and length(${table.label}) between 1 and 100`,
    ),
  ],
);

export const pageLinks = pgTable(
  "page_links",
  {
    sourceItemId: uuid()
      .notNull()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    targetItemId: uuid()
      .notNull()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ columns: [table.sourceItemId, table.targetItemId] }),
    index().on(table.targetItemId),
  ],
);

export const collaborationClients = pgTable(
  "collaboration_clients",
  {
    itemId: uuid()
      .notNull()
      .references(() => treeItems.id, { onDelete: "cascade" }),
    clientId: bigint({ mode: "number" }).notNull(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (table) => [primaryKey({ columns: [table.itemId, table.clientId] }), index().on(table.accountId)],
);
