import { accessLevels, instanceAreas, organizationAreas, supportedLanguages } from "@lunedo/server";
import { accentColors, idSchema } from "@lunedo/shared";
import { z } from "zod";

export const uuid = (description: string) => idSchema.describe(description);

export const EXTENSIBLE_ENUM = "x-extensible-enum";

export function extensibleEnum<const T extends readonly [string, ...string[]]>(
  values: T,
  description: string,
) {
  return z.enum(values).meta({
    description: `${description} New values can be added in later versions; handle unknown values.`,
    [EXTENSIBLE_ENUM]: [...values],
  });
}

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
    accentColor: z
      .enum(accentColors)
      .describe("Accent color from the palette, from the setting `branding.accentColor`."),
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
  accentColor: "petrol",
  createdAt: "2026-10-01T08:00:00.000Z",
};

export const pictureRefField = z
  .string()
  .nullable()
  .describe(
    "Version of the profile picture, or null without one. Changes whenever the picture changes; load the picture from `GET /api/v1/accounts/{accountId}/picture`.",
  );

export const jobTitleField = z
  .string()
  .nullable()
  .describe("Job title the person entered on their profile, or null.");

export const memberSchema = z
  .object({
    accountId: uuid("ID of the account."),
    name: z.string().describe("Display name of the account."),
    jobTitle: jobTitleField,
    pictureRef: pictureRefField,
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
    groups: z
      .array(
        z
          .object({ id: uuid("ID of the group."), name: z.string().describe("Name of the group.") })
          .describe("A group of the organization the account belongs to."),
      )
      .describe("Groups of this organization the account belongs to, ordered by name."),
    twoFactorActive: z
      .boolean()
      .describe("Whether the account has a confirmed authenticator app or a passkey."),
    lastActiveAt: timestamp("When the account was last active in Lunedo, or null.").nullable(),
  })
  .describe("A member of an organization.");

export const exampleMember = {
  accountId: "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7c",
  name: "Ada Lovelace",
  jobTitle: "Head of Engineering",
  pictureRef: "5f2b8c1d9a0e4b7c",
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
  groups: [{ id: "01929b1e-7a3b-7c2d-8e1f-0a9b8c7d6e5f", name: "Engineering" }],
  twoFactorActive: true,
  lastActiveAt: "2026-10-24T08:15:00.000Z",
};

export const groupSchema = z
  .object({
    id: uuid("ID of the group."),
    organizationId: uuid("ID of the organization the group belongs to."),
    name: z.string().describe("Name of the group, unique in the organization, 1 to 100 characters."),
    description: z.string().describe("Description, up to 1000 characters."),
    managedBy: z
      .object({
        providerId: uuid("ID of the identity provider."),
        providerName: z.string().describe("Name of the identity provider."),
      })
      .nullable()
      .optional()
      .describe(
        "The identity provider that manages the members of a synchronized group, or null. Members of such a group cannot be changed in Lunedo; its permissions can.",
      ),
    formerlySynchronizedFrom: z
      .string()
      .nullable()
      .optional()
      .describe(
        "Name of the removed identity provider this group was synchronized from, or null. Such a group is an ordinary group now.",
      ),
    memberCount: z
      .number()
      .int()
      .optional()
      .describe("Number of active accounts in the group. Only in lists of groups."),
  })
  .describe("A group of accounts.");

export const exampleGroup = {
  id: "01929b1f-0a6d-7a51-827e-6f5a4b3c8d9e",
  organizationId: exampleOrganization.id,
  name: "Editors",
  description: "Everyone who edits the handbook",
};

export const groupMemberSchema = z
  .object({
    accountId: uuid("ID of the member."),
    name: z.string().describe("Display name of the member."),
    jobTitle: jobTitleField,
    pictureRef: pictureRefField,
    expiresAt: timestamp("When the group membership ends, or null.").nullable(),
  })
  .describe("A member of the group.");

export const exampleGroupMember = {
  accountId: exampleMember.accountId,
  name: exampleMember.name,
  jobTitle: exampleMember.jobTitle,
  pictureRef: exampleMember.pictureRef,
  expiresAt: null,
};

