import { z } from "zod";
import { chatChannelKinds, chatFailureReasons } from "./chat.js";
import { identityProviderCredentialPurposes } from "./identity-providers.js";
import { idSchema } from "./validation.js";

export const UNREAD_COUNT_CAP = 100;

export const notificationChannels = ["inApp", "email", "push"] as const;
export type NotificationChannel = (typeof notificationChannels)[number];

export const emailDeliveries = ["off", "immediately", "digest"] as const;
export type EmailDelivery = (typeof emailDeliveries)[number];

const instant = z.iso.datetime();

export const notificationParamSchemas = {
  "apiToken.expiring": z.object({
    tokenName: z.string(),
    expiresAt: instant,
    serviceAccountId: idSchema.nullable(),
  }),
  "apiToken.unused": z.object({
    tokenName: z.string(),
    lastUsedAt: instant.nullable(),
    days: z.number().int(),
    serviceAccountId: idSchema.nullable(),
  }),
  "guest.expiring": z.object({ organizationName: z.string(), guestName: z.string(), expiresAt: instant }),
  "guest.inactive": z.object({
    organizationName: z.string(),
    guestName: z.string(),
    days: z.number().int(),
  }),
  "access.expiring": z.object({
    organizationName: z.string(),
    kind: z.enum(["role", "group", "membership"]),
    name: z.string(),
    expiresAt: instant,
  }),
  "serviceAccount.unattended": z.object({ organizationName: z.string(), serviceAccountName: z.string() }),
  "breakGlass.started": z.object({
    organizationName: z.string(),
    requesterName: z.string(),
    reason: z.string(),
    minutes: z.number().int(),
  }),
  "auth.emergencySignIn": z.object({
    accountName: z.string(),
    browser: z.string().nullable(),
    operatingSystem: z.string().nullable(),
    clientIp: z.string().nullable(),
  }),
  "account.rolesWithheld": z.object({
    accountName: z.string(),
    providerName: z.string(),
    roles: z.number().int(),
  }),
  "account.withoutOrganization": z.object({
    accountName: z.string(),
    email: z.string().nullable(),
    providerName: z.string(),
  }),
  "account.homeOrganizationChanged": z.object({
    accountName: z.string(),
    previousOrganizationName: z.string().nullable(),
    organizationName: z.string().nullable(),
    reason: z.enum(["providerRule", "manual"]),
  }),
  "mail.credentialExpiring": z.object({ expiresAt: instant }),
  "storage.levelReached": z.object({
    level: z.number().int().min(1).max(3),
    percent: z.number(),
    usedBytes: z.number(),
    totalBytes: z.number(),
    store: z.enum(["local", "s3"]),
    reminder: z.boolean(),
    link: z.string().nullable().default(null),
  }),
  "storage.levelCleared": z.object({
    level: z.number().int().min(0).max(2),
    percent: z.number(),
    store: z.enum(["local", "s3"]),
    link: z.string().nullable().default(null),
  }),
  "operations.updateAvailable": z.object({
    version: z.string(),
    current: z.string(),
    breaking: z.boolean(),
    link: z.string().nullable().default(null),
  }),
  "backup.failed": z.object({
    reason: z.string(),
    reminder: z.boolean(),
    link: z.string().nullable().default(null),
  }),
  "backup.missing": z.object({
    days: z.number().int(),
    lastSuccessAt: instant.nullable(),
    reminder: z.boolean(),
    link: z.string().nullable().default(null),
  }),
  "backup.recovered": z.object({ link: z.string().nullable().default(null) }),
  "backup.testRestoreFailed": z.object({
    backupName: z.string(),
    reason: z.string(),
    link: z.string().nullable().default(null),
  }),
  "identityProvider.credentialExpiring": z.object({
    providerName: z.string(),
    expiresAt: instant,
    providerId: idSchema,
    credential: z.enum(identityProviderCredentialPurposes).nullable().default(null),
  }),
  "identityProvider.syncHeld": z.object({
    providerName: z.string(),
    providerId: idSchema,
    deactivations: z.number().int(),
    accounts: z.number().int(),
  }),
  "space.administratorTaken": z.object({
    organizationName: z.string(),
    spaceName: z.string(),
    spaceKey: z.string(),
    actorName: z.string(),
    reason: z.string(),
    takenAt: instant,
  }),
  "signIn.newBrowser": z.object({
    browser: z.string().nullable(),
    operatingSystem: z.string().nullable(),
    clientIp: z.string().nullable(),
  }),
} as const;

export type NotificationType = keyof typeof notificationParamSchemas;
export type NotificationParams<T extends NotificationType> = z.output<(typeof notificationParamSchemas)[T]>;
export const notificationTypes = Object.keys(notificationParamSchemas) as NotificationType[];

export function notificationSettingKey(type: string): string {
  const [first = "", ...rest] = type.split(".");
  return `notifications.${first}${rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("")}`;
}

export type NotificationEventGroup = "content" | "administration";

