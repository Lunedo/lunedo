import { z } from "zod";
import { defineSetting } from "../settings/definition.js";
import type { ScopeChain } from "../settings/service.js";

export function organizationSettingsChain(organizationId: string): ScopeChain {
  return { organization: organizationId };
}

export const selfServiceOrganizationsSetting = defineSetting({
  key: "organizations.selfServiceCreation",
  schema: z.boolean(),
  default: false,
  levels: ["instance"],
  lockable: false,
});

export const membersCreateGroupsSetting = defineSetting({
  key: "organizations.membersCreateGroups",
  schema: z.boolean(),
  default: false,
  levels: ["instance", "organization"],
  lockable: true,
});

export const selfRegistrationSetting = defineSetting({
  key: "organizations.selfRegistration",
  schema: z.boolean(),
  default: false,
  levels: ["instance", "organization"],
  lockable: true,
});

export const guestExpiryReminderDaysSetting = defineSetting({
  key: "organizations.guestExpiryReminderDays",
  schema: z.number().int().min(1).max(90),
  default: 7,
  levels: ["instance", "organization"],
  lockable: true,
});

export const guestInactivityDaysSetting = defineSetting({
  key: "organizations.guestInactivityDays",
  schema: z.number().int().min(1).max(365),
  default: 30,
  levels: ["instance", "organization"],
  lockable: true,
});

export const expiryReminderDaysSetting = defineSetting({
  key: "organizations.expiryReminderDays",
  schema: z.number().int().min(1).max(90),
  default: 7,
  levels: ["instance", "organization"],
  lockable: true,
});

export const breakGlassMinutesSetting = defineSetting({
  key: "organizations.breakGlassMinutes",
  schema: z
    .number()
    .int()
    .min(5)
    .max(24 * 60),
  default: 240,
  levels: ["instance"],
  lockable: false,
});

export const organizationSettings = [
  selfServiceOrganizationsSetting,
  membersCreateGroupsSetting,
  selfRegistrationSetting,
  guestExpiryReminderDaysSetting,
  guestInactivityDaysSetting,
  expiryReminderDaysSetting,
  breakGlassMinutesSetting,
];
