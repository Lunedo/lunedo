import { accentColors, colorModes, densities, fonts } from "@lunedo/shared";

export type SettingFieldType =
  | { kind: "boolean" }
  | {
      kind: "number";
      min: number;
      max: number;
      unit: "characters" | "count" | "perMinute" | "megabytes" | "versions";
      unlimited?: boolean;
    }
  | {
      kind: "duration";
      unit: "minutes" | "days";
      min: number;
      max: number;
      quickChoices: readonly number[];
      nullable?: boolean;
    }
  | { kind: "enum"; values: readonly string[]; labelPrefix: string }
  | { kind: "locale" }
  | { kind: "contentLanguage" }
  | { kind: "percent" }
  | { kind: "time" }
  | { kind: "text"; inputType?: "url" | "text" };

export interface SettingField {
  key: string;
  type: SettingFieldType;
}

const HOUR = 60;
const DAY = 24 * HOUR;

function minutes(min: number, max: number, quickChoices: readonly number[]): SettingFieldType {
  return { kind: "duration", unit: "minutes", min, max, quickChoices };
}

function days(min: number, max: number, quickChoices: readonly number[], nullable = false): SettingFieldType {
  return { kind: "duration", unit: "days", min, max, quickChoices, ...(nullable ? { nullable } : {}) };
}

const fields: SettingField[] = [
  { key: "instance.name", type: { kind: "text" } },
  { key: "reactions.enabled", type: { kind: "boolean" } },
  { key: "files.maxFileSizeMegabytes", type: { kind: "number", min: 1, max: 100_000, unit: "megabytes" } },
  { key: "imports.maxUploadMegabytes", type: { kind: "number", min: 1, max: 1_000_000, unit: "megabytes" } },
  {
    key: "imports.maxOrganizationMegabytes",
    type: { kind: "number", min: 1, max: 10_000_000, unit: "megabytes" },
  },
  { key: "imports.folderEnabled", type: { kind: "boolean" } },
  { key: "imports.atlassianHosts", type: { kind: "text" } },
  {
    key: "files.keepVersionsMaximum",
    type: { kind: "number", min: 1, max: 1_000_000, unit: "versions", unlimited: true },
  },
  {
    key: "files.keepVersions",
    type: { kind: "number", min: 1, max: 1_000_000, unit: "versions", unlimited: true },
  },
  {
    key: "storage.reminder",
    type: {
      kind: "enum",
      values: ["off", "daily", "weekly", "monthly"],
      labelPrefix: "settings.values.storageReminder",
    },
  },
  { key: "operations.updateCheck", type: { kind: "boolean" } },
  { key: "sharing.shareLinks", type: { kind: "boolean" } },
  { key: "sharing.anyoneLinks", type: { kind: "boolean" } },
  { key: "sharing.anyoneLinkMaxDays", type: days(1, 3650, [7, 30, 90]) },
  { key: "sharing.membersInviteGuests", type: { kind: "boolean" } },
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
  { key: "auth.sessionIdleTimeoutMinutes", type: minutes(5, 365 * DAY, [30, 8 * HOUR, DAY, 7 * DAY]) },
  { key: "auth.sessionLifetimeMinutes", type: minutes(5, 365 * DAY, [DAY, 7 * DAY, 30 * DAY]) },
  { key: "auth.reauthenticationMinutes", type: minutes(1, 60, [5, 15, 30]) },
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
  { key: "auth.lockoutWindowMinutes", type: minutes(1, DAY, [5, 15, HOUR]) },
  { key: "auth.lockoutMinutes", type: minutes(1, DAY, [5, 15, HOUR]) },
  { key: "auth.lockoutMaxMinutes", type: minutes(1, 7 * DAY, [HOUR, DAY]) },
  { key: "apiTokens.maxLifetimeDays", type: days(1, 3650, [30, 90, 365], true) },
  { key: "apiTokens.requestsPerMinute", type: { kind: "number", min: 1, max: 100_000, unit: "perMinute" } },
  { key: "apiTokens.expiryReminderDays", type: days(1, 90, [7, 14, 30]) },
  { key: "apiTokens.unusedNoticeDays", type: days(7, 3650, [30, 90, 180]) },
  { key: "apiTokens.publicDocumentation", type: { kind: "boolean" } },
  { key: "organizations.selfServiceCreation", type: { kind: "boolean" } },
  { key: "organizations.membersCreateGroups", type: { kind: "boolean" } },
  { key: "organizations.selfRegistration", type: { kind: "boolean" } },
  { key: "spaces.membersCreateSpaces", type: { kind: "boolean" } },
  { key: "spaces.membersCreateConfidentialSpaces", type: { kind: "boolean" } },
  { key: "spaces.cleanupGraceDays", type: days(7, 3650, [7, 30, 90]) },
  { key: "spaces.personalSpaces", type: { kind: "boolean" } },
  { key: "organizations.guestExpiryReminderDays", type: days(1, 90, [7, 14, 30]) },
  { key: "organizations.guestInactivityDays", type: days(1, 365, [30, 90, 180]) },
  { key: "organizations.expiryReminderDays", type: days(1, 90, [7, 14, 30]) },
  { key: "organizations.breakGlassMinutes", type: minutes(5, DAY, [30, HOUR, 4 * HOUR]) },
  { key: "audit.retentionDays", type: days(1, 36_500, [90, 365, 3650]) },
  { key: "identityProviders.syncLogRetentionDays", type: days(7, 3650, [30, 90, 365]) },
  {
    key: "pages.defaultMode",
    type: { kind: "enum", values: ["publish", "live"], labelPrefix: "settings.values.pageMode" },
  },
  { key: "pages.liveVersionIdleMinutes", type: minutes(1, DAY, [5, 10, 30]) },
  { key: "content.language", type: { kind: "contentLanguage" } },
  { key: "pages.status", type: { kind: "boolean" } },
  { key: "spaces.export", type: { kind: "boolean" } },
  { key: "trash.firstStageDays", type: days(1, 3650, [30, 90, 180]) },
  { key: "trash.secondStageDays", type: days(1, 3650, [30, 45, 90]) },
  { key: "trash.firstStageMinimumDays", type: days(1, 3650, [1, 30, 90]) },
  { key: "trash.secondStageMinimumDays", type: days(1, 3650, [1, 30, 45]) },
  { key: "notifications.retentionDays", type: days(1, 3650, [30, 90, 365]) },
  { key: "notifications.digestEnabled", type: { kind: "boolean" } },
  { key: "notifications.digestTime", type: { kind: "time" } },
  { key: "notifications.watchAutomatically", type: { kind: "boolean" } },
  {
    key: "appearance.colorMode",
    type: { kind: "enum", values: colorModes, labelPrefix: "preferences.colorModes" },
  },
  { key: "appearance.highContrast", type: { kind: "boolean" } },
  { key: "appearance.textSize", type: { kind: "percent" } },
  {
    key: "appearance.density",
    type: { kind: "enum", values: densities, labelPrefix: "preferences.densities" },
  },
  { key: "appearance.font", type: { kind: "enum", values: fonts, labelPrefix: "preferences.fonts" } },
  { key: "appearance.sidebarCollapsed", type: { kind: "boolean" } },
];

