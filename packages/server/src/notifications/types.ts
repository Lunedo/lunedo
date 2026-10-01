import {
  type NotificationPreference,
  type NotificationType,
  notificationParamSchemas,
  notificationPreferenceSchema,
  notificationSettingKey,
  notificationTypes,
} from "@pagehall/shared";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { defineSetting, type SettingDefinition } from "../settings/definition.js";
import { defineNotificationType, type MailLocale, type VisibilityContext } from "./registry.js";

export function notificationPreferenceSetting(type: string): SettingDefinition<NotificationPreference> {
  return defineSetting({
    key: notificationSettingKey(type),
    schema: notificationPreferenceSchema,
    default: { inApp: true, email: true },
    levels: ["instance", "organization", "user"],
    lockable: true,
  });
}

const preferenceSettings = new Map(
  notificationTypes.map((type) => [type, notificationPreferenceSetting(type)] as const),
);

function settingOf(type: NotificationType): SettingDefinition<NotificationPreference> {
  const setting = preferenceSettings.get(type);
  if (!setting) throw new Error(`No preference setting for ${type}`);
  return setting;
}

export const notificationRetentionSetting = defineSetting({
  key: "notifications.retentionDays",
  schema: z.number().int().min(1).max(3650),
  default: 90,
  levels: ["instance"],
  lockable: false,
});

export const notificationSettings = [...preferenceSettings.values(), notificationRetentionSetting];

export function formatDay(instant: string, locale: MailLocale): string {
  return new Intl.DateTimeFormat(locale.language === "de" ? "de-DE" : "en-GB", {
    dateStyle: "long",
    timeZone: locale.timeZone,
  }).format(new Date(instant));
}

const apiTokenExpiring = defineNotificationType({
  type: "apiToken.expiring",
  targetType: "apiToken",
  params: notificationParamSchemas["apiToken.expiring"],
  setting: settingOf("apiToken.expiring"),
  async visible(context) {
    if (!context.targetId) return false;
    const owned = await context.executor.execute(sql`
      select 1 from api_tokens t where t.id = ${context.targetId} and (t.account_id = ${context.recipientId}
        or exists (select 1 from service_account_responsibles r
          where r.service_account_id = t.account_id and r.account_id = ${context.recipientId}))`);
    if (owned.rows.length > 0) return true;
    const serviceAccountId = context.params.serviceAccountId;
    return (
      serviceAccountId !== null &&
      context.can("serviceAccount.view", { type: "serviceAccount", id: serviceAccountId })
    );
  },
  mail: (params, locale) => ({
    template: "tokenExpiring",
    params: { tokenName: params.tokenName, date: formatDay(params.expiresAt, locale) },
  }),
});

const apiTokenUnused = defineNotificationType({
  type: "apiToken.unused",
  targetType: "apiToken",
  params: notificationParamSchemas["apiToken.unused"],
  setting: settingOf("apiToken.unused"),
  async visible(context) {
    if (!context.targetId) return false;
    const owned = await context.executor.execute(sql`
      select 1 from api_tokens t where t.id = ${context.targetId} and (t.account_id = ${context.recipientId}
        or exists (select 1 from service_account_responsibles r
          where r.service_account_id = t.account_id and r.account_id = ${context.recipientId}))`);
    if (owned.rows.length > 0) return true;
    const serviceAccountId = context.params.serviceAccountId;
    return (
      serviceAccountId !== null &&
      context.can("serviceAccount.view", { type: "serviceAccount", id: serviceAccountId })
    );
  },
  mail: (params) => ({
    template: "tokenUnused",
    params: { tokenName: params.tokenName, days: params.days },
  }),
});

async function responsibleOrMemberManager(context: VisibilityContext<unknown>): Promise<boolean> {
  if (!context.organizationId) return false;
  if (context.targetId) {
    const responsible = await context.executor.execute(sql`
      select 1 from memberships where organization_id = ${context.organizationId}
        and account_id = ${context.targetId} and responsible_account_id = ${context.recipientId}`);
    if (responsible.rows.length > 0) return true;
  }
  return context.can("organization.members.manage", { type: "organization", id: context.organizationId });
}

const guestExpiring = defineNotificationType({
  type: "guest.expiring",
  targetType: "account",
  params: notificationParamSchemas["guest.expiring"],
  setting: settingOf("guest.expiring"),
  visible: (context) => responsibleOrMemberManager(context),
  mail: (params, locale) => ({
    template: "guestExpiring",
    params: {
      organizationName: params.organizationName,
      guestName: params.guestName,
      date: formatDay(params.expiresAt, locale),
    },
  }),
});

const guestInactive = defineNotificationType({
  type: "guest.inactive",
  targetType: "account",
  params: notificationParamSchemas["guest.inactive"],
  setting: settingOf("guest.inactive"),
  visible: (context) => responsibleOrMemberManager(context),
  mail: (params) => ({ template: "guestInactive", params }),
});

const accessExpiring = defineNotificationType({
  type: "access.expiring",
  targetType: "access",
  params: notificationParamSchemas["access.expiring"],
  setting: settingOf("access.expiring"),
  visible: async (context) =>
    context.organizationId !== null &&
    context.can("organization.view", { type: "organization", id: context.organizationId }),
  mail: (params, locale) => ({
    template: "accessExpiring",
    params: {
      organizationName: params.organizationName,
      kind: params.kind,
      name: params.name,
      date: formatDay(params.expiresAt, locale),
    },
  }),
});

const serviceAccountUnattended = defineNotificationType({
  type: "serviceAccount.unattended",
  targetType: "serviceAccount",
  params: notificationParamSchemas["serviceAccount.unattended"],
  setting: settingOf("serviceAccount.unattended"),
  visible: async (context) =>
    context.targetId !== null &&
    context.can("serviceAccount.view", { type: "serviceAccount", id: context.targetId }),
  mail: (params) => ({ template: "serviceAccountUnattended", params }),
});

const breakGlassStarted = defineNotificationType({
  type: "breakGlass.started",
  targetType: "breakGlassAccess",
  params: notificationParamSchemas["breakGlass.started"],
  setting: settingOf("breakGlass.started"),
  visible: async (context) =>
    context.organizationId !== null &&
    context.can("organization.audit.view", { type: "organization", id: context.organizationId }),
  mail: (params) => ({ template: "breakGlassStarted", params }),
});

const signInNewBrowser = defineNotificationType({
  type: "signIn.newBrowser",
  targetType: "account",
  params: notificationParamSchemas["signIn.newBrowser"],
  setting: settingOf("signIn.newBrowser"),
  visible: async (context) => context.targetId === context.recipientId,
  mail: (params) => ({ template: "signInNewBrowser", params }),
});

export const builtinNotificationTypes = [
  apiTokenExpiring,
  apiTokenUnused,
  guestExpiring,
  guestInactive,
  accessExpiring,
  serviceAccountUnattended,
  breakGlassStarted,
  signInNewBrowser,
];
