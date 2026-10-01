import { sql } from "drizzle-orm";
import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { primaryId, timestamps } from "../database/columns.js";

export const organizations = pgTable(
  "organizations",
  {
    id: primaryId(),
    name: text().notNull(),
    slug: text().notNull(),
    logoRef: text(),
    ...timestamps(),
  },
  (table) => [uniqueIndex("organizations_slug_unique").on(sql`lower(${table.slug})`)],
);

export const organizationDomains = pgTable(
  "organization_domains",
  {
    domain: text().primaryKey(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (table) => [index().on(table.organizationId)],
);
