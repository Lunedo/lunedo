import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { accounts } from "../accounts/schema.js";
import { primaryId, timestamps } from "../database/columns.js";
import { storedFiles } from "../files/schema.js";
import { organizations } from "../organizations/schema.js";
import { spaces } from "../spaces/schema.js";

export const templateLevels = ["instance", "organization", "space"] as const;
export type TemplateLevel = (typeof templateLevels)[number];
export const templateLevel = pgEnum("template_level", templateLevels);

export const templateCategories = [
  "meetings",
  "decisions",
  "projects",
  "engineering",
  "operations",
  "knowledge",
  "teams",
] as const;
export type TemplateCategory = (typeof templateCategories)[number];
export const templateCategory = pgEnum("template_category", templateCategories);

export const pageTemplates = pgTable(
  "page_templates",
  {
    id: primaryId(),
    level: templateLevel().notNull(),
    organizationId: uuid().references(() => organizations.id, { onDelete: "cascade" }),
    spaceId: uuid().references(() => spaces.id, { onDelete: "cascade" }),
    name: text().notNull(),
    description: text().notNull().default(""),
    category: templateCategory().notNull(),
    title: text().notNull(),
    document: jsonb().notNull(),
    schemaVersion: integer().notNull(),
    fields: jsonb().notNull(),
    series: jsonb(),
    filesAdopted: boolean().notNull().default(true),
    createdBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    updatedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    index().on(table.organizationId),
    index().on(table.spaceId),
    index().on(table.createdBy),
    index().on(table.updatedBy),
    check(
      "page_templates_scope",
      sql`(${table.level} = 'instance' and ${table.organizationId} is null and ${table.spaceId} is null)
        or (${table.level} = 'organization' and ${table.organizationId} is not null and ${table.spaceId} is null)
        or (${table.level} = 'space' and ${table.spaceId} is not null and ${table.organizationId} is null)`,
    ),
    index("page_templates_files_pending_index").on(table.id).where(sql`not ${table.filesAdopted}`),
  ],
);

export const templateFiles = pgTable(
  "template_files",
  {
    id: primaryId(),
    templateId: uuid()
      .notNull()
      .references(() => pageTemplates.id, { onDelete: "cascade" }),
    fileId: uuid()
      .notNull()
      .references(() => storedFiles.id),
    name: text().notNull(),
    createdBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    index().on(table.templateId),
    index().on(table.fileId),
    index().on(table.createdBy),
    check("template_files_name_length", sql`length(${table.name}) between 1 and 255`),
  ],
);

export const templateImports = pgTable(
  "template_imports",
  {
    id: primaryId(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    level: templateLevel().notNull(),
    organizationId: uuid().references(() => organizations.id, { onDelete: "cascade" }),
    spaceId: uuid().references(() => spaces.id, { onDelete: "cascade" }),
    fileName: text().notNull(),
    templates: jsonb().notNull(),
    files: jsonb().notNull(),
    ...timestamps(),
  },
  (table) => [
    index().on(table.accountId),
    index().on(table.organizationId),
    index().on(table.spaceId),
    index().on(table.createdAt),
  ],
);
