import en from "../i18n/locales/en.json" with { type: "json" };
import { settingDescriptionKey, settingLabelKey } from "./setting-fields.js";

export interface IndexEntry {
  id: string;
  labelKey: string;
  descriptionKey?: string;
}

export interface IndexSection {
  titleKey: string;
  entries: IndexEntry[];
}

function setting(key: string): IndexEntry {
  return { id: key, labelKey: settingLabelKey(key), descriptionKey: settingDescriptionKey(key) };
}

function row(id: string, labelKey: string, descriptionKey?: string): IndexEntry {
  return { id, labelKey, ...(descriptionKey ? { descriptionKey } : {}) };
}

function section(titleKey: string, entries: IndexEntry[]): IndexSection {
  return { titleKey, entries };
}

export const LOCALE_DEFAULT_KEYS = [
  "locale.language",
  "locale.timeZone",
  "locale.dateFormat",
  "locale.timeFormat",
  "locale.numberFormat",
  "locale.firstDayOfWeek",
] as const;

export const INSTANCE_ORGANIZATION_KEYS = [
  "organizations.selfServiceCreation",
  "organizations.membersCreateGroups",
  "organizations.selfRegistration",
  "organizations.guestExpiryReminderDays",
  "organizations.guestInactivityDays",
  "organizations.expiryReminderDays",
  "organizations.breakGlassMinutes",
] as const;

export const RETENTION_KEYS = [
  "audit.retentionDays",
  "notifications.retentionDays",
  "apiTokens.publicDocumentation",
] as const;

export const SIGN_IN_KEYS = [
  "auth.twoFactorRequired",
  "auth.passwordMinLength",
  "auth.reauthenticationMinutes",
  "auth.sessionIdleTimeoutMinutes",
  "auth.sessionLifetimeMinutes",
  "auth.maxSessionsPerAccount",
] as const;

export const PROTECTION_KEYS = [
  "auth.signInAttemptsPerAccountPerMinute",
  "auth.signInAttemptsPerClientPerMinute",
  "auth.lockoutFailuresPerAccount",
  "auth.lockoutFailuresPerClient",
  "auth.lockoutWindowMinutes",
  "auth.lockoutMinutes",
  "auth.lockoutMaxMinutes",
] as const;

export const INSTANCE_TOKEN_KEYS = [
  "apiTokens.maxLifetimeDays",
  "apiTokens.requestsPerMinute",
  "apiTokens.expiryReminderDays",
  "apiTokens.unusedNoticeDays",
] as const;

export const ORGANIZATION_TOKEN_KEYS = ["apiTokens.maxLifetimeDays"] as const;

export const REGISTRATION_KEYS = [
  "organizations.selfRegistration",
  "organizations.membersCreateGroups",
] as const;

export const GUEST_KEYS = [
  "organizations.guestExpiryReminderDays",
  "organizations.guestInactivityDays",
  "organizations.expiryReminderDays",
] as const;

const LOCALE_PREFERENCES = [
  row("locale.language", "preferences.language"),
  row("locale.timeZone", "preferences.timeZone"),
  row("locale.dateFormat", "preferences.dateFormat"),
  row("locale.timeFormat", "preferences.timeFormat"),
  row("locale.numberFormat", "preferences.numberFormat"),
  row("locale.firstDayOfWeek", "preferences.firstDayOfWeek"),
];

const notificationEvents = (): IndexEntry[] =>
  Object.keys(en.notifications.events).map((event) =>
    row(`notifications.${event}`, `notifications.events.${event}`),
  );

