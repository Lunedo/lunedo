import { z } from "zod";
import { domainSchema, emailSchema, idSchema } from "./validation.js";

export const identityProviderTypes = ["oidc", "saml", "ldap"] as const;
export type IdentityProviderType = (typeof identityProviderTypes)[number];
export const identityProviderPresets = ["entraId", "google", "generic", "adfs", "activeDirectory"] as const;
export type IdentityProviderPreset = (typeof identityProviderPresets)[number];

export const idTokenAlgorithms = [
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
] as const;

export const emailSources = ["email", "userPrincipalName", "graphMail"] as const;
export const signInNameSources = ["preferredUsername", "userPrincipalName", "email"] as const;

export const ENTRA_AUTHORITY = "https://login.microsoftonline.com";
export const GOOGLE_ISSUER = "https://accounts.google.com";
export const MICROSOFT_GRAPH = "https://graph.microsoft.com";
export const GOOGLE_DIRECTORY = "https://admin.googleapis.com";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const SYNC_INTERVAL_MINUTES = { minimum: 15, default: 60, maximum: 1440 } as const;
export const googleDirectoryMethods = ["adminRole", "delegation"] as const;
export type GoogleDirectoryMethod = (typeof googleDirectoryMethods)[number];

const claimName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_:./-]+$/, "must be a claim name");

const tenantIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    "must be the tenant ID of one tenant",
  );

const httpUrl = z
  .url({ protocol: /^https?$/ })
  .max(2048)
  .transform((value) => value.replace(/\/+$/, ""));

const issuerUrl = z.url({ protocol: /^https?$/ }).max(2048);

const accountCreationSchema = z
  .object({
    enabled: z.boolean().default(false),
    requiredGroups: z.array(z.string().trim().min(1).max(256)).max(50).default([]),
  })
  .strict();

const syncSchema = z
  .object({
    intervalMinutes: z
      .number()
      .int()
      .min(SYNC_INTERVAL_MINUTES.minimum)
      .max(SYNC_INTERVAL_MINUTES.maximum)
      .default(SYNC_INTERVAL_MINUTES.default),
  })
  .strict();

export const secondFactorModes = ["provider", "providerProof", "pagehall"] as const;
export type SecondFactorMode = (typeof secondFactorModes)[number];

const secondFactorSchema = z
  .object({
    mode: z.enum(secondFactorModes).default("provider"),
    proofValues: z.array(z.string().trim().min(1).max(50)).min(1).max(20).default(["mfa"]),
  })
  .strict();

const commonShape = {
  clientId: z.string().trim().min(1).max(500),
  domains: z.array(domainSchema).max(50).default([]),
  idTokenAlgorithm: z.enum(idTokenAlgorithms).default("RS256"),
  accountCreation: accountCreationSchema.default({ enabled: false, requiredGroups: [] }),
  sync: syncSchema.default({ intervalMinutes: SYNC_INTERVAL_MINUTES.default }),
  secondFactor: secondFactorSchema.default({ mode: "provider", proofValues: ["mfa"] }),
};

export const entraIdConfigSchema = z
  .object({
    preset: z.literal("entraId"),
    ...commonShape,
    tenantId: tenantIdSchema,
    authority: httpUrl.default(ENTRA_AUTHORITY),
    graphUrl: httpUrl.default(MICROSOFT_GRAPH),
    emailSource: z.enum(emailSources).default("email"),
    signInNameSource: z.enum(signInNameSources).default("userPrincipalName"),
  })
  .strict();

export const googleConfigSchema = z
  .object({
    preset: z.literal("google"),
    ...commonShape,
    domains: z.array(domainSchema).min(1).max(50),
    issuer: issuerUrl.default(GOOGLE_ISSUER),
    directory: z
      .object({
        method: z.enum(googleDirectoryMethods).default("adminRole"),
        adminEmail: emailSchema.nullable().default(null),
        readUsers: z.boolean().default(false),
        url: httpUrl.default(GOOGLE_DIRECTORY),
        tokenUrl: httpUrl.default(GOOGLE_TOKEN_URL),
      })
      .strict()
      .refine((directory) => directory.method !== "delegation" || directory.adminEmail !== null, {
        message: "Domain-wide delegation needs the address of an administrator",
        path: ["adminEmail"],
      })
      .nullable()
      .default(null),
  })
  .strict();

export const genericOidcConfigSchema = z
  .object({
    preset: z.literal("generic"),
    ...commonShape,
    issuer: issuerUrl,
    scopes: z.array(z.string().trim().min(1).max(100)).max(20).default(["openid", "profile", "email"]),
    claims: z
      .object({
        email: claimName.default("email"),
        signInName: claimName.default("preferred_username"),
        displayName: claimName.default("name"),
        groups: claimName.nullable().default(null),
        groupNames: claimName.nullable().default(null),
      })
      .strict()
      .default({
        email: "email",
        signInName: "preferred_username",
        displayName: "name",
        groups: null,
        groupNames: null,
      }),
  })
  .strict();

