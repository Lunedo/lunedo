import { accessLevels, instanceAreas, organizationAreas, supportedLanguages } from "@pagehall/server";
import { z } from "zod";

export const uuid = (description: string) => z.uuid().describe(description);

export const timestamp = (description: string) =>
  z.iso.datetime().describe(`${description} ISO 8601 timestamp in UTC.`);

export const inputTimestamp = (description: string) =>
  z.iso
    .datetime({ offset: true })
    .transform((value) => new Date(value))
    .describe(`${description} ISO 8601 timestamp; an offset is allowed.`);

export const optionalExpiry = (description: string) =>
  inputTimestamp(description)
    .nullable()
    .optional()
    .describe(`${description} ISO 8601 timestamp, or null for no expiry. Leave it out to keep the default.`);

const level = z.enum(accessLevels).describe("`view` reads, `manage` also changes.");

function areasShape(areas: readonly string[], scope: string) {
  return Object.fromEntries(
    areas.map((area) => [area, level.optional().describe(`Access to the ${scope} area \`${area}\`.`)]),
  );
}

export const organizationAreasSchema = z
  .object(areasShape(organizationAreas, "organization"))
  .strict()
  .describe("Access level per organization area. Areas that are left out grant nothing.");

export const instanceAreasSchema = z
  .object(areasShape(instanceAreas, "instance"))
  .strict()
  .describe("Access level per instance area. Areas that are left out grant nothing.");

export const organizationIdParams = z.object({ organizationId: uuid("ID of the organization.") }).strict();

export const organizationSchema = z
  .object({
    id: uuid("ID of the organization."),
    name: z.string().describe("Display name, 1 to 100 characters."),
    slug: z.string().describe("Short name used in addresses: lowercase letters, digits and hyphens."),
    logoRef: z.string().nullable().describe("Reference to the uploaded logo, or null."),
    language: z.enum(supportedLanguages).describe("Default language of the organization."),
    timeZone: z.string().describe("Default IANA time zone, for example `Europe/Vienna`."),
    createdAt: timestamp("When the organization was created."),
  })
  .describe("An organization.");

export const exampleOrganization = {
  id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a6b",
  name: "Example Inc.",
  slug: "example-inc",
  logoRef: null,
  language: "en",
  timeZone: "Europe/Vienna",
  createdAt: "2026-10-01T08:00:00.000Z",
};

export const memberSchema = z
  .object({
    accountId: uuid("ID of the account."),
    name: z.string().describe("Display name of the account."),
    email: z.string().nullable().describe("E-mail address, or null for service accounts."),
    accountType: z.string().describe("`standard`, `guest`, `portal` or `service`."),
    kind: z.enum(["member", "collaborator", "guest"]).describe("Kind of membership in the organization."),
    expiresAt: timestamp("When the membership ends, or null.").nullable(),
    responsibleAccountId: uuid("Member responsible for a guest, or null.").nullable(),
    roles: z
      .array(
        z
          .object({
            assignmentId: uuid("ID of the role assignment."),
            role: z.string().describe("Name of the role."),
            customRoleId: uuid("ID of the custom role, or null for a built-in role.").nullable(),
            expiresAt: timestamp("When the assignment ends, or null.").nullable(),
          })
          .describe("A role assigned directly to the account."),
      )
      .describe("Roles assigned directly to the account in this organization."),
  })
  .describe("A member of an organization.");

export const exampleMember = {
  accountId: "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7c",
  name: "Ada Lovelace",
  email: "ada@example.org",
  accountType: "standard",
  kind: "member",
  expiresAt: null,
  responsibleAccountId: null,
  roles: [
    {
      assignmentId: "01929b1e-9e5c-7f40-b16d-5e4f3a2b7c8d",
      role: "administrator",
      customRoleId: null,
      expiresAt: null,
    },
  ],
};

export const groupSchema = z
  .object({
    id: uuid("ID of the group."),
    organizationId: uuid("ID of the organization the group belongs to."),
    name: z.string().describe("Name of the group, unique in the organization, 1 to 100 characters."),
    description: z.string().describe("Description, up to 1000 characters."),
  })
  .describe("A group of accounts.");

export const exampleGroup = {
  id: "01929b1f-0a6d-7a51-827e-6f5a4b3c8d9e",
  organizationId: exampleOrganization.id,
  name: "Editors",
  description: "Everyone who edits the handbook",
};

export const groupDetailsSchema = groupSchema
  .extend({
    members: z
      .array(
        z
          .object({
            accountId: uuid("ID of the member."),
            name: z.string().describe("Display name of the member."),
            expiresAt: timestamp("When the group membership ends, or null.").nullable(),
          })
          .describe("A member of the group."),
      )
      .describe("Members of the group."),
    managers: z
      .array(
        z
          .object({
            accountId: uuid("ID of the manager."),
            name: z.string().describe("Display name of the manager."),
          })
          .describe("A manager of the group."),
      )
      .describe("Accounts that manage the group's members."),
  })
  .describe("A group with its members and managers.");

