import { z } from "zod";
import { idSchema } from "./validation.js";

export const notificationChannels = ["inApp", "email"] as const;
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
  "identityProvider.credentialExpiring": z.object({
    providerName: z.string(),
    expiresAt: instant,
    providerId: idSchema,
  }),
  "identityProvider.syncHeld": z.object({
    providerName: z.string(),
    providerId: idSchema,
    deactivations: z.number().int(),
    accounts: z.number().int(),
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
  defaults: { inApp: boolean; email: EmailDelivery };
  keptWhenMuted: boolean;
}

function contentEvent(
  id: string,
  types: readonly string[],
  email: EmailDelivery,
  keptWhenMuted = false,
): NotificationEvent {
  return { id, group: "content", types, defaults: { inApp: true, email }, keptWhenMuted };
}

function administrationEvent(id: string, types: readonly string[], email: EmailDelivery): NotificationEvent {
  return { id, group: "administration", types, defaults: { inApp: true, email }, keptWhenMuted: false };
}

export const notificationEvents: readonly NotificationEvent[] = [
  contentEvent("mentions", ["content.mentioned"], "immediately", true),
  contentEvent("tasks", ["task.assigned"], "immediately", true),
  contentEvent("shares", ["page.shared", "access.requestDecided"], "immediately"),
  contentEvent("accessRequests", ["access.requested"], "immediately"),
  contentEvent("comments", ["comment.created"], "digest"),
  contentEvent("changes", ["content.changed"], "off"),
  contentEvent("blogPosts", ["blogPost.published"], "digest"),
  contentEvent("meetings", ["meeting.reminder", "meeting.notesAvailable", "oneOnOne.started"], "off"),
  contentEvent(
    "ownershipAndStatus",
    ["ownership.transferred", "page.statusChanged", "ownership.orphaned"],
    "off",
  ),
  administrationEvent(
    "spaceAdministration",
    ["restriction.orphaned", "space.confidentialWithoutAdministrator", "blogPost.scheduleHeld"],
    "off",
  ),
  administrationEvent(
    "importsAndExports",
    ["import.finished", "import.failed", "import.held", "export.ready", "export.failed"],
    "off",
  ),
  ...notificationTypes.map((type) =>
    administrationEvent(notificationSettingKey(type).slice("notifications.".length), [type], "immediately"),
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

const contentKind = z.enum(["page", "blogPost", "meetingTopic"]);
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
    ownerName: z.string(),
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
  "oneOnOne.started": z.object({
    itemTitle: z.string(),
    spaceKey: z.string(),
    startedBy: idSchema.nullable(),
  }),
} as const;

export type ContentNotificationType = keyof typeof contentNotificationParamSchemas;
