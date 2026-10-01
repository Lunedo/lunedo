import { sql } from "drizzle-orm";
import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { bytes, primaryId, timestamps } from "../database/columns.js";

export const organizations = pgTable(
  "organizations",
  {
    id: primaryId(),
    name: text().notNull(),
    slug: text().notNull(),
    logoRef: text(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("organizations_slug_unique").on(sql`lower(${table.slug})`),
    index("organizations_name_id_index").on(sql`lower(${table.name})`, table.id),
  ],
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

export const organizationLogos = pgTable("organization_logos", {
  organizationId: uuid()
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  contentType: text().notNull(),
  data: bytes().notNull(),
  ref: text().notNull(),
  ...timestamps(),
});