export const oidcConfigSchema = z.discriminatedUnion("preset", [
  entraIdConfigSchema,
  googleConfigSchema,
  genericOidcConfigSchema,
]);
export type OidcConfig = z.output<typeof oidcConfigSchema>;
export type OidcConfigInput = z.input<typeof oidcConfigSchema>;

const attributeName = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_:./#-]+$/, "must be an attribute name");

const ldapAttributeName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^(?:[A-Za-z][A-Za-z0-9-]*|[0-9]+(?:\.[0-9]+)+)$/, "must be an LDAP attribute name");

const distinguishedName = z.string().trim().min(3).max(1000).regex(/=/, "must be a distinguished name");

function balancedFilter(value: string): boolean {
  if (!value.startsWith("(") || !value.endsWith(")")) return false;
  let depth = 0;
  for (const character of value) {
    if (character === "(") depth++;
    if (character === ")") depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

const ldapFilter = z
  .string()
  .trim()
  .min(3)
  .max(1000)
  .refine(balancedFilter, "must be an LDAP filter in parentheses");

export const ENTRA_SAML_CLAIMS = {
  tenantId: "http://schemas.microsoft.com/identity/claims/tenantid",
  objectId: "http://schemas.microsoft.com/identity/claims/objectidentifier",
  email: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
  userPrincipalName: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
  displayName: "http://schemas.microsoft.com/identity/claims/displayname",
  groups: "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups",
  groupsLink: "http://schemas.microsoft.com/claims/groups.link",
  methods: "http://schemas.microsoft.com/claims/authnmethodsreferences",
} as const;

export const ADFS_GROUP_CLAIMS = {
  sids: "http://schemas.microsoft.com/ws/2008/06/identity/claims/groupsid",
  names: "http://schemas.xmlsoap.org/claims/Group",
} as const;

export const samlGroupValues = ["identifiers", "names"] as const;
export type SamlGroupValues = (typeof samlGroupValues)[number];

export const SAML_METADATA_REFRESH_HOURS = 24;

const samlMetadataSourceSchema = z.discriminatedUnion("source", [
  z
    .object({
      source: z.literal("url"),
      url: z.url({ protocol: /^https?$/ }).max(2048),
    })
    .strict(),
  z.object({ source: z.literal("file") }).strict(),
]);

const samlAttributesSchema = z
  .object({
    email: attributeName,
    signInName: attributeName.nullable().default(null),
    displayName: attributeName.nullable().default(null),
    groups: attributeName.nullable().default(null),
  })
  .strict();

const samlCommonShape = {
  domains: z.array(domainSchema).max(50).default([]),
  metadata: samlMetadataSourceSchema,
  idpInitiated: z.boolean().default(false),
  requireSignedResponse: z.boolean().default(false),
  encryptedAssertions: z.boolean().default(false),
  accountCreation: accountCreationSchema.default({ enabled: false, requiredGroups: [] }),
  sync: syncSchema.default({ intervalMinutes: SYNC_INTERVAL_MINUTES.default }),
  secondFactor: secondFactorSchema.default({ mode: "provider", proofValues: ["mfa"] }),
};

export const samlEntraIdConfigSchema = z
  .object({
    preset: z.literal("entraId"),
    ...samlCommonShape,
    tenantId: tenantIdSchema,
    authority: httpUrl.default(ENTRA_AUTHORITY),
    graphUrl: httpUrl.default(MICROSOFT_GRAPH),
    graphClientId: z.string().trim().min(1).max(500).nullable().default(null),
    emailSource: z.enum(["email", "userPrincipalName"]).default("email"),
  })
  .strict();

export const samlAdfsConfigSchema = z
  .object({
    preset: z.literal("adfs"),
    ...samlCommonShape,
    identifierAttribute: attributeName.default("objectGUID"),
    attributes: samlAttributesSchema.default({
      email: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
      signInName: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn",
      displayName: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
      groups: ADFS_GROUP_CLAIMS.sids,
    }),
    groupValues: z.enum(samlGroupValues).default("identifiers"),
  })
  .strict();

export const samlGenericConfigSchema = z
  .object({
    preset: z.literal("generic"),
    ...samlCommonShape,
    identifierAttribute: attributeName.nullable().default(null),
    attributes: samlAttributesSchema.default({
      email: "email",
      signInName: null,
      displayName: null,
      groups: null,
    }),
    groupValues: z.enum(samlGroupValues).default("names"),
  })
  .strict();

export const samlConfigSchema = z.discriminatedUnion("preset", [
  samlEntraIdConfigSchema,
  samlAdfsConfigSchema,
  samlGenericConfigSchema,
]);
export type SamlConfig = z.output<typeof samlConfigSchema>;
export type SamlConfigInput = z.input<typeof samlConfigSchema>;

export const ldapSecondFactorModes = ["pagehall", "provider"] as const;

const ldapUrl = z
  .url({ protocol: /^ldaps?$/ })
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return (url.pathname === "" || url.pathname === "/") && url.search === "" && url.hash === "";
  }, "must be the address of a directory server without a path");

