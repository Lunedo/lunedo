import { z } from "zod";
import {
  accountSchema,
  exampleAccount,
  exampleOrganization,
  organizationSchema,
  timestamp,
  uuid,
} from "./schemas.js";

const builtInRole = z
  .enum(["owner", "administrator", "member", "securityAuditor"])
  .nullable()
  .describe("Key of the built-in role, or null for a custom role.");

export const administeredAccountSchema = accountSchema
  .extend({
    lastSignInAt: timestamp("When the account signed in last, or null.").nullable(),
    twoFactorActive: z.boolean().describe("Whether the account has an authenticator app or a passkey."),
    instanceRoles: z
      .array(
        z
          .object({
            builtInRole,
            customRoleId: uuid("ID of the custom instance role, or null.").nullable(),
            name: z.string().nullable().describe("Name of the custom role, or null for a built-in role."),
          })
          .describe("An instance role the account holds."),
      )
      .describe("Instance roles of the account, the instance owner first."),
    organizations: z
      .array(
        z
          .object({
            id: uuid("ID of the organization."),
            name: z.string().describe("Name of the organization."),
            home: z.boolean().describe("Whether this is the home organization of the account."),
          })
          .describe("An organization the account is a member, collaborator or guest of."),
      )
      .describe("Current memberships of the account, the home organization first."),
  })
  .describe("An account of the instance with what administrators need to see.");

export const exampleAdministeredAccount = {
  ...exampleAccount,
  lastSignInAt: "2026-10-01T09:30:00.000Z",
  twoFactorActive: true,
  instanceRoles: [{ builtInRole: "securityAuditor", customRoleId: null, name: null }],
  organizations: [{ id: exampleOrganization.id, name: exampleOrganization.name, home: true }],
};

export const administeredOrganizationSchema = organizationSchema
  .extend({
    owners: z
      .array(z.object({ id: uuid("ID of the owner."), name: z.string().describe("Name of the owner.") }))
      .describe("Owners of the organization, by name."),
    memberCount: z.number().int().describe("Number of active members, collaborators and guests."),
    domains: z.array(z.string()).describe("E-mail domains of the organization."),
  })
  .describe("An organization with what instance administrators need to see.");

export const exampleAdministeredOrganization = {
  ...exampleOrganization,
  owners: [{ id: exampleAccount.id, name: exampleAccount.name }],
  memberCount: 42,
  domains: ["example.com"],
};

export const accountDetailSchema = z
  .object({
    account: administeredAccountSchema,
    memberships: z
      .array(
        z
          .object({
            organizationId: uuid("ID of the organization."),
            name: z.string().describe("Name of the organization."),
            kind: z.enum(["member", "collaborator", "guest"]).describe("Kind of membership."),
            expiresAt: timestamp("When the membership ends, or null.").nullable(),
            since: timestamp("When the account joined the organization."),
            home: z.boolean().describe("Whether this is the home organization of the account."),
            roles: z
              .array(
                z
                  .object({
                    assignmentId: uuid(
                      "ID of the assignment, or null when the role comes from the membership.",
                    ).nullable(),
                    builtInRole,
                    customRoleId: uuid("ID of the custom role, or null.").nullable(),
                    name: z.string().nullable().describe("Name of the custom role, or null."),
                    via: z
                      .enum([
                        "account",
                        "group",
                        "organizationMembers",
                        "instanceUsers",
                        "membership",
                        "breakGlass",
                      ])
                      .describe("How the account holds the role."),
                    groupName: z
                      .string()
                      .nullable()
                      .describe("Name of the group the role comes through, or null."),
                    expiresAt: timestamp("When the role ends, or null.").nullable(),
                  })
                  .describe("A role in the organization."),
              )
              .describe("Roles the account holds in the organization."),
          })
          .describe("A membership."),
      )
      .describe("Organizations of the account, by name."),
    sessions: z
      .array(
        z
          .object({
            id: uuid("ID of the session."),
            kind: z
              .enum(["full", "secondFactorSetup"])
              .describe("Full session, or one that can only set up a second factor."),
            methods: z.array(z.string()).describe("How the session signed in."),
            browser: z.string().nullable().describe("Browser, or null."),
            operatingSystem: z.string().nullable().describe("Operating system, or null."),
            clientIp: z.string().nullable().describe("IP address at sign-in, or null."),
            createdAt: timestamp("When the session started."),
            lastUsedAt: timestamp("When the session was used last."),
          })
          .describe("An active session."),
      )
      .describe("Active sessions, most recently used first."),
    tokens: z
      .array(
        z
          .object({
            id: uuid("ID of the token."),
            name: z.string().describe("Name of the token."),
            prefix: z.string().describe("Visible start of the token."),
            organizationId: uuid("Organization the token is limited to, or null.").nullable(),
            expiresAt: timestamp("When the token expires, or null.").nullable(),
            lastUsedAt: timestamp("When the token was used last, or null.").nullable(),
            createdAt: timestamp("When the token was created."),
          })
          .describe("An active API token."),
      )
      .describe("Active personal API tokens of the account."),
    twoFactor: z
      .object({
        totp: z.boolean().describe("Whether an authenticator app is set up."),
        passkeys: z.number().int().describe("Number of passkeys."),
        recoveryCodes: z.number().int().describe("Number of unused recovery codes."),
      })
      .describe("Second factors of the account."),
    personalSpaceKey: z.string().nullable().describe("Key of the personal space of the account, or null."),
  })
  .describe("An account with its memberships, roles, sessions, tokens and second factors.");
