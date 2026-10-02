import {
  boolean,
  index,
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

const timestampColumn = () => timestamp({ withTimezone: true, mode: "date" });

export const identityProviderTypes = ["oidc"] as const;
export const identityProviderPresets = ["entraId", "google", "generic"] as const;
export const identityCredentialKinds = ["clientSecret", "certificate"] as const;
export const providerFlowPurposes = ["signIn", "reauthentication", "test"] as const;

export const identityProviderType = pgEnum("identity_provider_type", identityProviderTypes);
export const identityProviderPreset = pgEnum("identity_provider_preset", identityProviderPresets);
export const identityCredentialKind = pgEnum("identity_credential_kind", identityCredentialKinds);
export const providerFlowPurpose = pgEnum("provider_flow_purpose", providerFlowPurposes);

export const identityProviders = pgTable("identity_providers", {
  id: primaryId(),
  type: identityProviderType().notNull(),
  preset: identityProviderPreset().notNull(),
  name: text().notNull(),
  config: jsonb().notNull(),
  ...timestamps(),
});

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
    ...timestamps(),
  },
  (table) => [uniqueIndex().on(table.providerId, table.subject), index().on(table.accountId)],
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
    nonce: text().notNull(),
    codeVerifier: text().notNull(),
    redirectUri: text().notNull(),
    consumedAt: timestampColumn(),
    sessionId: uuid(),
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
