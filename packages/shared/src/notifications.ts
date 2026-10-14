import { z } from "zod";
import { idSchema } from "./validation.js";

export const notificationChannels = ["inApp", "email"] as const;
export type NotificationChannel = (typeof notificationChannels)[number];

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

export const notificationPreferenceSchema = z.object({ inApp: z.boolean(), email: z.boolean() }).strict();
export type NotificationPreference = z.output<typeof notificationPreferenceSchema>;

export function notificationSettingKey(type: string): string {
  const [first = "", ...rest] = type.split(".");
  return `notifications.${first}${rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("")}`;
}

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
  "oneOnOne.started": z.object({
    itemTitle: z.string(),
    spaceKey: z.string(),
    startedBy: idSchema.nullable(),
  }),
} as const;

export type ContentNotificationType = keyof typeof contentNotificationParamSchemas;
