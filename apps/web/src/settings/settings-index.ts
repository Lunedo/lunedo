import { notificationEvents } from "@lunedo/shared";
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

const notificationEventRows = (): IndexEntry[] =>
  notificationEvents.map((event) => row(`notifications.${event.id}`, `notifications.events.${event.id}`));

export const NOTIFICATION_DELIVERY_KEYS = [
  "notifications.digestEnabled",
  "notifications.digestTime",
  "notifications.retentionDays",
] as const;

export const PAGE_MODE_KEYS = ["pages.defaultMode", "pages.liveVersionIdleMinutes"] as const;

export const PAGE_STATUS_KEYS = ["pages.status"] as const;

export const EXPORT_KEYS = ["spaces.export"] as const;

export const TRASH_KEYS = ["trash.firstStageDays", "trash.secondStageDays"] as const;

export const SEARCH_KEYS = ["content.language"] as const;

export const COLLABORATION_KEYS = ["reactions.enabled"] as const;

export const FILE_KEYS = ["files.maxFileSizeMegabytes", "files.keepVersions"] as const;

export const SPACE_FILE_KEYS = ["files.keepVersions"] as const;

export const IMPORT_KEYS = [
  "imports.maxUploadMegabytes",
  "imports.maxOrganizationMegabytes",
  "imports.folderEnabled",
  "imports.atlassianHosts",
] as const;

export const SHARING_KEYS = [
  "sharing.shareLinks",
  "sharing.anyoneLinks",
  "sharing.anyoneLinkMaxDays",
  "sharing.membersInviteGuests",
] as const;

export const TRASH_MINIMUM_KEYS = ["trash.firstStageMinimumDays", "trash.secondStageMinimumDays"] as const;

export const POLICY_SECTIONS = [
  { titleKey: "instance.policies.signIn", keys: SIGN_IN_KEYS },
  { titleKey: "instance.policies.protection", keys: PROTECTION_KEYS },
  {
    titleKey: "instance.policies.apiTokens",
    keys: [...INSTANCE_TOKEN_KEYS, "apiTokens.publicDocumentation"],
  },
  { titleKey: "instance.policies.sharing", keys: ["sharing.anyoneLinks", "sharing.anyoneLinkMaxDays"] },
  { titleKey: "instance.policies.files", keys: ["files.maxFileSizeMegabytes", "files.keepVersionsMaximum"] },
  { titleKey: "instance.policies.trash", keys: TRASH_MINIMUM_KEYS },
  { titleKey: "instance.policies.imports", keys: IMPORT_KEYS },
  {
    titleKey: "instance.policies.organizationsAndSpaces",
    keys: ["organizations.selfServiceCreation", "spaces.personalSpaces"],
  },
  {
    titleKey: "instance.policies.retention",
    keys: ["audit.retentionDays", "identityProviders.syncLogRetentionDays", "notifications.retentionDays"],
  },
] as const satisfies readonly { titleKey: string; keys: readonly string[] }[];

export const SETTINGS_INDEX: Readonly<Record<string, IndexSection[]>> = {
  "organization.content": [
    section("content.pagesSection", PAGE_MODE_KEYS.map(setting)),
    section("content.trashSection", TRASH_KEYS.map(setting)),
    section("content.collaborationSection", COLLABORATION_KEYS.map(setting)),
    section("content.sharingSection", SHARING_KEYS.map(setting)),
    section("content.filesSection", FILE_KEYS.map(setting)),
  ],
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
  "account.notifications": [
    section("notifications.eventTypes", notificationEventRows()),
    section("notifications.digest.title", [
      setting("notifications.digestEnabled"),
      setting("notifications.digestTime"),
    ]),
    section("notifications.push.title", [
      row("browserPush", "notifications.push.thisDevice", "notifications.push.explanation"),
    ]),
    section("notifications.watching.title", [
      setting("notifications.watchAutomatically"),
      row("watched", "notifications.watching.watched"),
    ]),
    section("blog.followedTitle", [row("followedBlogs", "blog.followedTitle", "blog.followedDescription")]),
  ],
  "organization.general": [
    section("organization.general.profile", [
      row("name", "organization.general.name"),
      row("slug", "organization.general.slug", "organization.general.slugHint"),
    ]),
    section("organization.general.branding", [
      row("logo", "organization.general.logo", "organization.general.logoHint"),
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
  "organization.notifications": [
    section("notifications.eventTypes", notificationEventRows()),
    section("notifications.delivery", NOTIFICATION_DELIVERY_KEYS.map(setting)),
  ],
  "organization.announcements": [
    section("announcements.banner", [
      row("announcement", "announcements.title", "announcements.organizationDescription"),
    ]),
    section("chatChannels.announcementsTitle", [
      row("chatChannels", "chatChannels.announcementsTitle", "chatChannels.announcementsDescription"),
    ]),
  ],
  "organization.spaces": [
    section("spaces.organization.creating", [
      setting("spaces.membersCreateSpaces"),
      setting("spaces.membersCreateConfidentialSpaces"),
    ]),
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
    section("spaces.cleanup.tab", [setting("spaces.cleanupGraceDays")]),
  ],
  "instance.general": [
    section("instance.general.identity", [
      setting("instance.name"),
      setting("instance.url"),
      setting("branding.accentColor"),
    ]),
    section("instance.general.localeDefaults", ["locale.language", "locale.timeZone"].map(setting)),
  ],
  "instance.security": POLICY_SECTIONS.map((policy) => section(policy.titleKey, policy.keys.map(setting))),
  "instance.breakGlass": [section("breakGlass.title", [setting("organizations.breakGlassMinutes")])],
  "instance.mail": [
    section("notifications.push.title", [setting("notifications.browserPush")]),
    section("storage.contacts.title", [row("operationsContacts", "storage.contacts.title")]),
  ],
  "instance.accounts": [
    section("spaces.instance.review", [
      row("personalSpaceReview", "spaces.instance.review", "spaces.instance.reviewDescription"),
    ]),
  ],
  "instance.storage": [section("storage.reminder.title", [setting("storage.reminder")])],
  "instance.updates": [section("updates.check.title", [setting("operations.updateCheck")])],
  "instance.embeds": [
    section("embeds.allowlist.title", [
      row("embedAllowlist", "embeds.allowlist.title", "embeds.allowlist.instanceDescription"),
    ]),
  ],
  "instance.signInProviders": [
    section("identityProviders.otherMethods", [setting("auth.passwordSignIn")]),
    section("emergencyRecipients.title", [
      row("emergencyRecipients", "emergencyRecipients.title", "emergencyRecipients.description"),
    ]),
  ],
  "instance.announcements": [
    section("announcements.banner", [
      row("announcement", "announcements.title", "announcements.instanceDescription"),
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
