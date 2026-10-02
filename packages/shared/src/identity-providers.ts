import { z } from "zod";
import { domainSchema, emailSchema, idSchema } from "./validation.js";

export const identityProviderPresets = ["entraId", "google", "generic"] as const;
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
