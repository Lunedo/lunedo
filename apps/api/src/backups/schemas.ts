import { backupClasses, backupScopes, targetFailures } from "@lunedo/server";
import { z } from "zod";
import { uuid } from "../http/schemas.js";

const instant = (description: string) => z.string().describe(`${description} ISO 8601 timestamp in UTC.`);
const count = (description: string) => z.number().int().min(1).max(1000).describe(description);

const retentionSchema = z
  .object({
    daily: count("Daily backups to keep."),
    weekly: count("Weekly backups to keep."),
    monthly: count("Monthly backups to keep."),
    beforeUpdate: count("Backups before updates to keep."),
  })
  .describe("How many backups of each class are kept. Manual backups are kept until they are deleted.");

export const backupSettingsSchema = z
  .object({
    enabled: z.boolean().describe("Whether scheduled backups run."),
    dailyTime: z.string().describe("Time of the daily backup, HH:MM in the time zone of the instance."),
    weeklyDay: z
      .number()
      .int()
      .min(1)
      .max(7)
      .nullable()
      .describe("Day of the week whose backup is kept as a weekly one, 1 (Monday) to 7 (Sunday), or null."),
    monthlyDay: z
      .number()
      .int()
      .min(1)
      .max(31)
      .nullable()
      .describe(
        "Day of the month whose backup is kept as a monthly one, or null. In shorter months the last day is used.",
      ),
    retention: retentionSchema,
    scope: z
      .enum(backupScopes)
      .describe("`all`: database, file store and configuration. `database`: without the file store."),
    beforeUpdate: z.boolean().describe("Whether a backup is taken before migrations run."),
    missingDays: z
      .number()
      .int()
      .min(1)
      .max(365)
      .describe("Days without a successful backup after which administrators are warned."),
    autoTestRestore: z.boolean().describe("Whether the newest backup is test-restored once a month."),
  })
  .describe("The backup settings.");

const localTargetView = z
  .object({
    kind: z.literal("local").describe("A directory inside the container, also a mounted network share."),
    path: z.string().describe("Absolute path of the directory."),
    sameVolumeAsFiles: z
      .boolean()
      .describe(
        "Whether the directory is on the same volume as the file store, so one disk failure loses both.",
      ),
  })
  .describe("A local backup target.");

const s3TargetView = z
  .object({
    kind: z.literal("s3").describe("S3-compatible storage."),
    endpoint: z.string().nullable().describe("Address of the service, or null for Amazon S3."),
    region: z.string().describe("Region of the bucket."),
    bucket: z.string().describe("Bucket name."),
    prefix: z.string().describe("Prefix of the object names, empty or ending with a slash."),
    forcePathStyle: z.boolean().describe("Whether the bucket is addressed in the path."),
    accessKeyId: z.string().describe("Access key."),
    secretKeyConfigured: z.boolean().describe("Whether a secret key is stored. It is never returned."),
  })
  .describe("An S3-compatible backup target.");

const runSchema = z
  .object({
    id: z.string().describe("ID of the run."),
    trigger: z.enum(["scheduled", "manual", "beforeUpdate"]).describe("What started the run."),
    backupClass: z.enum(backupClasses).describe("Retention class of the backup."),
    state: z.enum(["running", "succeeded", "failed", "skipped"]).describe("State of the run."),
    name: z.string().nullable().describe("Name of the backup, once written."),
    sizeBytes: z.number().int().nullable().describe("Size of the backup in bytes, once written."),
    error: z.string().nullable().describe("Why the run failed or was skipped."),
    startedAt: instant("When the run started."),
    finishedAt: instant("When the run ended.").nullable(),
  })
  .describe("A backup run.");

const checkSchema = z
  .object({
    check: z
      .enum(["verify", "space", "privilege", "restore", "schemaVersion", "rows", "files"])
      .describe("What was checked."),
    passed: z.boolean().describe("Whether the check passed."),
    detail: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .describe("Details, for example row counts or the SQL that grants the missing privilege."),
  })
  .describe("One check of a test restore.");