export const exampleGroupDetails = {
  ...exampleGroup,
  members: [{ accountId: exampleMember.accountId, name: exampleMember.name, expiresAt: null }],
  managers: [{ accountId: exampleMember.accountId, name: exampleMember.name }],
};

export const customRoleSchema = z
  .object({
    id: uuid("ID of the role."),
    scope: z.enum(["instance", "organization"]).describe("Level the role applies to."),
    organizationId: uuid("ID of the organization, or null for instance roles.").nullable(),
    name: z.string().describe("Name of the role, 1 to 100 characters."),
    areas: z
      .record(z.string().describe("Area name."), level)
      .describe("Access level per area. Areas that are left out grant nothing."),
  })
  .describe("A role defined by an administrator.");

export const exampleCustomRole = {
  id: "01929b1f-1b7e-7b62-938f-7a6b5c4d9eaf",
  scope: "organization",
  organizationId: exampleOrganization.id,
  name: "Handbook editors",
  areas: { spaces: "manage", membersAndGroups: "view" },
};

export const roleAssignmentSchema = z
  .object({
    id: uuid("ID of the assignment."),
    scope: z.enum(["instance", "organization"]).describe("Level of the assignment."),
    organizationId: uuid("ID of the organization, or null for instance assignments.").nullable(),
    role: z.string().describe("Name of the role."),
    builtInRole: z
      .enum(["owner", "administrator", "member", "securityAuditor"])
      .nullable()
      .describe("Key of the built-in role, or null for a custom role."),
    customRoleId: uuid("ID of the custom role, or null for a built-in role.").nullable(),
    principalKind: z
      .enum(["account", "group", "organizationMembers", "instanceUsers"])
      .describe("Who receives the role."),
    principalId: uuid("ID of the account or group, or null for all members or all users.").nullable(),
    expiresAt: timestamp("When the assignment ends, or null.").nullable(),
  })
  .describe("A role given to a principal.");

export const exampleRoleAssignment = {
  id: exampleMember.roles[0]?.assignmentId,
  scope: "organization",
  organizationId: exampleOrganization.id,
  role: "Handbook editors",
  builtInRole: null,
  customRoleId: exampleCustomRole.id,
  principalKind: "group",
  principalId: exampleGroup.id,
  expiresAt: null,
};

export const invitationSchema = z
  .object({
    id: uuid("ID of the invitation."),
    organizationId: uuid("ID of the organization."),
    email: z.string().describe("Address the invitation was sent to."),
    kind: z.enum(["member", "collaborator", "guest"]).describe("Kind of membership the invitation grants."),
    role: z.string().nullable().describe("Role given on acceptance, or null."),
    membershipExpiresAt: timestamp("When the resulting membership ends, or null.").nullable(),
    expiresAt: timestamp("When the invitation link stops working."),
  })
  .describe("A pending invitation.");

export const exampleInvitation = {
  id: "01929b1f-2c8f-7c73-a490-8b7c6d5eafb0",
  organizationId: exampleOrganization.id,
  email: "grace@example.org",
  kind: "member",
  role: null,
  membershipExpiresAt: null,
  expiresAt: "2026-10-08T08:00:00.000Z",
};

export const accountSchema = z
  .object({
    id: uuid("ID of the account."),
    type: z.enum(["standard", "guest", "portal", "service"]).describe("Kind of account."),
    state: z
      .enum(["invited", "active", "deactivated", "anonymized", "placeholder"])
      .describe("Lifecycle state of the account."),
    email: z.string().nullable().describe("E-mail address, or null."),
    name: z.string().describe("Display name."),
    homeOrganizationId: uuid("Organization the account belongs to, or null.").nullable(),
    createdAt: timestamp("When the account was created."),
  })
  .describe("An account of the instance.");

export const exampleAccount = {
  id: exampleMember.accountId,
  type: "standard",
  state: "active",
  email: exampleMember.email,
  name: exampleMember.name,
  homeOrganizationId: exampleOrganization.id,
  createdAt: "2026-10-01T08:00:00.000Z",
};

export const settingSchema = z
  .object({
    key: z.string().describe("Key of the setting."),
    value: z.json().describe("Effective value at this level."),
    source: z.string().describe("Level the effective value comes from, or `default`."),
    lockedBy: z.string().nullable().describe("Higher level that locked the setting, or null."),
    locked: z.boolean().describe("Whether this level locks the setting for lower levels."),
    lockable: z.boolean().describe("Whether the setting can be locked."),
    editable: z.boolean().describe("Whether the setting can be changed through the settings endpoint."),
  })
  .describe("A setting with its effective value.");

export const exampleSetting = {
  key: "organizations.membersCreateGroups",
  value: false,
  source: "default",
  lockedBy: null,
  locked: false,
  lockable: true,
  editable: true,
};

