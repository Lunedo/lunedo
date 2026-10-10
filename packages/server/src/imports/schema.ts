import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "../accounts/schema.js";
import { encrypted } from "../crypto/encrypted-column.js";
import { primaryId, timestamps } from "../database/columns.js";
import { storedFiles } from "../files/schema.js";
import { groups } from "../organizations/access-schema.js";
import { organizations } from "../organizations/schema.js";
import { spaceRole, spaces, treeItems } from "../spaces/schema.js";

const timestampColumn = () => timestamp({ withTimezone: true, mode: "date" });

export const importStates = [
  "draft",
  "analyzing",
  "ready",
  "running",
  "held",
  "stopping",
  "review",
  "accepting",
  "accepted",
  "discarding",
  "discarded",
  "stopped",
  "failed",
] as const;
export type ImportState = (typeof importStates)[number];
export const importState = pgEnum("import_state", importStates);

export const importUploads = pgTable(
  "import_uploads",
  {
    id: primaryId(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    createdBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    name: text().notNull(),
    size: bigint({ mode: "number" }).notNull(),
    partSize: integer().notNull(),
    complete: boolean().notNull().default(false),
    digest: text(),
    expiresAt: timestampColumn().notNull(),
    ...timestamps(),
  },
  (table) => [
    index().on(table.organizationId),
    index().on(table.createdBy),
    index().on(table.expiresAt),
    check("import_uploads_size", sql`${table.size} > 0`),
    check("import_uploads_name", sql`length(${table.name}) between 1 and 255`),
  ],
);

export const importUploadParts = pgTable(
  "import_upload_parts",
  {
    uploadId: uuid()
      .notNull()
      .references(() => importUploads.id, { onDelete: "cascade" }),
    number: integer().notNull(),
    fileId: uuid()
      .notNull()
      .references(() => storedFiles.id),
    size: integer().notNull(),
    sha256: text().notNull(),
    createdAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.uploadId, table.number] }), index().on(table.fileId)],
);

export const imports = pgTable(
  "imports",
  {
    id: primaryId(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    importerId: uuid()
      .notNull()
      .references(() => accounts.id),
    source: text().notNull(),
    state: importState().notNull().default("draft"),
    draftStep: smallint().notNull().default(0),
    fileKind: text(),
    uploadId: uuid().references(() => importUploads.id, { onDelete: "set null" }),
    folderFile: text(),
    spaceName: text(),
    spaceKey: text(),
    archived: boolean().notNull().default(false),
    history: boolean().notNull().default(false),
    peopleSource: text(),
    tokenDeletedAt: timestampColumn(),
    sourceUrl: text(),
    phase: text(),
    progressDone: integer().notNull().default(0),
    progressTotal: integer().notNull().default(0),
    checkpoint: jsonb().notNull().default({}),
    found: jsonb(),
    counts: jsonb().notNull().default({}),
    quarantineSpaceId: uuid().references(() => spaces.id, { onDelete: "set null" }),
    errorCode: text(),
    stopRequestedAt: timestampColumn(),
    heartbeatAt: timestampColumn(),
    startedAt: timestampColumn(),
    finishedAt: timestampColumn(),
    decidedAt: timestampColumn(),
    decidedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    fileExpiresAt: timestampColumn(),
    ...timestamps(),
  },
  (table) => [
    index().on(table.organizationId, table.createdAt),
    index().on(table.importerId),
    index().on(table.uploadId),
    index().on(table.decidedBy),
    index().on(table.fileExpiresAt),
    uniqueIndex("imports_quarantine_space_unique").on(table.quarantineSpaceId),
    check("imports_file_kind", sql`${table.fileKind} is null or ${table.fileKind} in ('upload', 'folder')`),
    check("imports_draft_step", sql`${table.draftStep} between 0 and 10`),
    check(
      "imports_people_source",
      sql`${table.peopleSource} is null or ${table.peopleSource} in ('token', 'list', 'skip')`,
    ),
  ],
);

export const importCredentials = pgTable("import_credentials", {
  importId: uuid()
    .primaryKey()
    .references(() => imports.id, { onDelete: "cascade" }),
  site: text().notNull(),
  email: text().notNull(),
  token: encrypted().notNull(),
  people: integer(),
  withEmail: integer(),
  createdAt: timestampColumn().notNull().defaultNow(),
});

export const importDirectory = pgTable(
  "import_directory",
  {
    importId: uuid()
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    externalId: text().notNull(),
    name: text(),
    email: text(),
  },
  (table) => [primaryKey({ columns: [table.importId, table.externalId] })],
);

export const importGroups = pgTable(
  "import_groups",
  {
    importId: uuid()
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    nameKey: text().notNull(),
    name: text().notNull(),
    groupId: uuid().references(() => groups.id, { onDelete: "set null" }),
    mappedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    mappedAt: timestampColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.importId, table.nameKey] }),
    index().on(table.groupId),
    index().on(table.mappedBy),
  ],
);

