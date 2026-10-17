import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "../accounts/schema.js";
import { primaryId, timestamps } from "../database/columns.js";
import { storedFiles } from "../files/schema.js";
import { organizations } from "../organizations/schema.js";
import { spaces, treeItems } from "../spaces/schema.js";
import { apiTokens } from "../tokens/schema.js";
import { exportFormats } from "./options.js";

const timestampColumn = () => timestamp({ withTimezone: true, mode: "date" });

export const exportStates = ["queued", "running", "ready", "failed"] as const;
export type ExportState = (typeof exportStates)[number];
export const exportState = pgEnum("export_state", exportStates);

export const exportScopes = ["space", "pages"] as const;
export type ExportScope = (typeof exportScopes)[number];
export const exportScope = pgEnum("export_scope", exportScopes);

export const exportFormat = pgEnum("export_format", exportFormats);

export const exports = pgTable(
  "exports",
  {
    id: primaryId(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    tokenId: uuid().references(() => apiTokens.id, { onDelete: "set null" }),
    startedWithToken: boolean().notNull().default(false),
    organizationId: uuid().references(() => organizations.id, { onDelete: "set null" }),
    scope: exportScope().notNull(),
    format: exportFormat().notNull().default("archive"),
    options: jsonb().notNull().default({}),
    spaceId: uuid().references(() => spaces.id, { onDelete: "set null" }),
    rootItemId: uuid().references(() => treeItems.id, { onDelete: "set null" }),
    name: text().notNull(),
    state: exportState().notNull().default("queued"),
    attempts: integer().notNull().default(0),
    progressDone: integer().notNull().default(0),
    progressTotal: integer().notNull().default(0),
    fileId: uuid().references(() => storedFiles.id, { onDelete: "set null" }),
    fileName: text(),
    size: bigint({ mode: "number" }),
    estimatedSize: bigint({ mode: "number" }).notNull().default(0),
    errorCode: text(),
    heartbeatAt: timestampColumn(),
    finishedAt: timestampColumn(),
    expiresAt: timestampColumn(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("exports_one_running_per_account")
      .on(table.accountId)
      .where(sql`${table.state} in ('queued', 'running')`),
    index().on(table.accountId, table.createdAt),
    index().on(table.state, table.heartbeatAt),
    index().on(table.expiresAt),
    index().on(table.tokenId),
    index().on(table.organizationId),
    index().on(table.spaceId),
    index().on(table.rootItemId),
    index().on(table.fileId),
  ],
);
