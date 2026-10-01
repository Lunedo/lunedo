import { z } from "zod";
import { defineSetting } from "../settings/definition.js";

export const tokenMaxLifetimeSetting = defineSetting({
  key: "apiTokens.maxLifetimeDays",
  schema: z.number().int().min(1).max(3650),
  default: 365,
  levels: ["instance", "organization"],
  lockable: true,
  stricterOnly: "lower",
});

export const tokensWithoutExpirySetting = defineSetting({
  key: "apiTokens.withoutExpiry",
  schema: z.boolean(),
  default: false,
  levels: ["instance", "organization"],
  lockable: true,
  stricterOnly: "lower",
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
  tokensWithoutExpirySetting,
  tokenRequestsPerMinuteSetting,
  tokenExpiryReminderDaysSetting,
  publicApiDocumentationSetting,
];
