import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
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

export const treeItemKinds = ["page", "folder", "link"] as const;
export type TreeItemKind = (typeof treeItemKinds)[number];
export const treeItemKind = pgEnum("tree_item_kind", treeItemKinds);

export const pageWidths = ["fixed", "full"] as const;
export type PageWidth = (typeof pageWidths)[number];
export const pageWidth = pgEnum("page_width", pageWidths);

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
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("spaces_key_unique").on(table.key),
    uniqueIndex("spaces_personal_of_unique").on(table.personalOf),
    index("spaces_organization_name_index").on(table.organizationId, sql`lower(${table.name})`, table.id),
    index().on(table.ownerAccountId),
    index().on(table.overviewItemId),
    index().on(table.createdBy),
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
    creatorId: uuid().references(() => accounts.id, { onDelete: "set null" }),
    ownerId: uuid().references(() => accounts.id, { onDelete: "set null" }),
    contentUpdatedAt: timestampColumn().notNull().defaultNow(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("tree_items_position_unique").on(
      table.spaceId,
      sql`coalesce(${table.parentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      table.position,
    ),
    index("tree_items_title_index").on(table.spaceId, sql`lower(${table.title})`),
    index().on(table.parentId),
    index().on(table.linkItemId),
    index().on(table.creatorId),
    index().on(table.ownerId),
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
  updatedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
  ...timestamps(),
});

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
