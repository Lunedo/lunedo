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
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "../accounts/schema.js";
import { primaryId, timestamps } from "../database/columns.js";

const timestampColumn = () => timestamp({ withTimezone: true, mode: "date" });

export const backupTargetKind = pgEnum("backup_target_kind", ["local", "s3"]);
export const backupScope = pgEnum("backup_scope", ["all", "database"]);
export const backupClass = pgEnum("backup_class", ["daily", "weekly", "monthly", "manual", "beforeUpdate"]);
export const backupTrigger = pgEnum("backup_trigger", ["scheduled", "manual", "beforeUpdate"]);
export const backupRunState = pgEnum("backup_run_state", ["running", "succeeded", "failed", "skipped"]);
export const backupAlert = pgEnum("backup_alert", ["none", "failing", "missing"]);
export const testRestoreState = pgEnum("backup_test_restore_state", [
  "running",
  "passed",
  "verified",
  "failed",
]);
export const testRestoreStage = pgEnum("backup_test_restore_stage", ["verify", "restore", "checks", "done"]);
export const testRestoreTrigger = pgEnum("backup_test_restore_trigger", ["manual", "automatic"]);

export const backupConfiguration = pgTable(
  "backup_configuration",
  {
    singleton: boolean().primaryKey().default(true),
    enabled: boolean().notNull().default(false),
    dailyTime: text().notNull().default("02:00"),
    weeklyDay: smallint(),
    monthlyDay: smallint(),
    keepDaily: integer().notNull().default(7),
    keepWeekly: integer().notNull().default(4),
    keepMonthly: integer().notNull().default(6),
    keepBeforeUpdate: integer().notNull().default(3),
    scope: backupScope().notNull().default("all"),
    beforeUpdate: boolean().notNull().default(true),
    missingDays: integer().notNull().default(2),
    autoTestRestore: boolean().notNull().default(true),
    targetKind: backupTargetKind(),
    targetPath: text(),
    s3Endpoint: text(),
    s3Region: text(),
    s3Bucket: text(),
    s3Prefix: text().notNull().default(""),
    s3ForcePathStyle: boolean().notNull().default(false),
    s3AccessKeyId: text(),
    keyConfirmedAt: timestampColumn(),
    keyConfirmedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    check("backup_configuration_singleton", sql`${table.singleton}`),
    check("backup_configuration_time", sql`${table.dailyTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    check("backup_configuration_weekly", sql`${table.weeklyDay} between 1 and 7`),
    check("backup_configuration_monthly", sql`${table.monthlyDay} between 1 and 31`),
    check(
      "backup_configuration_counts",
      sql`${table.keepDaily} between 1 and 1000 and ${table.keepWeekly} between 1 and 1000
        and ${table.keepMonthly} between 1 and 1000 and ${table.keepBeforeUpdate} between 1 and 1000
        and ${table.missingDays} between 1 and 365`,
    ),
    check(
      "backup_configuration_target",
      sql`(${table.targetKind} is null)
        or (${table.targetKind} = 'local' and ${table.targetPath} is not null)
        or (${table.targetKind} = 's3' and ${table.s3Bucket} is not null and ${table.s3Region} is not null
          and ${table.s3AccessKeyId} is not null)`,
    ),
  ],
);

export const backupState = pgTable(
  "backup_state",
  {
    singleton: boolean().primaryKey().default(true),
    lastSlot: timestampColumn(),
    enabledAt: timestampColumn(),
    alert: backupAlert().notNull().default("none"),
    alertNotifiedAt: timestampColumn(),
    lastAutomaticTestAt: timestampColumn(),
    restoredAt: timestampColumn(),
    testRestoreCleanupAt: timestampColumn(),
    ...timestamps(),
  },
  (table) => [check("backup_state_singleton", sql`${table.singleton}`)],
);

export const backupRuns = pgTable(
  "backup_runs",
  {
    id: primaryId(),
    trigger: backupTrigger().notNull(),
    backupClass: backupClass().notNull(),
    state: backupRunState().notNull(),
    name: text(),
    target: text(),
    sizeBytes: bigint({ mode: "number" }),
    error: text(),
    actorId: uuid().references(() => accounts.id, { onDelete: "set null" }),
    startedAt: timestampColumn().notNull().defaultNow(),
    finishedAt: timestampColumn(),
    ...timestamps(),
  },
  (table) => [index().on(table.startedAt), index().on(table.state, table.finishedAt)],
);

export const backupTestRestores = pgTable(
  "backup_test_restores",
  {
    id: primaryId(),
    backupName: text().notNull(),
    trigger: testRestoreTrigger().notNull(),
    state: testRestoreState().notNull(),
    stage: testRestoreStage().notNull(),
    checks: jsonb().$type<TestRestoreCheck[]>().notNull().default([]),
    error: text(),
    actorId: uuid().references(() => accounts.id, { onDelete: "set null" }),
    startedAt: timestampColumn().notNull().defaultNow(),
    jobStartedAt: timestampColumn(),
    finishedAt: timestampColumn(),
    ...timestamps(),
  },
  (table) => [index().on(table.backupName, table.startedAt)],
);

export interface TestRestoreCheck {
  check: "verify" | "space" | "privilege" | "restore" | "schemaVersion" | "rows" | "files";
  passed: boolean;
  detail: Record<string, string | number | boolean | null>;
}
