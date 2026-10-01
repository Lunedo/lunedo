import { z } from "zod";
import type { PrincipalType } from "../accounts/principal.js";

export const auditTargetTypes = ["account", "instance", "setting", "setupStep"] as const;
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
    fields: z.object({ type: z.string(), email: z.string() }),
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
} as const satisfies Record<string, AuditEventDefinition>;

export type AuditEventName = keyof typeof auditCatalog;
export type AuditEventFields<TName extends AuditEventName> = z.input<(typeof auditCatalog)[TName]["fields"]>;