export const testRestoreSchema = z
  .object({
    id: z.string().describe("ID of the test restore."),
    trigger: z
      .enum(["manual", "automatic"])
      .describe("Whether an administrator or the monthly schedule started it."),
    state: z
      .enum(["running", "passed", "verified", "failed"])
      .describe(
        "`passed`: restored and checked. `verified`: only verified, because the database user may not create databases or the work directory has too little free space (see `error`). `failed`: see `error`.",
      ),
    stage: z.enum(["verify", "restore", "checks", "done"]).describe("How far it got."),
    checks: z.array(checkSchema).describe("What was checked."),
    error: z.string().nullable().describe("Why it failed."),
    actor: z
      .object({ id: z.string().describe("Account ID."), name: z.string().describe("Name.") })
      .nullable()
      .describe("Who started it, or null for the monthly test restore."),
    startedAt: instant("When it started."),
    finishedAt: instant("When it ended.").nullable(),
  })
  .describe("A test restore of a backup.");

export const backupOverviewSchema = z
  .object({
    settings: backupSettingsSchema,
    restoredAt: instant(
      "When this instance was restored from a backup while its target is not confirmed yet. Scheduled backups, retention and the monthly test restore are paused until an instance administrator confirms or changes the target; null otherwise.",
    ).nullable(),
    target: z
      .discriminatedUnion("kind", [localTargetView, s3TargetView])
      .nullable()
      .describe("The target, or null."),
    timeZone: z.string().describe("Time zone of the instance, in which the daily time applies."),
    nextRunAt: instant("When the next scheduled backup starts, or null when backups are off.").nullable(),
    beforeUpdate: z
      .object({
        enabled: z.boolean().describe("Whether a backup is taken before migrations."),
        disabledBy: z
          .enum(["setting", "environment"])
          .nullable()
          .describe("What turned it off: the setting, or LUNEDO_BACKUP_BEFORE_UPDATE."),
      })
      .describe("Backups before updates."),
    keyConfirmed: z
      .object({
        at: instant("When it was confirmed."),
        by: z
          .object({ id: z.string().describe("Account ID."), name: z.string().describe("Name.") })
          .nullable()
          .describe("Who confirmed it."),
        inSetup: z
          .boolean()
          .describe("Whether it was confirmed in the setup, when the keys were downloaded."),
      })
      .nullable()
      .describe("When an administrator confirmed that the backup key is stored outside Lunedo."),
    running: z.boolean().describe("Whether a backup is running now."),
    testRestoreRunning: z.boolean().describe("Whether a test restore is running now."),
    alert: z
      .enum(["none", "failing", "missing"])
      .describe("Active warning: backups fail, or no backup succeeded for the configured days."),
    warning: z
      .enum(["off", "noTarget"])
      .nullable()
      .describe(
        "Why the admin area shows a banner while the instance has content: backups are off, or no target.",
      ),
    lastSuccess: runSchema.nullable(),
    lastFailure: runSchema.nullable(),
    runs: z.array(runSchema).describe("The latest runs, newest first."),
  })
  .describe("Settings and state of the backups.");

export const backupStatusSchema = z
  .object({
    enabled: z.boolean().describe("Whether scheduled backups run."),
    restoredAt: instant(
      "When this instance was restored from a backup while its target is not confirmed yet; backups are paused until then.",
    ).nullable(),
    testRestoreCleanupAt: instant(
      "When leftovers of an interrupted test restore (a temporary database or directory) were last removed.",
    ).nullable(),
    targetConfigured: z.boolean().describe("Whether a target is set up."),
    running: z.boolean().describe("Whether a backup is running now."),
    nextRunAt: instant("When the next scheduled backup starts.").nullable(),
    lastSuccess: z
      .object({
        at: instant("When it finished."),
        name: z.string().nullable().describe("Name of the backup."),
        sizeBytes: z.number().int().nullable().describe("Size in bytes."),
      })
      .nullable()
      .describe("The last successful backup."),
    lastFailure: z
      .object({ at: instant("When it failed."), reason: z.string().nullable().describe("Why.") })
      .nullable()
      .describe("The last failed backup."),
    alert: z.enum(["none", "failing", "missing"]).describe("Active warning."),
    beforeUpdate: z
      .object({
        enabled: z.boolean().describe("Whether a backup is taken before migrations."),
        disabledBy: z.enum(["setting", "environment"]).nullable().describe("What turned it off."),
      })
      .describe("Backups before updates."),
  })
  .describe("A short status of the backups, for monitoring.");

