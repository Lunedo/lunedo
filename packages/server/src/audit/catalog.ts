import { z } from "zod";
import type { PrincipalType } from "../accounts/principal.js";

export const auditTargetTypes = [
  "account",
  "instance",
  "setting",
  "setupStep",
  "organization",
  "group",
  "role",
  "roleAssignment",
  "invitation",
  "breakGlassAccess",
] as const;
export type AuditTargetType = (typeof auditTargetTypes)[number];

export type AuditVisibility = "instance" | "organization";

export interface AuditEventDefinition<TFields extends z.ZodObject = z.ZodObject> {
  actor: readonly PrincipalType[];
  target: AuditTargetType;
  fields: TFields;
  visibility: AuditVisibility;
}

function event<TFields extends z.ZodObject>(
  definition: AuditEventDefinition<TFields>,
): AuditEventDefinition<TFields> {
  return definition;
}

export const signInMethods = ["password", "totp", "passkey", "recoveryCode"] as const;
export type SignInMethod = (typeof signInMethods)[number];

const methods = z.array(z.enum(signInMethods)).min(1);
const sessionReference = z.object({ sessionId: z.uuid() });
const credential = z.object({ credentialId: z.uuid(), name: z.string() });

export const auditCatalog = {
  "auth.signedIn": event({
    actor: ["account"],
    target: "account",
    fields: sessionReference.extend({ methods }),
    visibility: "organization",
  }),
  "auth.signInFailed": event({
    actor: ["anonymous"],
    target: "account",
    fields: z.object({
      reason: z.enum(["invalidCredentials", "invalidSecondFactor", "accountLocked", "clientLocked"]),
      method: z.enum(signInMethods),
    }),
    visibility: "organization",
  }),
  "auth.lockedOut": event({
    actor: ["anonymous"],
    target: "account",
    fields: z.object({
      subject: z.enum(["account", "clientIp"]),
      failures: z.number().int().positive(),
      lockedUntil: z.iso.datetime(),
    }),
    visibility: "organization",
  }),
  "auth.signedOut": event({
    actor: ["account"],
    target: "account",
    fields: sessionReference,
    visibility: "organization",
  }),
  "auth.sessionEnded": event({
    actor: ["account", "system"],
    target: "account",
    fields: sessionReference.extend({
      reason: z.enum(["endedByAccount", "sessionLimit", "replacedOnDevice"]),
    }),
    visibility: "organization",
  }),
  "auth.reauthenticated": event({
    actor: ["account"],
    target: "account",
    fields: sessionReference.extend({ method: z.enum(signInMethods) }),
    visibility: "organization",
  }),
  "auth.reauthenticationFailed": event({
    actor: ["account"],
    target: "account",
    fields: sessionReference.extend({ method: z.enum(signInMethods) }),
    visibility: "organization",
  }),
  "account.created": event({
    actor: ["account", "anonymous", "system"],
    target: "account",
    fields: z.object({
      type: z.string(),
      email: z.string(),
      homeOrganizationId: z.uuid().nullable().optional(),
    }),
    visibility: "organization",
  }),
  "account.passwordChanged": event({
    actor: ["account", "system"],
    target: "account",
    fields: z.object({ endedSessions: z.number().int().nonnegative() }),
    visibility: "organization",
  }),
  "account.passwordResetRequested": event({
    actor: ["anonymous"],
    target: "account",
    fields: z.object({}),
    visibility: "organization",
  }),
  "account.passwordReset": event({
    actor: ["anonymous"],
    target: "account",
    fields: z.object({ endedSessions: z.number().int().nonnegative() }),
    visibility: "organization",
  }),
  "account.emailChangeRequested": event({
    actor: ["account"],
    target: "account",
    fields: z.object({ newEmail: z.string() }),
    visibility: "organization",
  }),
  "account.emailChanged": event({
    actor: ["anonymous", "account"],
    target: "account",
    fields: z.object({ previousEmail: z.string(), newEmail: z.string() }),
    visibility: "organization",
  }),
  "twoFactor.totpAdded": event({
    actor: ["account", "anonymous"],
    target: "account",
    fields: z.object({}),
    visibility: "organization",
  }),
  "twoFactor.totpRemoved": event({
    actor: ["account"],
    target: "account",
    fields: z.object({}),
    visibility: "organization",
  }),
  "twoFactor.passkeyAdded": event({
    actor: ["account"],
    target: "account",
    fields: credential,
    visibility: "organization",
  }),
  "twoFactor.passkeyRemoved": event({
    actor: ["account"],
    target: "account",
    fields: credential,
    visibility: "organization",
  }),
  "twoFactor.recoveryCodesGenerated": event({
    actor: ["account", "anonymous"],
    target: "account",
    fields: z.object({ count: z.number().int().positive() }),
    visibility: "organization",
  }),
  "twoFactor.recoveryCodeUsed": event({
    actor: ["anonymous", "account"],
    target: "account",
    fields: z.object({ remaining: z.number().int().nonnegative() }),
    visibility: "organization",
  }),
  "setup.sessionStarted": event({
    actor: ["anonymous"],
    target: "instance",
    fields: z.object({}),
    visibility: "instance",
  }),
  "setup.stepCompleted": event({
    actor: ["anonymous", "system"],
    target: "setupStep",
    fields: z.object({}),
    visibility: "instance",
  }),
  "setup.keyBackupDownloaded": event({
    actor: ["anonymous"],
    target: "instance",
    fields: z.object({
      masterKeyVersions: z.array(z.number().int()),
      backupKeyVersions: z.array(z.number().int()),
    }),
    visibility: "instance",
  }),
  "setup.completed": event({
    actor: ["anonymous", "system"],
    target: "instance",
    fields: z.object({ through: z.enum(["assistant", "configuration"]) }),
    visibility: "instance",
  }),
  "mail.smtpChanged": event({
    actor: ["account", "anonymous", "system"],
    target: "instance",
    fields: z.object({
      host: z.string(),
      port: z.number().int(),
      security: z.string(),
      username: z.string().nullable(),
      passwordChanged: z.boolean(),
      from: z.string(),
    }),
    visibility: "instance",
  }),
  "mail.testSent": event({
    actor: ["account", "anonymous"],
    target: "instance",
    fields: z.object({ recipient: z.string(), delivered: z.boolean() }),
    visibility: "instance",
  }),
  "settings.changed": event({
    actor: ["account", "anonymous", "system"],
    target: "setting",
    fields: z.object({
      level: z.string(),
      scopeId: z.uuid(),
      action: z.enum(["set", "clear", "lock", "unlock"]),
      value: z.json().optional(),
    }),
    visibility: "organization",
  }),

  "organization.created": event({
    actor: ["account", "anonymous", "system"],
    target: "organization",
    fields: z.object({ name: z.string(), slug: z.string(), language: z.string(), timeZone: z.string() }),
    visibility: "organization",
  }),
  "organization.updated": event({
    actor: ["account", "system"],
    target: "organization",
    fields: z.object({ name: z.string(), slug: z.string(), logoRef: z.string().nullable() }),
    visibility: "organization",
  }),
  "organization.domainAdded": event({
    actor: ["account", "system"],
    target: "organization",
    fields: z.object({ domain: z.string() }),
    visibility: "organization",
  }),
  "organization.domainRemoved": event({
    actor: ["account", "system"],
    target: "organization",
    fields: z.object({ domain: z.string() }),
    visibility: "organization",
  }),
  "membership.added": event({
    actor: ["account", "anonymous", "system"],
    target: "account",
    fields: z.object({ kind: z.string(), expiresAt: z.iso.datetime().nullable() }),
    visibility: "organization",
  }),
  "membership.updated": event({
    actor: ["account", "system"],
    target: "account",
    fields: z.object({ expiresAt: z.iso.datetime().nullable(), responsibleAccountId: z.uuid().nullable() }),
    visibility: "organization",
  }),
  "membership.removed": event({
    actor: ["account", "system"],
    target: "account",
    fields: z.object({ kind: z.string(), reason: z.enum(["removed", "left", "expired"]) }),
    visibility: "organization",
  }),
  "role.created": event({
    actor: ["account", "system"],
    target: "role",
    fields: z.object({ name: z.string(), areas: z.record(z.string(), z.string()) }),
    visibility: "organization",
  }),
  "role.updated": event({
    actor: ["account", "system"],
    target: "role",
    fields: z.object({ name: z.string(), areas: z.record(z.string(), z.string()) }),
    visibility: "organization",
  }),
  "role.deleted": event({
    actor: ["account", "system"],
    target: "role",
    fields: z.object({ name: z.string() }),
    visibility: "organization",
  }),
  "role.assigned": event({
    actor: ["account", "anonymous", "system"],
    target: "roleAssignment",
    fields: z.object({
      role: z.string(),
      customRoleId: z.uuid().nullable(),
      principalKind: z.string(),
      principalId: z.uuid().nullable(),
      expiresAt: z.iso.datetime().nullable(),
    }),
    visibility: "organization",
  }),
  "role.unassigned": event({
    actor: ["account", "system"],
    target: "roleAssignment",
    fields: z.object({
      role: z.string(),
      principalKind: z.string(),
      principalId: z.uuid().nullable(),
      reason: z.enum(["removed", "expired"]),
    }),
    visibility: "organization",
  }),
  "group.created": event({
    actor: ["account", "system"],
    target: "group",
    fields: z.object({ name: z.string() }),
    visibility: "organization",
  }),
  "group.updated": event({
    actor: ["account", "system"],
    target: "group",
    fields: z.object({ name: z.string(), description: z.string() }),
    visibility: "organization",
  }),
  "group.deleted": event({
    actor: ["account", "system"],
    target: "group",
    fields: z.object({ name: z.string() }),
    visibility: "organization",
  }),
  "group.memberAdded": event({
    actor: ["account", "system"],
    target: "group",
    fields: z.object({ accountId: z.uuid(), expiresAt: z.iso.datetime().nullable() }),
    visibility: "organization",
  }),
  "group.memberRemoved": event({
    actor: ["account", "system"],
    target: "group",
    fields: z.object({ accountId: z.uuid(), reason: z.enum(["removed", "expired"]) }),
    visibility: "organization",
  }),
  "group.managerAdded": event({
    actor: ["account", "system"],
    target: "group",
    fields: z.object({ accountId: z.uuid() }),
    visibility: "organization",
  }),
  "group.managerRemoved": event({
    actor: ["account", "system"],
    target: "group",
    fields: z.object({ accountId: z.uuid() }),
    visibility: "organization",
  }),
  "invitation.created": event({
    actor: ["account", "system"],
    target: "invitation",
    fields: z.object({ email: z.string(), kind: z.string(), expiresAt: z.iso.datetime() }),
    visibility: "organization",
  }),
  "invitation.accepted": event({
    actor: ["anonymous", "account"],
    target: "invitation",
    fields: z.object({ accountId: z.uuid(), accountCreated: z.boolean() }),
    visibility: "organization",
  }),
  "invitation.revoked": event({
    actor: ["account", "system"],
    target: "invitation",
    fields: z.object({}),
    visibility: "organization",
  }),
  "guest.responsibleChanged": event({
    actor: ["account", "system"],
    target: "account",
    fields: z.object({ responsibleAccountId: z.uuid().nullable() }),
    visibility: "organization",
  }),
  "account.deactivated": event({
    actor: ["account", "system"],
    target: "account",
    fields: z.object({ endedSessions: z.number().int().nonnegative() }),
    visibility: "organization",
  }),
  "instance.ownershipTransferred": event({
    actor: ["account", "system"],
    target: "account",
    fields: z.object({ previousOwnerId: z.uuid() }),
    visibility: "instance",
  }),
  "breakGlass.started": event({
    actor: ["account"],
    target: "breakGlassAccess",
    fields: z.object({ accountId: z.uuid(), reason: z.string(), expiresAt: z.iso.datetime() }),
    visibility: "organization",
  }),
  "breakGlass.actionAuthorized": event({
    actor: ["account"],
    target: "breakGlassAccess",
    fields: z.object({ action: z.string(), resourceType: z.string(), resourceId: z.string().nullable() }),
    visibility: "organization",
  }),
  "breakGlass.ended": event({
    actor: ["account", "system"],
    target: "breakGlassAccess",
    fields: z.object({ reason: z.enum(["endedByAccount", "expired"]) }),
    visibility: "organization",
  }),
} as const satisfies Record<string, AuditEventDefinition>;

export type AuditEventName = keyof typeof auditCatalog;
export type AuditEventFields<TName extends AuditEventName> = z.input<(typeof auditCatalog)[TName]["fields"]>;
