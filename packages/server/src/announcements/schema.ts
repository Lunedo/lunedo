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
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "../accounts/schema.js";
import { primaryId, timestamps } from "../database/columns.js";
import { organizations } from "../organizations/schema.js";

const timestampColumn = () => timestamp({ withTimezone: true, mode: "date" });

export const announcementSeverities = ["information", "warning"] as const;
export type AnnouncementSeverity = (typeof announcementSeverities)[number];
export const announcementSeverity = pgEnum("announcement_severity", announcementSeverities);

export const announcements = pgTable(
  "announcements",
  {
    id: primaryId(),
    scopeId: uuid().notNull().unique(),
    organizationId: uuid().references(() => organizations.id, { onDelete: "cascade" }),
    version: uuid().notNull(),
    severity: announcementSeverity().notNull(),
    text: text().notNull(),
    linkUrl: text(),
    linkLabel: text(),
    startsAt: timestampColumn().notNull(),
    endsAt: timestampColumn().notNull(),
    startSignaled: boolean().notNull().default(true),
    updatedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    index().on(table.organizationId),
    index().on(table.updatedBy),
    check(
      "announcements_scope",
      sql`${table.scopeId} = coalesce(${table.organizationId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
    check("announcements_period", sql`${table.endsAt} > ${table.startsAt}`),
    check("announcements_text_length", sql`length(${table.text}) between 1 and 300`),
    check(
      "announcements_link",
      sql`(${table.linkUrl} is null) = (${table.linkLabel} is null)
        and (${table.linkUrl} is null or length(${table.linkUrl}) <= 2000)
        and (${table.linkLabel} is null or length(${table.linkLabel}) between 1 and 60)`,
    ),
  ],
);

export const announcementDismissals = pgTable(
  "announcement_dismissals",
  {
    announcementId: uuid()
      .notNull()
      .references(() => announcements.id, { onDelete: "cascade" }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    version: uuid().notNull(),
    ...timestamps(),
  },
  (table) => [primaryKey({ columns: [table.announcementId, table.accountId] }), index().on(table.accountId)],
);