const ldapCommonShape = {
  url: ldapUrl,
  startTls: z.boolean().default(false),
  bindDn: distinguishedName,
  userBaseDn: distinguishedName,
  groupBaseDn: distinguishedName,
  domains: z.array(domainSchema).max(50).default([]),
  accountCreation: accountCreationSchema.default({ enabled: false, requiredGroups: [] }),
  sync: syncSchema.default({ intervalMinutes: SYNC_INTERVAL_MINUTES.default }),
  secondFactor: z
    .object({ mode: z.enum(ldapSecondFactorModes).default("pagehall") })
    .strict()
    .default({ mode: "pagehall" }),
};

export const activeDirectoryConfigSchema = z
  .object({
    preset: z.literal("activeDirectory"),
    ...ldapCommonShape,
    userFilter: ldapFilter.default("(&(objectCategory=person)(objectClass=user))"),
    groupFilter: ldapFilter.default("(objectClass=group)"),
    signInAttribute: z.enum(["userPrincipalName", "sAMAccountName", "mail"]).default("userPrincipalName"),
  })
  .strict();

export const genericLdapConfigSchema = z
  .object({
    preset: z.literal("generic"),
    ...ldapCommonShape,
    userFilter: ldapFilter.default("(objectClass=inetOrgPerson)"),
    groupFilter: ldapFilter.default("(|(objectClass=groupOfNames)(objectClass=groupOfUniqueNames))"),
    signInAttribute: z.enum(["mail", "uid"]).default("mail"),
    attributes: z
      .object({
        email: ldapAttributeName.default("mail"),
        signInName: ldapAttributeName.default("uid"),
        displayName: ldapAttributeName.default("cn"),
        groupName: ldapAttributeName.default("cn"),
      })
      .strict()
      .default({ email: "mail", signInName: "uid", displayName: "cn", groupName: "cn" }),
    groupMembership: z.enum(["member", "memberOf"]).default("member"),
    disabled: z
      .object({
        attribute: ldapAttributeName,
        values: z.array(z.string().trim().min(1).max(256)).max(20).default([]),
      })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();

export const ldapConfigSchema = z
  .discriminatedUnion("preset", [activeDirectoryConfigSchema, genericLdapConfigSchema])
  .refine((config) => !config.startTls || new URL(config.url).protocol === "ldap:", {
    message: "StartTLS upgrades an ldap:// connection; ldaps:// is encrypted already",
    path: ["startTls"],
  });
export type LdapConfig = z.output<typeof ldapConfigSchema>;
export type LdapConfigInput = z.input<typeof ldapConfigSchema>;

export type AnyProviderConfig = OidcConfig | SamlConfig | LdapConfig;

export function providerConfigSchema(type: IdentityProviderType) {
  switch (type) {
    case "oidc":
      return oidcConfigSchema;
    case "saml":
      return samlConfigSchema;
    case "ldap":
      return ldapConfigSchema;
  }
}

export const samlMetadataXmlSchema = z.string().min(1).max(1_000_000);
export const caCertificateSchema = z.string().trim().min(1).max(100_000);
export const directoryPasswordSchema = z.string().min(1).max(1024);

export const identityProviderNameSchema = z.string().trim().min(1).max(100);

export const clientSecretSchema = z.string().min(1).max(4096);

export const signInRefusalReferenceSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/, "must be a reference such as 7KQ2-M9XA");

export const googleServiceAccountKeySchema = z
  .object({
    type: z.literal("service_account"),
    client_email: emailSchema,
    private_key: z.string().min(1).max(10_000),
  })
  .loose();

export const mappingRoleSchema = z.union([
  z.object({ builtIn: z.enum(["owner", "administrator", "securityAuditor"]) }).strict(),
  z.object({ customRoleId: idSchema }).strict(),
]);

export const mappingRuleInputSchema = z.discriminatedUnion("target", [
  z
    .object({
      target: z.literal("organization"),
      group: z
        .object({ id: z.string().trim().min(1).max(256), name: z.string().trim().max(256).nullable() })
        .strict(),
      organizationId: idSchema,
      role: mappingRoleSchema.nullable(),
      synchronizedGroup: z.boolean(),
      homeOrganization: z.boolean(),
    })
    .strict(),
  z
    .object({
      target: z.literal("instance"),
      group: z
        .object({ id: z.string().trim().min(1).max(256), name: z.string().trim().max(256).nullable() })
        .strict(),
      role: mappingRoleSchema,
    })
    .strict(),
]);
export type MappingRuleInput = z.output<typeof mappingRuleInputSchema>;