export const groupDetailsSchema = groupSchema
  .extend({
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
  .describe("A group with its managers. Its members are listed separately.");

export const exampleGroupDetails = {
  ...exampleGroup,
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
    defaultValue: z.json().describe("Value that applies when no level sets one."),
    source: z.string().describe("Level the effective value comes from, or `default`."),
    lockedBy: z.string().nullable().describe("Higher level that locked the setting, or null."),
    locked: z.boolean().describe("Whether this level locks the setting for lower levels."),
    lockable: z.boolean().describe("Whether the setting can be locked."),
    levelsBelow: z
      .array(z.string())
      .describe("Lower levels where the setting can be set. A lock at this level applies to them."),
    editable: z.boolean().describe("Whether the setting can be changed through the settings endpoint."),
    maximum: z
      .json()
      .describe(
        "Highest value allowed, set for the instance, or null when the setting has no maximum. `unlimited` allows any value.",
      ),
    levels: z
      .array(
        z
          .object({
            level: z.string().describe("The level: `instance`, `organization`, `space` or `user`."),
            value: z.json().describe("Value stored at this level, or null."),
            locked: z.boolean().describe("Whether this level locks the setting."),
            effective: z
              .boolean()
              .describe(
                "False when a lock above or a stricter value above makes this level's value ineffective.",
              ),
          })
          .describe("The state of the setting at one level."),
      )
      .describe("Every level the setting applies to, from the instance down to this level."),
  })
  .describe("A setting with its effective value and where it comes from.");

export const exampleSetting = {
  key: "organizations.membersCreateGroups",
  value: false,
  defaultValue: false,
  source: "default",
  lockedBy: null,
  locked: false,
  lockable: true,
  levelsBelow: ["organization"],
  editable: true,
  maximum: null,
  levels: [
    { level: "instance", value: null, locked: false, effective: true },
    { level: "organization", value: null, locked: false, effective: true },
  ],
};

export const serviceAccountSchema = z
  .object({
    id: uuid("ID of the service account. Use it as account ID in role assignments and groups."),
    organizationId: uuid("ID of the organization that owns the service account."),
    name: z.string().describe("Display name, 1 to 200 characters."),
    description: z.string().describe("What the service account is for, up to 1000 characters."),
    state: z.string().describe("`active` or `deactivated`."),
    responsibleAccountIds: z
      .array(uuid("ID of a responsible member."))
      .describe(
        "Members who receive reminders and notices about the service account. They grant no permissions and limit none.",
      ),
    unattended: z
      .boolean()
      .describe("True when the service account has no responsible person. Its permissions stay unchanged."),
    createdAt: timestamp("When the service account was created."),
  })
  .describe("An account for scripts and integrations, without password or sign-in.");

export const exampleServiceAccount = {
  id: "01929b1f-3da0-7d84-b5a1-9c8d7e6fb0c1",
  organizationId: exampleOrganization.id,
  name: "Release bot",
  description: "Publishes release notes",
  state: "active",
  responsibleAccountIds: [exampleMember.accountId],
  unattended: false,
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

export const contentLevelSchema = z
  .enum(["read", "draft", "publish"])
  .describe(
    "What the token may do with content: `read` only reads; `draft` also creates articles and saves drafts of knowledge base articles without publishing them; `publish` writes and publishes like its account. The token never does more than its account may.",
  );

export const apiTokenSchema = z
  .object({
    id: uuid("ID of the token."),
    accountId: uuid("Account the token acts as."),
    organizationId: uuid("Only organization the token works in, or null for all.").nullable(),
    name: z.string().describe("Name chosen by the owner, 1 to 100 characters."),
    prefix: z.string().describe("First characters of the token, to recognize it."),
    scopes: tokenScopesSchema,
    contentLevel: contentLevelSchema,
    knowledgeBaseIds: z
      .array(uuid("ID of a knowledge base."))
      .nullable()
      .describe(
        "Knowledge bases the token is limited to, or null when it reaches all content of its account.",
      ),
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
  prefix: "ld_4fT9xQ",
  scopes: { organization: { spaces: "manage" } },
  contentLevel: "draft" as const,
  knowledgeBaseIds: ["01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a10"],
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
    labelKey: z
      .string()
      .describe("Translation key of the action, `audit.events.` followed by the event type."),
    changeKind: z
      .enum(["setting", "fields"])
      .describe("How `changes` reads: a setting value or lock, or changed fields."),
    actor: z
      .object({
        type: z.string().describe("`account`, `system` or `anonymous`."),
        id: z.string().nullable().describe("ID of the account, or null."),
        name: z.string().nullable().describe("Name of the account when the event happened, or null."),
        former: z
          .boolean()
          .describe("Whether the account was anonymized; its name and other personal data are gone."),
        serviceAccount: z.boolean().describe("Whether the account is a service account."),
        token: z
          .string()
          .nullable()
          .describe("Name of the API token the account acted with, or null when it acted without one."),
      })
      .describe("Who acted."),
    target: z
      .object({
        type: z.string().describe("Kind of object."),
        id: z.string().nullable().describe("ID of the object, or for settings the setting key."),
        name: z.string().nullable().describe("Name of the object when the event happened, or null."),
        former: z
          .boolean()
          .describe(
            "Whether the object is an anonymized account; its name and other personal data are gone.",
          ),
      })
      .describe("What the event is about."),
    scope: z
      .object({
        type: z
          .enum(["instance", "organization", "account"])
          .describe("Instance, organization, or the account for events about one person's own account."),
        id: z.string().nullable().describe("ID of the organization or account, null for the instance."),
        name: z
          .string()
          .nullable()
          .describe("Name of the organization or account when the event happened, or null."),
      })
      .describe("Where the event happened."),
    changes: z
      .array(
        z
          .object({
            property: z.string().describe("Changed property or field."),
            old: z.json().describe("Value before, or null when unknown or not set."),
            new: z.json().describe("Value after, or null when removed."),
          })
          .describe("One change."),
      )
      .describe("What changed, readable without the raw fields."),
    references: z
      .record(z.string(), z.string())
      .describe("Names of accounts, organizations, groups and roles that the fields refer to, by ID."),
    formerAccounts: z
      .array(z.string())
      .describe("Anonymized accounts the event refers to, shown as former users with their ID."),
    peopleHidden: z
      .boolean()
      .describe(
        "Whether the people involved are left out because the event concerns a confidential space the reader is not a member of. The actor, referenced accounts and their names are then empty.",
      ),
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
  labelKey: "audit.events.role.assigned",
  changeKind: "fields",
  actor: {
    type: "account",
    id: exampleMember.accountId,
    name: "Olivia Owner",
    former: false,
    serviceAccount: false,
    token: null,
  },
  target: { type: "roleAssignment", id: exampleRoleAssignment.id, name: null, former: false },
  scope: { type: "organization", id: exampleOrganization.id, name: "Platform Team" },
  changes: [
    { property: "role", old: null, new: "Handbook editors" },
    { property: "principalKind", old: null, new: "group" },
    { property: "principalId", old: null, new: exampleGroup.id },
  ],
  references: { [exampleGroup.id]: "Editors" },
  formerAccounts: [],
  peopleHidden: false,
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
