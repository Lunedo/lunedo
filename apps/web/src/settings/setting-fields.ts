import { accentColors } from "@pagehall/shared";

export type SettingFieldType =
  | { kind: "boolean" }
  | {
      kind: "number";
      min: number;
      max: number;
      unit: "days" | "minutes" | "characters" | "count" | "perMinute";
    }
  | { kind: "enum"; values: readonly string[]; labelPrefix: string }
  | { kind: "locale" }
  | { kind: "text"; inputType?: "url" | "text" };

export interface SettingField {
  key: string;
  type: SettingFieldType;
}

const DAY = 24 * 60;

const fields: SettingField[] = [
  { key: "instance.name", type: { kind: "text" } },
  { key: "instance.url", type: { kind: "text", inputType: "url" } },
  { key: "locale.language", type: { kind: "locale" } },
  { key: "locale.timeZone", type: { kind: "locale" } },
  { key: "locale.dateFormat", type: { kind: "locale" } },
  { key: "locale.timeFormat", type: { kind: "locale" } },
  { key: "locale.numberFormat", type: { kind: "locale" } },
  { key: "locale.firstDayOfWeek", type: { kind: "locale" } },
  {
    key: "branding.accentColor",
    type: { kind: "enum", values: accentColors, labelPrefix: "settings.values.accentColor" },
  },
  { key: "auth.passwordMinLength", type: { kind: "number", min: 8, max: 256, unit: "characters" } },
  { key: "auth.twoFactorRequired", type: { kind: "boolean" } },
  { key: "auth.maxSessionsPerAccount", type: { kind: "number", min: 1, max: 100, unit: "count" } },
  {
    key: "auth.sessionIdleTimeoutMinutes",
    type: { kind: "number", min: 5, max: 365 * DAY, unit: "minutes" },
  },
  { key: "auth.sessionLifetimeMinutes", type: { kind: "number", min: 5, max: 365 * DAY, unit: "minutes" } },
  { key: "auth.reauthenticationMinutes", type: { kind: "number", min: 1, max: 60, unit: "minutes" } },
  {
    key: "auth.signInAttemptsPerAccountPerMinute",
    type: { kind: "number", min: 1, max: 1000, unit: "perMinute" },
  },
  {
    key: "auth.signInAttemptsPerClientPerMinute",
    type: { kind: "number", min: 1, max: 10_000, unit: "perMinute" },
  },
  { key: "auth.lockoutFailuresPerAccount", type: { kind: "number", min: 3, max: 1000, unit: "count" } },
  { key: "auth.lockoutFailuresPerClient", type: { kind: "number", min: 3, max: 10_000, unit: "count" } },
  { key: "auth.lockoutWindowMinutes", type: { kind: "number", min: 1, max: DAY, unit: "minutes" } },
  { key: "auth.lockoutMinutes", type: { kind: "number", min: 1, max: DAY, unit: "minutes" } },
  { key: "auth.lockoutMaxMinutes", type: { kind: "number", min: 1, max: 7 * DAY, unit: "minutes" } },
  { key: "apiTokens.maxLifetimeDays", type: { kind: "number", min: 1, max: 3650, unit: "days" } },
  { key: "apiTokens.requestsPerMinute", type: { kind: "number", min: 1, max: 100_000, unit: "perMinute" } },
  { key: "apiTokens.expiryReminderDays", type: { kind: "number", min: 1, max: 90, unit: "days" } },
  { key: "apiTokens.publicDocumentation", type: { kind: "boolean" } },
  { key: "organizations.selfServiceCreation", type: { kind: "boolean" } },
  { key: "organizations.membersCreateGroups", type: { kind: "boolean" } },
  { key: "organizations.selfRegistration", type: { kind: "boolean" } },
  { key: "organizations.guestExpiryReminderDays", type: { kind: "number", min: 1, max: 90, unit: "days" } },
  { key: "organizations.guestInactivityDays", type: { kind: "number", min: 1, max: 365, unit: "days" } },
  { key: "organizations.expiryReminderDays", type: { kind: "number", min: 1, max: 90, unit: "days" } },
  { key: "organizations.breakGlassMinutes", type: { kind: "number", min: 5, max: DAY, unit: "minutes" } },
  { key: "audit.retentionDays", type: { kind: "number", min: 1, max: 36_500, unit: "days" } },
  { key: "notifications.retentionDays", type: { kind: "number", min: 1, max: 3650, unit: "days" } },
];

const byKey = new Map(fields.map((field) => [field.key, field]));

export function settingField(key: string): SettingField | undefined {
  return byKey.get(key);
}

export function settingLabelKey(key: string): string {
  return `settings.keys.${key.replaceAll(".", "_")}.label`;
}

export function settingDescriptionKey(key: string): string {
  return `settings.keys.${key.replaceAll(".", "_")}.description`;
}

export const knownSettingKeys = fields.map((field) => field.key);
