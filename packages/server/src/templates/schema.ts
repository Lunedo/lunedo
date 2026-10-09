import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { accounts } from "../accounts/schema.js";
import { primaryId, timestamps } from "../database/columns.js";
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
  ],
);