export const importGrants = pgTable(
  "import_grants",
  {
    id: primaryId(),
    importId: uuid()
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    sourceKey: text().notNull(),
    itemId: uuid().references(() => treeItems.id, { onDelete: "cascade" }),
    restriction: text(),
    holderKind: text().notNull(),
    accountId: uuid().references(() => accounts.id, { onDelete: "cascade" }),
    groupKey: text(),
    role: spaceRole(),
    permissions: text().array().notNull().default(sql`'{}'::text[]`),
    status: text().notNull(),
    code: text(),
    appliedAt: timestampColumn(),
  },
  (table) => [
    uniqueIndex("import_grants_source_unique").on(table.importId, table.sourceKey),
    index().on(table.importId, table.groupKey),
    index().on(table.accountId),
    index().on(table.itemId),
    check(
      "import_grants_restriction",
      sql`${table.restriction} is null or ${table.restriction} in ('view', 'edit')`,
    ),
    check(
      "import_grants_holder_kind",
      sql`${table.holderKind} in ('account', 'group', 'organizationMembers', 'anonymous')`,
    ),
    check("import_grants_status", sql`${table.status} in ('mapped', 'check', 'missing', 'notTaken')`),
  ],
);

export const importReviewers = pgTable(
  "import_reviewers",
  {
    importId: uuid()
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    createdBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    createdAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.importId, table.accountId] }),
    index().on(table.accountId),
    index().on(table.createdBy),
  ],
);

export const importRecords = pgTable(
  "import_records",
  {
    importId: uuid()
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    kind: text().notNull(),
    sourceId: text().notNull(),
    ref: text(),
    parentId: text(),
    sort: text(),
    ordinal: integer(),
    data: jsonb().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.importId, table.kind, table.sourceId] }),
    index().on(table.importId, table.kind, table.ref),
    index().on(table.importId, table.kind, table.ordinal),
  ],
);

export const importItems = pgTable(
  "import_items",
  {
    importId: uuid()
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    kind: text().notNull(),
    sourceId: text().notNull(),
    targetId: uuid().notNull(),
    createdAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.importId, table.kind, table.sourceId] }),
    index().on(table.targetId),
  ],
);

export const importProblems = pgTable(
  "import_problems",
  {
    id: primaryId(),
    importId: uuid()
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    category: text().notNull(),
    code: text().notNull(),
    key: text().notNull(),
    sourceKind: text(),
    sourceId: text(),
    itemId: uuid().references(() => treeItems.id, { onDelete: "set null" }),
    details: jsonb().notNull().default({}),
    createdAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("import_problems_key_unique").on(table.importId, table.key),
    index().on(table.importId, table.category, table.code),
    index().on(table.itemId),
  ],
);

export const accountExternalIds = pgTable(
  "account_external_ids",
  {
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    source: text().notNull(),
    externalId: text().notNull(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    createdAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.source, table.externalId] }),
    index().on(table.accountId),
    check("account_external_ids_length", sql`length(${table.externalId}) between 1 and 255`),
  ],
);
