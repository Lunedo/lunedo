import { z } from "zod";
import { defineSetting } from "../settings/definition.js";

export const tokenMaxLifetimeSetting = defineSetting<number | null>({
  key: "apiTokens.maxLifetimeDays",
  schema: z.number().int().min(1).max(3650).nullable(),
  default: null,
  levels: ["instance", "organization"],
  lockable: true,
  stricterOnly: "lower",
});

export const tokenUnusedNoticeDaysSetting = defineSetting({
  key: "apiTokens.unusedNoticeDays",
  schema: z.number().int().min(7).max(3650),
  default: 90,
  levels: ["instance"],
  lockable: false,
});

export const tokenRequestsPerMinuteSetting = defineSetting({
  key: "apiTokens.requestsPerMinute",
  schema: z.number().int().min(1).max(100_000),
  default: 600,
  levels: ["instance"],
  lockable: false,
});

export const tokenExpiryReminderDaysSetting = defineSetting({
  key: "apiTokens.expiryReminderDays",
  schema: z.number().int().min(1).max(90),
  default: 7,
  levels: ["instance"],
  lockable: false,
});

export const publicApiDocumentationSetting = defineSetting({
  key: "apiTokens.publicDocumentation",
  schema: z.boolean(),
  default: false,
  levels: ["instance"],
  lockable: false,
});

export const tokenSettings = [
  tokenMaxLifetimeSetting,
  tokenUnusedNoticeDaysSetting,
  tokenRequestsPerMinuteSetting,
  tokenExpiryReminderDaysSetting,
  publicApiDocumentationSetting,
];
