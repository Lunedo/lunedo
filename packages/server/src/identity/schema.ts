import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "../accounts/schema.js";
import { encrypted } from "../crypto/encrypted-column.js";
import { bytes, primaryId, timestamps } from "../database/columns.js";
import { builtInRole, customRoles, groups } from "../organizations/access-schema.js";
import { organizations } from "../organizations/schema.js";

const timestampColumn = () => timestamp({ withTimezone: true, mode: "date" });

export const identityProviderTypes = ["oidc", "saml", "ldap"] as const;
export const identityProviderPresets = ["entraId", "google", "generic", "adfs", "activeDirectory"] as const;
export const identityCredentialKinds = [
  "clientSecret",
  "certificate",
  "samlSigning",
  "bindPassword",
] as const;
export const providerFlowPurposes = ["signIn", "reauthentication", "test", "linkConfirmation"] as const;

export const identityProviderType = pgEnum("identity_provider_type", identityProviderTypes);
export const identityProviderPreset = pgEnum("identity_provider_preset", identityProviderPresets);
export const identityCredentialKind = pgEnum("identity_credential_kind", identityCredentialKinds);
export const providerFlowPurpose = pgEnum("provider_flow_purpose", providerFlowPurposes);

export const identityProviders = pgTable(
  "identity_providers",
  {
    id: primaryId(),
    type: identityProviderType().notNull(),
    preset: identityProviderPreset().notNull(),
    name: text().notNull(),
    config: jsonb(),
    draft: jsonb(),
    setupCompletedAt: timestampColumn(),
    deactivatedAt: timestampColumn(),
    groupsClaimSeenAt: timestampColumn(),
    groupsClaimMissingSince: timestampColumn(),
    ...timestamps(),
  },
  (table) => [
    check(
      "identity_providers_config_or_draft",
      sql`(${table.config} is null) = (${table.draft} is not null)`,
    ),
  ],
);

