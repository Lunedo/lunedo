import { z } from "zod";
import { defineJob } from "../jobs/job-queue.js";
import { defineSetting } from "../settings/definition.js";
import type { SettingsService } from "../settings/service.js";
import type { AuditLog } from "./audit-log.js";

export const auditRetentionSetting = defineSetting({
  key: "audit.retentionDays",
  schema: z.number().int().min(1).max(36_500),
  default: 365,
  levels: ["instance"],
  lockable: false,
});

export const auditRetentionJob = defineJob({
  name: "audit.apply-retention",
  payload: z.object({}),
  retryLimit: 3,
  expireInSeconds: 60 * 60,
});

export const AUDIT_RETENTION_SCHEDULE = "41 3 * * *";

export async function applyAuditRetention(options: {
  audit: AuditLog;
  settings: SettingsService;
  now?: Date;
}): Promise<number> {
  const days = await options.settings.get(auditRetentionSetting, {});
  const now = options.now ?? new Date();
  return options.audit.removeBefore(new Date(now.getTime() - days * 24 * 60 * 60 * 1000));
}