export const backupSettingsChangeSchema = z
  .object({
    enabled: z.boolean().optional().describe("Whether scheduled backups run."),
    dailyTime: z.string().max(5).optional().describe("Time of the daily backup, HH:MM."),
    weeklyDay: z.number().int().nullable().optional().describe("Day of the week 1 to 7, or null."),
    monthlyDay: z.number().int().nullable().optional().describe("Day of the month 1 to 31, or null."),
    retention: z
      .object({
        daily: z.number().int().optional().describe("Daily backups to keep."),
        weekly: z.number().int().optional().describe("Weekly backups to keep."),
        monthly: z.number().int().optional().describe("Monthly backups to keep."),
        beforeUpdate: z.number().int().optional().describe("Backups before updates to keep."),
      })
      .strict()
      .optional()
      .describe("Counts to change."),
    scope: z.enum(backupScopes).optional().describe("What the backups contain."),
    beforeUpdate: z.boolean().optional().describe("Whether a backup is taken before migrations."),
    missingDays: z.number().int().optional().describe("Days without a backup before a warning."),
    autoTestRestore: z.boolean().optional().describe("Whether the newest backup is test-restored monthly."),
  })
  .strict()
  .describe("Changes to the backup settings. Leave out what stays as it is.");

export const backupTargetSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("local").describe("A directory inside the container."),
        path: z.string().max(1024).describe("Absolute path, for example /var/lib/lunedo/backups."),
      })
      .strict()
      .describe("A local target."),
    z
      .object({
        kind: z.literal("s3").describe("S3-compatible storage."),
        endpoint: z.string().max(2000).nullable().describe("Address of the service, or null for Amazon S3."),
        region: z.string().max(64).describe("Region of the bucket, for example eu-central-1 or auto."),
        bucket: z.string().max(63).describe("Bucket name."),
        prefix: z.string().max(512).describe("Prefix of the object names, empty or ending with a slash."),
        forcePathStyle: z.boolean().describe("Whether the bucket is addressed in the path, as MinIO needs."),
        accessKeyId: z.string().max(256).describe("Access key."),
        secretAccessKey: z
          .string()
          .max(512)
          .optional()
          .describe(
            "Secret key. Leave it out to keep the stored one. It is stored encrypted and never returned.",
          ),
      })
      .strict()
      .describe("An S3-compatible target."),
  ])
  .describe("The backup target.");

export const targetTestResultSchema = z
  .object({
    ok: z.boolean().describe("Whether writing, reading, listing and deleting a test object worked."),
    failure: z.enum(targetFailures).nullable().describe("What failed, or null."),
    step: z.enum(["write", "read", "delete", "list"]).nullable().describe("Which step failed, or null."),
    message: z.string().nullable().describe("What failed and what to do, or null."),
    blockedAddress: z
      .string()
      .nullable()
      .describe("The private address the endpoint resolved to when it was refused, or null."),
    allowedNetwork: z
      .string()
      .nullable()
      .describe(
        "The network to add to LUNEDO_OUTBOUND_ALLOWED_NETWORKS so the refused address can be reached, or null.",
      ),
  })
  .describe("The result of the connection test.");

export const keyConfirmationSchema = z
  .object({ confirmed: z.boolean().describe("Whether the backup key is stored outside Lunedo.") })
  .strict()
  .describe("Confirms or withdraws that the backup key is stored elsewhere.");

export const backupListSchema = z
  .object({
    available: z.boolean().describe("Whether the target could be read."),
    error: z.string().nullable().describe("Why the target could not be read."),
    backups: z
      .array(
        z
          .object({
            name: z.string().describe("Name of the backup in the target."),
            backupClass: z.enum(backupClasses).describe("Retention class."),
            createdAt: instant("When it was created."),
            sizeBytes: z.number().int().describe("Size in bytes."),
            readable: z.boolean().describe("Whether its header could be read."),
            lunedoVersion: z.string().nullable().describe("Lunedo version that created it."),
            schemaVersion: z.string().nullable().describe("Schema version of the database in it."),
            scope: z.enum(backupScopes).nullable().describe("What it contains."),
            testRestore: testRestoreSchema.nullable().describe("The latest test restore, or null."),
          })
          .describe("A backup."),
      )
      .describe("Backups Lunedo created in the target, newest first."),
  })
  .describe("Backups in the target.");

export const backupNameParams = z
  .object({
    name: z
      .string()
      .regex(/^lunedo-backup-\d{8}T\d{6}Z-(daily|weekly|monthly|manual|before-update)-[0-9a-f]{8}\.ldbak$/)
      .describe("Name of the backup."),
  })
  .strict();