export const identityProviderDomains = pgTable(
  "identity_provider_domains",
  {
    domain: text().primaryKey(),
    providerId: uuid()
      .notNull()
      .references(() => identityProviders.id, { onDelete: "cascade" }),
    createdAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [index().on(table.providerId)],
);

export const identityProviderCredentials = pgTable(
  "identity_provider_credentials",
  {
    id: primaryId(),
    providerId: uuid()
      .notNull()
      .references(() => identityProviders.id, { onDelete: "cascade" }),
    kind: identityCredentialKind().notNull(),
    secret: encrypted().notNull(),
    certificate: text(),
    keyId: text(),
    expiresAt: timestampColumn(),
    chosenAt: timestampColumn(),
    notifiedThirtyDaysAt: timestampColumn(),
    notifiedSevenDaysAt: timestampColumn(),
    createdAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [index().on(table.providerId), index().on(table.expiresAt)],
);

export const identityProviderLogos = pgTable("identity_provider_logos", {
  providerId: uuid()
    .primaryKey()
    .references(() => identityProviders.id, { onDelete: "cascade" }),
  contentType: text().notNull(),
  data: bytes().notNull(),
  ref: text().notNull(),
  ...timestamps(),
});

export const identities = pgTable(
  "identities",
  {
    id: primaryId(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    providerId: uuid()
      .notNull()
      .references(() => identityProviders.id, { onDelete: "cascade" }),
    subject: text().notNull(),
    email: text(),
    emailVerified: boolean().notNull().default(false),
    signInName: text(),
    displayName: text(),
    lastSignInAt: timestampColumn(),
    groupsReadAt: timestampColumn(),
    groupsReadFailedAt: timestampColumn(),
    groupsWithheldNotifiedAt: timestampColumn(),
    scimUserName: text(),
    scimExternalId: text(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex().on(table.providerId, table.subject),
    index().on(table.accountId),
    uniqueIndex("identities_provider_scim_user_name_unique")
      .on(table.providerId, sql`lower(${table.scimUserName})`)
      .where(sql`${table.scimUserName} is not null`),
  ],
);

export const managedSources = ["identity", "domain"] as const;
export type ManagedSource = (typeof managedSources)[number];
export const managedSource = pgEnum("managed_account_source", managedSources);

export const managedAccounts = pgTable(
  "managed_accounts",
  {
    accountId: uuid()
      .primaryKey()
      .references(() => accounts.id, { onDelete: "cascade" }),
    providerId: uuid()
      .notNull()
      .references(() => identityProviders.id, { onDelete: "cascade" }),
    source: managedSource().notNull(),
    since: timestampColumn().notNull().defaultNow(),
  },
  (table) => [index().on(table.providerId)],
);

export const scimTokens = pgTable(
  "scim_tokens",
  {
    id: primaryId(),
    providerId: uuid()
      .notNull()
      .references(() => identityProviders.id, { onDelete: "cascade" }),
    tokenHash: bytes().notNull(),
    prefix: text().notNull(),
    expiresAt: timestampColumn(),
    lastUsedAt: timestampColumn(),
    createdBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    createdAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [uniqueIndex().on(table.tokenHash), index().on(table.providerId)],
);

export const providerFlows = pgTable(
  "provider_flows",
  {
    id: primaryId(),
    purpose: providerFlowPurpose().notNull(),
    providerId: uuid()
      .notNull()
      .references(() => identityProviders.id, { onDelete: "cascade" }),
    stateHash: bytes().notNull(),
    browserHash: bytes().notNull(),
    nonce: text(),
    codeVerifier: text(),
    requestId: text(),
    samlResponse: text(),
    redirectUri: text().notNull(),
    consumedAt: timestampColumn(),
    sessionId: uuid(),
    challengeId: uuid(),
    returnTo: text(),
    result: jsonb(),
    expiresAt: timestampColumn().notNull(),
    createdAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [uniqueIndex().on(table.stateHash), index().on(table.expiresAt)],
);

export const signInRefusalReasons = [
  "accountCreationDisabled",
  "domainNotAllowed",
  "emailNotVerified",
  "groupRequired",
  "accountInactive",
  "linkDeclined",
  "linkUnavailable",
  "invalidResponse",
  "secondFactorMissing",
  "linkAmbiguous",
] as const;
export type SignInRefusalReason = (typeof signInRefusalReasons)[number];
export const signInRefusalReason = pgEnum("sign_in_refusal_reason", signInRefusalReasons);

export const signInRefusals = pgTable(
  "sign_in_refusals",
  {
    id: primaryId(),
    reference: text().notNull(),
    providerId: uuid().references(() => identityProviders.id, { onDelete: "set null" }),
    reason: signInRefusalReason().notNull(),
    subject: text(),
    email: text(),
    displayName: text(),
    accountId: uuid().references(() => accounts.id, { onDelete: "set null" }),
    createdAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [uniqueIndex().on(table.reference), index().on(table.createdAt)],
);

export const providerLogoutTokens = pgTable(
  "provider_logout_tokens",
  {
    providerId: uuid()
      .notNull()
      .references(() => identityProviders.id, { onDelete: "cascade" }),
    tokenId: text().notNull(),
    expiresAt: timestampColumn().notNull(),
  },
  (table) => [primaryKey({ columns: [table.providerId, table.tokenId] }), index().on(table.expiresAt)],
);

export const identityProviderSecrets = pgTable("identity_provider_secrets", {
  providerId: uuid()
    .primaryKey()
    .references(() => identityProviders.id, { onDelete: "cascade" }),
  directoryKey: encrypted().notNull(),
  ...timestamps(),
});

export const providerGroups = pgTable(
  "provider_groups",
  {
    id: primaryId(),
    providerId: uuid()
      .notNull()
      .references(() => identityProviders.id, { onDelete: "cascade" }),
    externalId: text().notNull(),
    name: text(),
    seenAt: timestampColumn(),
    missingSince: timestampColumn(),
    ...timestamps(),
  },
  (table) => [uniqueIndex().on(table.providerId, table.externalId)],
);

export const identityGroups = pgTable(
  "identity_groups",
  {
    identityId: uuid()
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    groupId: uuid()
      .notNull()
      .references(() => providerGroups.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.identityId, table.groupId] }), index().on(table.groupId)],
);

export const mappingTargets = ["organization", "instance"] as const;
export const mappingTarget = pgEnum("mapping_target", mappingTargets);

export const mappingRules = pgTable(
  "mapping_rules",
  {
    id: primaryId(),
    providerId: uuid()
      .notNull()
      .references(() => identityProviders.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    groupId: uuid()
      .notNull()
      .references(() => providerGroups.id, { onDelete: "cascade" }),
    target: mappingTarget().notNull(),
    organizationId: uuid().references(() => organizations.id, { onDelete: "cascade" }),
    builtInRole: builtInRole(),
    customRoleId: uuid().references(() => customRoles.id, { onDelete: "cascade" }),
    lunedoGroupId: uuid("pagehall_group_id").references(() => groups.id, { onDelete: "set null" }),
    homeOrganization: boolean().notNull().default(false),
    ...timestamps(),
  },
  (table) => [
    index().on(table.providerId),
    index().on(table.groupId),
    check(
      "mapping_rules_target",
      sql`(${table.target} = 'organization') = (${table.organizationId} is not null)`,
    ),
    check(
      "mapping_rules_instance",
      sql`${table.target} = 'organization' or (${table.lunedoGroupId} is null and not ${table.homeOrganization} and (${table.builtInRole} is not null or ${table.customRoleId} is not null))`,
    ),
  ],
);

export const managedGroups = pgTable("managed_groups", {
  groupId: uuid()
    .primaryKey()
    .references(() => groups.id, { onDelete: "cascade" }),
  providerId: uuid()
    .notNull()
    .references(() => identityProviders.id, { onDelete: "cascade" }),
  providerGroupId: uuid()
    .notNull()
    .references(() => providerGroups.id, { onDelete: "cascade" }),
  createdAt: timestampColumn().notNull().defaultNow(),
});

export const providerGrantKinds = ["membership", "role", "groupMember"] as const;
export const providerGrantKind = pgEnum("provider_grant_kind", providerGrantKinds);

export const providerGrants = pgTable(
  "provider_grants",
  {
    id: primaryId(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    kind: providerGrantKind().notNull(),
    key: text().notNull(),
    organizationId: uuid().references(() => organizations.id, { onDelete: "cascade" }),
    roleAssignmentId: uuid(),
    groupId: uuid().references(() => groups.id, { onDelete: "cascade" }),
    createdAt: timestampColumn().notNull().defaultNow(),
  },
  (table) => [uniqueIndex().on(table.accountId, table.key)],
);

export const providerDeactivations = pgTable("provider_deactivations", {
  accountId: uuid()
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  providerId: uuid()
    .notNull()
    .references(() => identityProviders.id, { onDelete: "cascade" }),
  createdAt: timestampColumn().notNull().defaultNow(),
});

export const syncTriggers = ["schedule", "manual", "scim", "reconciliation", "signIn"] as const;
export const syncTrigger = pgEnum("provider_sync_trigger", syncTriggers);
export const syncStatuses = ["running", "succeeded", "warnings", "failed", "cancelled"] as const;
export const syncStatus = pgEnum("provider_sync_status", syncStatuses);

export const providerSyncRuns = pgTable(
  "provider_sync_runs",
  {
    id: primaryId(),
    providerId: uuid()
      .notNull()
      .references(() => identityProviders.id, { onDelete: "cascade" }),
    trigger: syncTrigger().notNull(),
    status: syncStatus().notNull().default("running"),
    startedAt: timestampColumn().notNull().defaultNow(),
    heartbeatAt: timestampColumn().notNull().defaultNow(),
    cancelRequestedAt: timestampColumn(),
    finishedAt: timestampColumn(),
    changes: jsonb().notNull().default([]),
    warnings: jsonb().notNull().default([]),
    error: text(),
    heldDeactivations: integer(),
    confirmedAt: timestampColumn(),
    confirmedBy: uuid().references(() => accounts.id, { onDelete: "set null" }),
    confirmedRunId: uuid(),
  },
  (table) => [
    index().on(table.providerId, table.startedAt),
    uniqueIndex("provider_sync_runs_running").on(table.providerId).where(sql`${table.status} = 'running'`),
  ],
);

export const samlMetadata = pgTable("saml_metadata", {
  providerId: uuid()
    .primaryKey()
    .references(() => identityProviders.id, { onDelete: "cascade" }),
  xml: text().notNull(),
  entityId: text().notNull(),
  ssoUrl: text().notNull(),
  certificates: jsonb().$type<string[]>().notNull(),
  fetchedAt: timestampColumn().notNull(),
  refreshFailedAt: timestampColumn(),
  refreshError: text(),
  ...timestamps(),
});

export const samlAssertions = pgTable(
  "saml_assertions",
  {
    providerId: uuid()
      .notNull()
      .references(() => identityProviders.id, { onDelete: "cascade" }),
    assertionId: text().notNull(),
    expiresAt: timestampColumn().notNull(),
  },
  (table) => [primaryKey({ columns: [table.providerId, table.assertionId] }), index().on(table.expiresAt)],
);

export const identityProviderCaCertificates = pgTable("identity_provider_ca_certificates", {
  providerId: uuid()
    .primaryKey()
    .references(() => identityProviders.id, { onDelete: "cascade" }),
  certificates: text().notNull(),
  fingerprint: text().notNull(),
  subject: text().notNull(),
  expiresAt: timestampColumn().notNull(),
  ...timestamps(),
});
