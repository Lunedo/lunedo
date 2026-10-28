import {
  digestTimeSchema,
  type EmailDelivery,
  emailDeliveries,
  formatDate,
  notificationChannelSettingKey,
  notificationEvents,
  notificationParamSchemas,
} from "@lunedo/shared";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { defineSetting, type SettingDefinition } from "../settings/definition.js";
import { defineNotificationType, type MailLocale, type VisibilityContext } from "./registry.js";

export interface EventSettings {
  inApp: SettingDefinition<boolean>;
  email: SettingDefinition<EmailDelivery>;
  push: SettingDefinition<boolean>;
}

const PREFERENCE_LEVELS = ["organization", "user"] as const;

export const notificationEventSettings = new Map<string, EventSettings>(
  notificationEvents.map((event) => [
    event.id,
    {
      inApp: defineSetting({
        key: notificationChannelSettingKey(event.id, "inApp"),
        schema: z.boolean(),
        default: event.defaults.inApp,
        levels: PREFERENCE_LEVELS,
        lockable: true,
      }),
      email: defineSetting({
        key: notificationChannelSettingKey(event.id, "email"),
        schema: z.enum(emailDeliveries),
        default: event.defaults.email,
        levels: PREFERENCE_LEVELS,
        lockable: true,
      }),
      push: defineSetting({
        key: notificationChannelSettingKey(event.id, "push"),
        schema: z.boolean(),
        default: event.defaults.push,
        levels: PREFERENCE_LEVELS,
        lockable: true,
      }),
    },
  ]),
);

export const notificationRetentionSetting = defineSetting({
  key: "notifications.retentionDays",
  schema: z.number().int().min(1).max(3650),
  default: 90,
  levels: ["instance", "organization"],
  lockable: true,
});

export const digestTimeSetting = defineSetting({
  key: "notifications.digestTime",
  schema: digestTimeSchema,
  default: "08:00",
  levels: PREFERENCE_LEVELS,
  lockable: false,
  format: "A time of day as `HH:MM`, from `00:00` to `23:59`.",
});

export const digestEnabledSetting = defineSetting({
  key: "notifications.digestEnabled",
  schema: z.boolean(),
  default: true,
  levels: PREFERENCE_LEVELS,
  lockable: false,
});

export const watchAutomaticallySetting = defineSetting({
  key: "notifications.watchAutomatically",
  schema: z.boolean(),
  default: true,
  levels: ["user"],
  lockable: false,
});

export const browserPushSetting = defineSetting({
  key: "notifications.browserPush",
  schema: z.boolean(),
  default: false,
  levels: ["instance"],
  lockable: false,
});

export const notificationSettings = [
  ...[...notificationEventSettings.values()].flatMap((settings) => [
    settings.inApp,
    settings.email,
    settings.push,
  ]),
  browserPushSetting,
  notificationRetentionSetting,
  digestTimeSetting,
  digestEnabledSetting,
  watchAutomaticallySetting,
];

export function formatDay(instant: string, locale: MailLocale): string {
  return formatDate(new Date(instant), locale.dateFormat, locale.timeZone, locale.language);
}

const apiTokenExpiring = defineNotificationType({
  type: "apiToken.expiring",
  targetType: "apiToken",
  params: notificationParamSchemas["apiToken.expiring"],
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
  visible: (context) => responsibleOrMemberManager(context),
  mail: (params) => ({ template: "guestInactive", params }),
});

const accessExpiring = defineNotificationType({
  type: "access.expiring",
  targetType: "access",
  params: notificationParamSchemas["access.expiring"],
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
  visible: async (context) =>
    context.targetId !== null &&
    context.can("serviceAccount.view", { type: "serviceAccount", id: context.targetId }),
  mail: (params) => ({ template: "serviceAccountUnattended", params }),
});

const breakGlassStarted = defineNotificationType({
  type: "breakGlass.started",
  targetType: "breakGlassAccess",
  params: notificationParamSchemas["breakGlass.started"],
  visible: async (context) =>
    context.organizationId !== null &&
    context.can("organization.audit.view", { type: "organization", id: context.organizationId }),
  mail: (params) => ({ template: "breakGlassStarted", params }),
});

