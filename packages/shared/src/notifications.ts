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
  "identityProvider.credentialExpiring": z.object({
    providerName: z.string(),
    expiresAt: instant,
    providerId: idSchema,
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
