import { emailSchema } from "@pagehall/shared";
import { z } from "zod";
import { defineSetting } from "../settings/definition.js";

export const storageReminders = ["off", "daily", "weekly", "monthly"] as const;
export type StorageReminder = (typeof storageReminders)[number];

const percent = z.number().int().min(1).max(100);

export const storageWarningPercentSetting = defineSetting({
  key: "storage.warningPercent",
  schema: percent,
  default: 80,
  levels: ["instance"],
  lockable: false,
});

export const storageLargeWritesPercentSetting = defineSetting({
  key: "storage.largeWritesPercent",
  schema: percent,
  default: 90,
  levels: ["instance"],
  lockable: false,
});

export const storageCriticalPercentSetting = defineSetting({
  key: "storage.criticalPercent",
  schema: percent,
  default: 95,
  levels: ["instance"],
  lockable: false,
});

export const storageS3LimitSetting = defineSetting<number | null>({
  key: "storage.s3LimitBytes",
  schema: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable(),
  default: null,
  levels: ["instance"],
  lockable: false,
});

export const MAX_OPERATIONS_ADDRESSES = 20;

export const storageOperationsEmailsSetting = defineSetting({
  key: "storage.operationsEmails",
  schema: z.array(emailSchema).max(MAX_OPERATIONS_ADDRESSES),
  default: [] as string[],
  levels: ["instance"],
  lockable: false,
});

export const storageReminderSetting = defineSetting<StorageReminder>({
  key: "storage.reminder",
  schema: z.enum(storageReminders),
  default: "weekly",
  levels: ["instance"],
  lockable: false,
});

export const storageSettings = [
  storageWarningPercentSetting,
  storageLargeWritesPercentSetting,
  storageCriticalPercentSetting,
  storageS3LimitSetting,
  storageOperationsEmailsSetting,
  storageReminderSetting,
];