export function formatMoment(instant: string, locale: MailLocale): string {
  const time = new Intl.DateTimeFormat(locale.language, {
    timeZone: locale.timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(instant));
  return `${formatDay(instant, locale)} ${time}`;
}

const spaceAdministratorTaken = defineNotificationType({
  type: "space.administratorTaken",
  targetType: "space",
  params: notificationParamSchemas["space.administratorTaken"],
  visible: async (context) =>
    context.targetId !== null && context.can("space.manage", { type: "space", id: context.targetId }),
  mail: (params, locale) => ({
    template: "spaceAdministratorTaken",
    params: {
      organizationName: params.organizationName,
      spaceName: params.spaceName,
      actorName: params.actorName,
      reason: params.reason,
      takenAt: formatMoment(params.takenAt, locale),
    },
  }),
});

const signInNewBrowser = defineNotificationType({
  type: "signIn.newBrowser",
  targetType: "account",
  params: notificationParamSchemas["signIn.newBrowser"],
  visible: async (context) => context.targetId === context.recipientId,
  mail: (params) => ({ template: "signInNewBrowser", params }),
});

const emergencySignIn = defineNotificationType({
  type: "auth.emergencySignIn",
  targetType: "account",
  params: notificationParamSchemas["auth.emergencySignIn"],
  visible: async (context) => context.can("instance.signIn.view", { type: "instance" }),
  mail: (params) => ({ template: "emergencySignIn", params }),
});

const accountRolesWithheld = defineNotificationType({
  type: "account.rolesWithheld",
  targetType: "account",
  params: notificationParamSchemas["account.rolesWithheld"],
  visible: async (context) => context.can("instance.accounts.view", { type: "instance" }),
  mail: (params) => ({ template: "accountRolesWithheld", params }),
});

const accountWithoutOrganization = defineNotificationType({
  type: "account.withoutOrganization",
  targetType: "account",
  params: notificationParamSchemas["account.withoutOrganization"],
  visible: async (context) => context.can("instance.accounts.view", { type: "instance" }),
  mail: (params) => ({ template: "accountWithoutOrganization", params }),
});

const providerCredentialExpiring = defineNotificationType({
  type: "identityProvider.credentialExpiring",
  targetType: "identityProvider",
  params: notificationParamSchemas["identityProvider.credentialExpiring"],
  visible: async (context) => context.can("instance.signIn.view", { type: "instance" }),
  mail: (params, locale) => ({
    template: "providerCredentialExpiring",
    params: {
      providerName: params.providerName,
      date: formatDay(params.expiresAt, locale),
      credential: params.credential,
    },
  }),
  combineKey: (params) => params.credential,
});

const providerSyncHeld = defineNotificationType({
  type: "identityProvider.syncHeld",
  targetType: "identityProvider",
  params: notificationParamSchemas["identityProvider.syncHeld"],
  visible: async (context) => context.can("instance.signIn.view", { type: "instance" }),
  mail: (params) => ({
    template: "providerSyncHeld",
    params: {
      providerName: params.providerName,
      deactivations: params.deactivations,
      accounts: params.accounts,
    },
  }),
});

const homeOrganizationChanged = defineNotificationType({
  type: "account.homeOrganizationChanged",
  targetType: "account",
  params: notificationParamSchemas["account.homeOrganizationChanged"],
  async visible(context) {
    if (context.targetId === context.recipientId) return true;
    return (
      context.organizationId !== null &&
      context.can("organization.members.view", { type: "organization", id: context.organizationId })
    );
  },
  mail: (params) => ({ template: "homeOrganizationChanged", params }),
});

const mailCredentialExpiring = defineNotificationType({
  type: "mail.credentialExpiring",
  targetType: "instance",
  params: notificationParamSchemas["mail.credentialExpiring"],
  visible: async (context) => context.can("instance.settings.view", { type: "instance" }),
  mail: (params, locale) => ({
    template: "mailCredentialExpiring",
    params: { date: formatDay(params.expiresAt, locale) },
  }),
});

export const builtinNotificationTypes = [
  apiTokenExpiring,
  apiTokenUnused,
  guestExpiring,
  guestInactive,
  accessExpiring,
  serviceAccountUnattended,
  breakGlassStarted,
  spaceAdministratorTaken,
  signInNewBrowser,
  emergencySignIn,
  accountWithoutOrganization,
  accountRolesWithheld,
  providerCredentialExpiring,
  providerSyncHeld,
  homeOrganizationChanged,
  mailCredentialExpiring,
];