export const testRestoreParams = z.object({ id: uuid("ID of the test restore.") }).strict();

export const startedTestRestoreSchema = z
  .object({ id: z.string().describe("ID of the test restore.") })
  .describe("The started test restore.");

const exampleRun = {
  id: "0192f0e0-1a2b-7c3d-8e4f-5a6b7c8d9e01",
  trigger: "scheduled",
  backupClass: "daily",
  state: "succeeded",
  name: "lunedo-backup-20261021T000000Z-daily-3f0c8a1b.ldbak",
  sizeBytes: 524_288_000,
  error: null,
  startedAt: "2026-10-21T00:00:02.000Z",
  finishedAt: "2026-10-21T00:04:41.000Z",
} as const;

export const exampleTestRestore = {
  id: "0192f0e0-1a2b-7c3d-8e4f-5a6b7c8d9e02",
  trigger: "manual",
  state: "passed",
  stage: "done",
  checks: [
    { check: "verify", passed: true, detail: { entries: 1204, schemaVersion: "0000_baseline" } },
    { check: "restore", passed: true, detail: { database: "lunedo_test_restore_3f0c8a1b9d2e" } },
    {
      check: "schemaVersion",
      passed: true,
      detail: { expected: "0000_baseline", appliedMigrations: 1 },
    },
    { check: "rows", passed: true, detail: { instance: 1, accounts: 42, spaces: 12, tree_items: 1830 } },
    {
      check: "files",
      passed: true,
      detail: { included: true, referenced: 960, missing: 0, firstMissing: null },
    },
  ],
  error: null,
  actor: { id: "0192f0e0-1a2b-7c3d-8e4f-5a6b7c8d9e03", name: "Olivia Owner" },
  startedAt: "2026-10-21T08:00:00.000Z",
  finishedAt: "2026-10-21T08:06:12.000Z",
} as const;

export const exampleBackupOverview = {
  settings: {
    enabled: true,
    dailyTime: "02:00",
    weeklyDay: 7,
    monthlyDay: 1,
    retention: { daily: 7, weekly: 4, monthly: 6, beforeUpdate: 3 },
    scope: "all",
    beforeUpdate: true,
    missingDays: 2,
    autoTestRestore: true,
  },
  target: {
    kind: "s3",
    endpoint: "https://s3.example.org",
    region: "eu-central-1",
    bucket: "lunedo-backups",
    prefix: "lunedo/",
    forcePathStyle: false,
    accessKeyId: "AKIAEXAMPLE",
    secretKeyConfigured: true,
  },
  restoredAt: null,
  timeZone: "Europe/Vienna",
  nextRunAt: "2026-10-22T00:00:00.000Z",
  beforeUpdate: { enabled: true, disabledBy: null },
  keyConfirmed: {
    at: "2026-10-01T09:00:00.000Z",
    by: { id: "0192f0e0-1a2b-7c3d-8e4f-5a6b7c8d9e03", name: "Olivia Owner" },
    inSetup: false,
  },
  running: false,
  testRestoreRunning: false,
  alert: "none",
  warning: null,
  lastSuccess: exampleRun,
  lastFailure: null,
  runs: [exampleRun],
} as const;

export const exampleBackupStatus = {
  enabled: true,
  restoredAt: null,
  testRestoreCleanupAt: null,
  targetConfigured: true,
  running: false,
  nextRunAt: "2026-10-22T00:00:00.000Z",
  lastSuccess: { at: "2026-10-21T00:04:41.000Z", name: exampleRun.name, sizeBytes: 524_288_000 },
  lastFailure: null,
  alert: "none",
  beforeUpdate: { enabled: true, disabledBy: null },
} as const;

export const exampleBackupList = {
  available: true,
  error: null,
  backups: [
    {
      name: exampleRun.name,
      backupClass: "daily",
      createdAt: "2026-10-21T00:00:03.000Z",
      sizeBytes: 524_288_000,
      readable: true,
      lunedoVersion: "1.0.0",
      schemaVersion: "0000_baseline",
      scope: "all",
      testRestore: exampleTestRestore,
    },
  ],
} as const;

export const exampleS3Target = {
  kind: "s3",
  endpoint: "https://s3.example.org",
  region: "eu-central-1",
  bucket: "lunedo-backups",
  prefix: "lunedo/",
  forcePathStyle: false,
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "example-secret-key",
} as const;
