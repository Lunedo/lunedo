import { storageReminders } from "@pagehall/server";
import { z } from "zod";

const percent = z.number().int().min(1).max(100);

export const storageStatusSchema = z
  .object({
    store: z
      .enum(["local", "s3"])
      .describe("Where files are stored: a local volume or S3-compatible storage."),
    measured: z
      .boolean()
      .describe("Whether Pagehall can measure the usage. False for S3 storage without a limit."),
    inactiveReason: z
      .enum(["noLimit"])
      .nullable()
      .describe(
        "Why warnings are inactive, or null. `noLimit`: S3 does not report free space, so a limit is needed.",
      ),
    usedBytes: z
      .number()
      .int()
      .nullable()
      .describe("Bytes in use on the volume, or stored in S3. Null when not measured."),
    totalBytes: z
      .number()
      .int()
      .nullable()
      .describe("Size of the volume, or the S3 limit. Null when not measured."),
    percent: z.number().nullable().describe("Usage in percent of the size or limit. Null when not measured."),
    level: z
      .number()
      .int()
      .min(0)
      .max(3)
      .describe(
        "The active level: 0 normal, 1 warning, 2 large exports and imports are refused, 3 uploads are refused too.",
      ),
    thresholds: z
      .object({
        warning: percent.describe("Usage in percent where the warning level starts."),
        largeWrites: percent.describe("Usage in percent where new exports and imports are refused."),
        critical: percent.describe("Usage in percent where uploads are refused too."),
      })
      .describe("The three levels in percent of usage, in ascending order."),
    s3LimitBytes: z
      .number()
      .int()
      .nullable()
      .describe("The limit for S3 storage in bytes, or null for none."),
    reminder: z
      .enum(storageReminders)
      .describe("How often an active level is announced again: `off`, `daily`, `weekly` or `monthly`."),
    operationsEmails: z
      .array(z.string())
      .describe("E-mail addresses of the operations contacts, for example an IT ticket address."),
    teamsWebhook: z
      .object({
        configured: z.boolean().describe("Whether a Teams Workflows webhook is set."),
        host: z.string().nullable().describe("Host name of the webhook. The full address is never returned."),
      })
      .describe("The optional Microsoft Teams webhook of the operations contacts."),
    checkedAt: z.string().nullable().describe("When the usage was last checked. ISO 8601 timestamp in UTC."),
  })
  .describe("Usage and settings of the file store warnings.");

export const exampleStorageStatus = {
  store: "local",
  measured: true,
  inactiveReason: null,
  usedBytes: 412_000_000_000,
  totalBytes: 500_000_000_000,
  percent: 82.4,
  level: 1,
  thresholds: { warning: 80, largeWrites: 90, critical: 95 },
  s3LimitBytes: null,
  reminder: "weekly",
  operationsEmails: ["it-tickets@example.org"],
  teamsWebhook: { configured: true, host: "prod-12.westeurope.logic.azure.com" },
  checkedAt: "2026-10-15T08:00:00.000Z",
} as const;

export const storageConfigurationSchema = z
  .object({
    thresholds: z
      .object({
        warning: percent.optional().describe("Usage in percent where the warning level starts."),
        largeWrites: percent
          .optional()
          .describe("Usage in percent where new exports and imports are refused."),
        critical: percent.optional().describe("Usage in percent where uploads are refused too."),
      })
      .strict()
      .optional()
      .describe(
        "The levels to change. The result must stay in ascending order: warning, large writes, critical.",
      ),
    s3LimitBytes: z
      .number()
      .int()
      .min(1)
      .nullable()
      .optional()
      .describe("The limit for S3 storage in bytes, or null to remove it."),
    reminder: z.enum(storageReminders).optional().describe("How often an active level is announced again."),
    operationsEmails: z
      .array(z.string().max(254))
      .max(20)
      .optional()
      .describe("All e-mail addresses of the operations contacts, up to 20. Replaces the earlier list."),
    teamsWebhook: z
      .string()
      .max(2000)
      .nullable()
      .optional()
      .describe("The Teams Workflows webhook address, or null to remove it. Leave it out to keep it."),
  })
  .strict()
  .describe("Changes to the storage warnings. Leave out what stays as it is.");

export const storageTestResultSchema = z
  .object({
    addresses: z.number().int().describe("How many e-mail addresses were sent a test message."),
    teams: z
      .object({
        delivered: z.boolean().describe("Whether Teams accepted the message."),
        reason: z.string().nullable().describe("Why Teams did not accept it, or null."),
        status: z.number().int().nullable().describe("HTTP status of Teams, or null."),
      })
      .nullable()
      .describe("The result for the Teams webhook, or null when none is set."),
  })
  .describe("The result of the test message to the operations contacts.");