export interface NotificationEvent {
  id: string;
  group: NotificationEventGroup;
  types: readonly string[];
  defaults: { inApp: boolean; email: EmailDelivery; push: boolean };
  keptWhenMuted: boolean;
  security: boolean;
}

function contentEvent(
  id: string,
  types: readonly string[],
  email: EmailDelivery,
  options: { keptWhenMuted?: boolean; push?: boolean } = {},
): NotificationEvent {
  return {
    id,
    group: "content",
    types,
    defaults: { inApp: true, email, push: options.push ?? false },
    keptWhenMuted: options.keptWhenMuted ?? false,
    security: false,
  };
}

export const securityNotificationTypes: ReadonlySet<NotificationType> = new Set<NotificationType>([
  "signIn.newBrowser",
  "auth.emergencySignIn",
  "breakGlass.started",
  "apiToken.expiring",
  "mail.credentialExpiring",
  "identityProvider.credentialExpiring",
  "space.administratorTaken",
]);

export const operationsNotificationTypes: ReadonlySet<NotificationType> = new Set<NotificationType>([
  "storage.levelReached",
  "storage.levelCleared",
  "backup.failed",
  "backup.missing",
  "backup.recovered",
  "backup.testRestoreFailed",
]);

function administrationEvent(
  id: string,
  types: readonly string[],
  email: EmailDelivery,
  security = false,
): NotificationEvent {
  return {
    id,
    group: "administration",
    types,
    defaults: { inApp: true, email, push: false },
    keptWhenMuted: false,
    security,
  };
}

export const notificationEvents: readonly NotificationEvent[] = [
  contentEvent("mentions", ["content.mentioned"], "immediately", { keptWhenMuted: true, push: true }),
  contentEvent("tasks", ["task.assigned"], "immediately", { keptWhenMuted: true, push: true }),
  contentEvent("shares", ["page.shared", "access.requestDecided"], "immediately", {
    keptWhenMuted: true,
    push: true,
  }),
  contentEvent("accessRequests", ["access.requested"], "immediately", { keptWhenMuted: true, push: true }),
  contentEvent("comments", ["comment.created"], "digest"),
  contentEvent("changes", ["content.changed"], "off"),
  contentEvent("copies", ["copy.finished", "copy.failed"], "off"),
  contentEvent("blogPosts", ["blogPost.published"], "digest"),
  contentEvent("meetings", ["meeting.reminder", "meeting.notesAvailable", "oneOnOne.started"], "off"),
  contentEvent("reviews", ["article.reviewDue", "article.sourceChanged"], "digest"),
  contentEvent(
    "ownershipAndStatus",
    ["ownership.transferred", "page.statusChanged", "ownership.orphaned"],
    "off",
  ),
  administrationEvent(
    "spaceAdministration",
    [
      "restriction.orphaned",
      "space.confidentialWithoutAdministrator",
      "space.personalWithoutAdministrator",
      "space.administratorAppointed",
      "space.memberAddedByAdministration",
      "space.memberRemovedByAdministration",
      "blogPost.scheduleHeld",
      "chatChannel.failing",
    ],
    "off",
  ),
  administrationEvent(
    "importsAndExports",
    ["import.finished", "import.failed", "import.held", "export.ready", "export.failed"],
    "off",
  ),
  ...notificationTypes.map((type) =>
    administrationEvent(
      notificationSettingKey(type).slice("notifications.".length),
      [type],
      "immediately",
      securityNotificationTypes.has(type) || operationsNotificationTypes.has(type),
    ),
  ),
];

const eventsByType = new Map(
  notificationEvents.flatMap((event) => event.types.map((type) => [type, event] as const)),
);

export function notificationEventOf(type: string): NotificationEvent | undefined {
  return eventsByType.get(type);
}

export function notificationChannelSettingKey(eventId: string, channel: NotificationChannel): string {
  return `notifications.${eventId}.${channel}`;
}

export const digestTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const watchStates = ["watching", "muted", "notWatching"] as const;
export type WatchState = (typeof watchStates)[number];

const contentKind = z.enum(["page", "blogPost", "meetingTopic", "whiteboard"]);
const shareRole = z.enum(["reader", "commenter", "editor"]);