export const SETTINGS_INDEX: Readonly<Record<string, IndexSection[]>> = {
  "account.preferences": [
    section("preferences.display", [
      row("appearance.colorMode", "preferences.colorMode", "preferences.colorModeHint"),
      row("appearance.highContrast", "preferences.highContrast", "preferences.highContrastHint"),
      row("appearance.textSize", "preferences.textSize", "preferences.textSizeHint"),
      row("appearance.density", "preferences.density", "preferences.densityHint"),
      row("appearance.font", "preferences.readableFont", "preferences.readableFontHint"),
    ]),
    section("preferences.languageAndRegion", LOCALE_PREFERENCES),
  ],
  "account.security": [
    section("security.signIn", [
      row("password", "auth.password", "security.passwordDescription"),
      row("email", "auth.email"),
    ]),
    section("security.twoFactor", [
      row("totp", "security.authenticatorApp"),
      row("passkeys", "security.passkeys", "security.passkeysDescription"),
      row("recoveryCodes", "security.recoveryCodes"),
    ]),
  ],
  "account.notifications": [section("notifications.eventTypes", notificationEvents())],
  "organization.general": [
    section("organization.general.profile", [
      row("name", "organization.general.name"),
      row("slug", "organization.general.slug", "organization.general.slugHint"),
    ]),
    section("organization.general.branding", [
      row("logo", "organization.general.logo", "organization.general.logoHint"),
      setting("branding.accentColor"),
    ]),
    section("organization.general.localeDefaults", LOCALE_DEFAULT_KEYS.map(setting)),
  ],
  "organization.security": [
    section("organization.security.signIn", SIGN_IN_KEYS.map(setting)),
    section("organization.security.apiTokens", ORGANIZATION_TOKEN_KEYS.map(setting)),
  ],
  "organization.domains": [
    section("organization.domains.registration", REGISTRATION_KEYS.map(setting)),
    section("organization.domains.guests", GUEST_KEYS.map(setting)),
  ],
  "organization.notifications": [section("notifications.eventTypes", notificationEvents())],
  "organization.spaces": [
    section("spaces.organization.creating", [setting("spaces.membersCreateSpaces")]),
    section("spaces.organization.defaults", [
      row("spaceDefaults", "spaces.organization.defaults", "spaces.organization.defaultsDescription"),
    ]),
    section("spaces.organization.withoutAdmin", [
      row(
        "withoutAdministrator",
        "spaces.organization.withoutAdmin",
        "spaces.organization.withoutAdminDescription",
      ),
    ]),
  ],
  "instance.general": [
    section("instance.general.identity", [
      setting("instance.name"),
      setting("instance.url"),
      setting("branding.accentColor"),
    ]),
    section("instance.general.localeDefaults", LOCALE_DEFAULT_KEYS.map(setting)),
    section("instance.general.organizations", INSTANCE_ORGANIZATION_KEYS.map(setting)),
    section("instance.general.retention", RETENTION_KEYS.map(setting)),
  ],
  "instance.security": [
    section("instance.security.signIn", SIGN_IN_KEYS.map(setting)),
    section("instance.security.protection", PROTECTION_KEYS.map(setting)),
    section("instance.security.apiTokens", INSTANCE_TOKEN_KEYS.map(setting)),
  ],
  "instance.signInProviders": [
    section("identityProviders.otherMethods", [setting("auth.passwordSignIn")]),
    section("emergencyRecipients.title", [
      row("emergencyRecipients", "emergencyRecipients.title", "emergencyRecipients.description"),
    ]),
  ],
  "instance.notifications": [section("notifications.eventTypes", notificationEvents())],
  "instance.personalSpaces": [
    section("spaces.instance.availability", [setting("spaces.personalSpaces")]),
    section("spaces.instance.review", [
      row("personalSpaceReview", "spaces.instance.review", "spaces.instance.reviewDescription"),
    ]),
  ],
};

export function normalizeSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replaceAll("ß", "ss");
}

export interface SearchMatch {
  pageId: string;
  sectionTitleKey: string;
  entry: IndexEntry;
}

export function searchSettings(
  pageIds: readonly string[],
  query: string,
  translate: (key: string) => string,
): SearchMatch[] {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const matches: SearchMatch[] = [];
  for (const pageId of pageIds) {
    for (const indexSection of SETTINGS_INDEX[pageId] ?? []) {
      for (const entry of indexSection.entries) {
        const text = normalizeSearch(
          [translate(entry.labelKey), entry.descriptionKey ? translate(entry.descriptionKey) : ""].join(" "),
        );
        if (words.every((word) => text.includes(word))) {
          matches.push({ pageId, sectionTitleKey: indexSection.titleKey, entry });
        }
      }
    }
  }
  return matches;
}