export const serviceAccountSchema = z
  .object({
    id: uuid("ID of the service account. Use it as account ID in role assignments and groups."),
    organizationId: uuid("ID of the organization that owns the service account."),
    name: z.string().describe("Display name, 1 to 200 characters."),
    description: z.string().describe("What the service account is for, up to 1000 characters."),
    state: z.string().describe("`active` or `deactivated`."),
    responsibleAccountId: uuid(
      "Member whose permissions bound the service account, or null when that person left.",
    ).nullable(),
    createdAt: timestamp("When the service account was created."),
  })
  .describe("An account for scripts and integrations, without password or sign-in.");

export const exampleServiceAccount = {
  id: "01929b1f-3da0-7d84-b5a1-9c8d7e6fb0c1",
  organizationId: exampleOrganization.id,
  name: "Release bot",
  description: "Publishes release notes",
  state: "active",
  responsibleAccountId: exampleMember.accountId,
  createdAt: "2026-10-01T08:00:00.000Z",
};

export const tokenScopesSchema = z
  .object({
    instance: instanceAreasSchema.optional().describe("Instance areas the token may use."),
    organization: organizationAreasSchema.optional().describe("Organization areas the token may use."),
  })
  .strict()
  .describe(
    "What the token may do. At every request, the token gets the intersection of these scopes and the current permissions of its owner.",
  );

export const apiTokenSchema = z
  .object({
    id: uuid("ID of the token."),
    accountId: uuid("Account the token acts as."),
    organizationId: uuid("Only organization the token works in, or null for all.").nullable(),
    name: z.string().describe("Name chosen by the owner, 1 to 100 characters."),
    prefix: z.string().describe("First characters of the token, to recognize it."),
    scopes: tokenScopesSchema,
    expiresAt: timestamp("When the token stops working, or null if it never expires.").nullable(),
    createdBy: uuid("Account that created the token, or null.").nullable(),
    createdAt: timestamp("When the token was created."),
    lastUsedAt: timestamp("Last use, recorded at most once per minute, or null.").nullable(),
    lastUsedIp: z.string().nullable().describe("Client IP address of the last use, or null."),
  })
  .describe("An API token. The secret itself is shown only once, at creation.");

export const exampleApiToken = {
  id: "01929b1f-4eb1-7e95-86b2-ad9e8f7ac1d2",
  accountId: exampleServiceAccount.id,
  organizationId: exampleOrganization.id,
  name: "CI pipeline",
  prefix: "ph_4fT9xQ",
  scopes: { organization: { spaces: "manage" } },
  expiresAt: "2026-12-30T08:00:00.000Z",
  createdBy: exampleMember.accountId,
  createdAt: "2026-10-01T08:00:00.000Z",
  lastUsedAt: null,
  lastUsedIp: null,
};

export const auditEntrySchema = z
  .object({
    id: uuid("ID of the event."),
    scopeType: z
      .enum(["instance", "organization"])
      .describe("Whether the event belongs to the instance or to an organization."),
    scopeId: uuid("ID of the organization, or the instance ID of all zeros."),
    sequence: z.number().int().describe("Position in the tamper-evident chain of the scope."),
    name: z.string().describe("Event type, for example `role.assigned`."),
    actorType: z.string().describe("`account`, `system` or `anonymous`."),
    actorId: uuid("Account that acted, or null.").nullable(),
    targetType: z.string().describe("Kind of object the event is about."),
    targetId: z.string().nullable().describe("ID of the object, or null."),
    fields: z.json().describe("Event details. Their shape depends on the event type."),
    occurredAt: timestamp("When the event happened."),
    requestId: z.string().nullable().describe("ID of the HTTP request, or null."),
    clientIp: z.string().nullable().describe("Client IP address, or null."),
    userAgent: z.string().nullable().describe("User agent of the client, or null."),
  })
  .describe("An entry of the audit log.");

export const exampleAuditEntry = {
  id: "01929b1f-5fc2-7fa6-97c3-bea0a18bd2e3",
  scopeType: "organization",
  scopeId: exampleOrganization.id,
  sequence: 42,
  name: "role.assigned",
  actorType: "account",
  actorId: exampleMember.accountId,
  targetType: "roleAssignment",
  targetId: exampleRoleAssignment.id,
  fields: { role: "Handbook editors", principalKind: "group", principalId: exampleGroup.id },
  occurredAt: "2026-10-01T08:00:00.000Z",
  requestId: "6f1c2b0e-5d4a-4c3b-9a2f-1e0d9c8b7a6f",
  clientIp: "203.0.113.7",
  userAgent: "curl/8.9.1",
};

export const decisionSchema = z
  .object({
    action: z.string().describe("Name of the action."),
    allowed: z.boolean().describe("Whether the account may perform the action."),
    grants: z
      .array(z.json().describe("Role, membership or rule that allows it."))
      .describe("Why it is allowed."),
    denials: z.array(z.string().describe("Reason code.")).describe("Why it is not allowed."),
  })
  .describe("Authorization decision for one action.");

export const exampleDecision = {
  action: "organization.spaces.manage",
  allowed: true,
  grants: [
    { kind: "role", role: { customRoleId: exampleCustomRole.id }, via: { type: "account" }, expiresAt: null },
  ],
  denials: [],
};