export const contentNotificationParamSchemas = {
  "content.mentioned": z.object({
    itemTitle: z.string(),
    itemKind: contentKind,
    spaceKey: z.string(),
    commentId: idSchema.nullable(),
  }),
  "task.assigned": z.object({
    itemTitle: z.string(),
    itemKind: contentKind,
    spaceKey: z.string(),
    taskId: idSchema,
    taskText: z.string(),
    dueDate: z.string().nullable(),
  }),
  "blogPost.scheduleHeld": z.object({
    itemTitle: z.string(),
    itemKind: contentKind,
    spaceKey: z.string(),
    reason: z.enum(["noEditAccess", "accountRemoved"]),
    scheduledBy: idSchema.nullable(),
    spaceId: idSchema,
  }),
  "page.shared": z.object({
    itemTitle: z.string(),
    itemKind: contentKind,
    spaceKey: z.string(),
    role: shareRole,
    includeDescendants: z.boolean(),
  }),
  "comment.created": z.object({
    itemTitle: z.string(),
    itemKind: contentKind,
    spaceKey: z.string(),
    commentId: idSchema,
  }),
  "content.changed": z.object({
    itemTitle: z.string(),
    itemKind: contentKind,
    spaceKey: z.string(),
    version: z.number().int().positive(),
  }),
  "ownership.transferred": z.object({
    itemTitle: z.string(),
    itemKind: contentKind,
    spaceKey: z.string(),
    ownerId: idSchema,
  }),
  "page.statusChanged": z.object({
    itemTitle: z.string(),
    itemKind: contentKind,
    spaceKey: z.string(),
    statusBuiltIn: z.string().nullable(),
    statusName: z.string().nullable(),
  }),
  "access.requested": z.object({
    requestId: idSchema,
    target: z.enum(["space", "page"]),
    requesterName: z.string(),
    spaceId: idSchema,
    spaceName: z.string(),
    spaceKey: z.string(),
    itemTitle: z.string().nullable(),
    message: z.string(),
  }),
  "access.requestDecided": z.object({
    requestId: idSchema,
    target: z.enum(["space", "page"]),
    decision: z.enum(["approved", "declined", "satisfied"]),
    role: z.enum(["reader", "commenter", "editor", "admin"]).nullable(),
    spaceName: z.string(),
    spaceKey: z.string(),
    itemTitle: z.string().nullable(),
  }),
  "restriction.orphaned": z.object({
    itemTitle: z.string(),
    spaceId: idSchema,
    spaceName: z.string(),
    spaceKey: z.string(),
  }),
  "ownership.orphaned": z.object({
    spaceId: idSchema,
    spaceName: z.string(),
    spaceKey: z.string(),
    items: z.number().int().positive(),
  }),
  "space.confidentialWithoutAdministrator": z.object({ spaceKey: z.string() }),
  "space.personalWithoutAdministrator": z.object({ spaceKey: z.string() }),
  "space.memberAddedByAdministration": z.object({
    organizationName: z.string(),
    spaceName: z.string(),
    spaceKey: z.string(),
    actorName: z.string(),
    memberName: z.string(),
    role: z.string(),
  }),
  "space.memberRemovedByAdministration": z.object({
    organizationName: z.string(),
    spaceName: z.string(),
    spaceKey: z.string(),
    actorName: z.string(),
    memberName: z.string(),
    role: z.string(),
  }),
  "space.administratorAppointed": z.object({ spaceName: z.string(), spaceKey: z.string() }),
  "blogPost.published": z.object({
    itemTitle: z.string(),
    itemKind: contentKind,
    spaceKey: z.string(),
    spaceName: z.string(),
  }),
  "article.reviewDue": z.object({
    itemTitle: z.string(),
    spaceKey: z.string(),
    dueAt: z.iso.datetime(),
  }),
  "article.sourceChanged": z.object({
    itemTitle: z.string(),
    spaceKey: z.string(),
  }),
  "meeting.reminder": z.object({
    itemTitle: z.string(),
    seriesTitle: z.string(),
    spaceKey: z.string(),
    startsAt: z.iso.datetime(),
  }),
  "meeting.notesAvailable": z.object({
    itemTitle: z.string(),
    spaceKey: z.string(),
    startsAt: z.iso.datetime().nullable(),
  }),
  "import.finished": z.object({
    spaceKey: z.string(),
    spaceName: z.string(),
    problems: z.number().int().nonnegative(),
  }),
  "import.failed": z.object({ spaceKey: z.string(), spaceName: z.string(), errorCode: z.string() }),
  "import.held": z.object({ spaceKey: z.string() }),
  "export.ready": z.object({
    name: z.string(),
    scope: z.enum(["space", "pages"]),
    expiresAt: z.iso.datetime(),
  }),
  "export.failed": z.object({ name: z.string(), scope: z.enum(["space", "pages"]), errorCode: z.string() }),
  "copy.finished": z.object({
    itemTitle: z.string(),
    itemKind: z.enum(["page", "folder", "whiteboard"]),
    spaceKey: z.string(),
    copied: z.number().int().nonnegative(),
    hidden: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
  "copy.failed": z.object({ itemTitle: z.string(), errorCode: z.string() }),
  "chatChannel.failing": z.object({
    channelName: z.string(),
    kind: z.enum(chatChannelKinds),
    reason: z.enum(chatFailureReasons),
    spaceId: idSchema.nullable(),
    spaceKey: z.string().nullable(),
    organizationId: idSchema,
  }),
  "oneOnOne.started": z.object({
    itemTitle: z.string(),
    spaceKey: z.string(),
    startedBy: idSchema.nullable(),
  }),
} as const;

export type ContentNotificationType = keyof typeof contentNotificationParamSchemas;