const byKey = new Map(fields.map((field) => [field.key, field]));

const CHANNEL_KEY = /^notifications\.[a-zA-Z0-9]+\.(inApp|email|push)$/;

export function notificationChannelOf(
  key: string,
): { event: string; channel: "inApp" | "email" | "push" } | null {
  const match = CHANNEL_KEY.exec(key);
  if (!match) return null;
  const channel = match[1] === "email" ? "email" : match[1] === "push" ? "push" : "inApp";
  return { event: key.split(".")[1] ?? "", channel };
}

export function settingField(key: string): SettingField | undefined {
  const channel = notificationChannelOf(key);
  if (channel?.channel === "inApp" || channel?.channel === "push") return { key, type: { kind: "boolean" } };
  if (channel?.channel === "email") {
    return {
      key,
      type: { kind: "enum", values: ["off", "immediately", "digest"], labelPrefix: "notifications.email" },
    };
  }
  return byKey.get(key);
}

export function settingLabelKey(key: string): string {
  return `settings.keys.${key.replaceAll(".", "_")}.label`;
}

export function settingDescriptionKey(key: string, level?: string): string {
  const base = `settings.keys.${key.replaceAll(".", "_")}`;
  if (level && levelDescriptions.has(`${key}@${level}`)) return `${base}.descriptionAt.${level}`;
  return `${base}.description`;
}

const levelDescriptions = new Set([
  "notifications.digestTime@user",
  "apiTokens.maxLifetimeDays@organization",
  "sharing.anyoneLinkMaxDays@organization",
  "auth.passwordMinLength@organization",
  "files.maxFileSizeMegabytes@organization",
]);

export const levelDescriptionKeys = [...levelDescriptions].map((entry) => {
  const [key = "", level = ""] = entry.split("@");
  return settingDescriptionKey(key, level);
});

export function settingHelpKey(key: string): string {
  return `settings.keys.${key.replaceAll(".", "_")}.help`;
}

export const knownSettingKeys = fields.map((field) => field.key);

export const MINUTES_PER_DAY = DAY;

export function toMinutes(type: Extract<SettingFieldType, { kind: "duration" }>, value: number): number {
  return type.unit === "days" ? value * DAY : value;
}

export function fromMinutes(type: Extract<SettingFieldType, { kind: "duration" }>, minutes: number): number {
  return type.unit === "days" ? Math.round(minutes / DAY) : minutes;
}
