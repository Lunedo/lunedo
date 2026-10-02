import { PASSWORD_MAX_LENGTH, signInRefusalReasons } from "@pagehall/server";
import {
  clientSecretSchema,
  identityProviderNameSchema,
  identityProviderPresets,
  mappingRuleInputSchema,
  oidcConfigSchema,
  signInRefusalReferenceSchema,
} from "@pagehall/shared";
import { z } from "zod";
import { secondFactorSchema } from "../auth/schemas.js";
import { inputTimestamp, timestamp, uuid } from "../http/schemas.js";

export const providerIdParams = z.object({ providerId: uuid("ID of the identity provider.") }).strict();

export const credentialParams = z
  .object({
    providerId: uuid("ID of the identity provider."),
    credentialId: uuid("ID of the credential."),
  })
  .strict();

export const testResultParams = z
  .object({
    providerId: uuid("ID of the identity provider."),
    flowId: uuid("ID of the test sign-in."),
  })
  .strict();

const returnTo = z
  .string()
  .max(2000)
  .regex(/^\/(?!\/)[^\\\s]*$/, "must be a path on this instance")
  .describe("Path in Pagehall to open after the sign-in, for example `/settings/security`.");

export const credentialInputSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("clientSecret"),
        secret: clientSecretSchema.describe("The client secret issued by the provider."),
        expiresAt: inputTimestamp("When the secret expires, as shown by the provider.").nullable(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("certificate"),
        validDays: z
          .number()
          .int()
          .min(30)
          .max(1095)
          .describe("Validity of the generated certificate in days, 30 to 1095."),
      })
      .strict(),
  ])
  .describe(
    "A client secret, or a certificate whose key pair Pagehall generates. The private key never leaves Pagehall.",
  );

export const createProviderSchema = z
  .object({
    name: identityProviderNameSchema.describe("Name shown on the sign-in page."),
    config: oidcConfigSchema.describe("Configuration of the OpenID Connect provider."),
    credential: credentialInputSchema,
  })
  .strict()
  .describe("A new OpenID Connect provider.");

export const updateProviderSchema = z
  .object({
    name: identityProviderNameSchema.optional().describe("Name shown on the sign-in page."),
    config: oidcConfigSchema.optional().describe("The whole new configuration. The preset cannot change."),
  })
  .strict()
  .describe("Changes to the provider.");

export const startSchema = z
  .object({ returnTo: returnTo.nullable().optional() })
  .strict()
  .describe("Where the sign-in returns.");

export const testStartSchema = z
  .object({ returnTo: returnTo.nullable().optional() })
  .strict()
  .describe("Where the test sign-in returns.");

export const reauthenticateSchema = z
  .object({
    providerId: uuid("Provider to confirm the identity with. It must be linked to the account."),
    returnTo: returnTo.nullable().optional(),
  })
  .strict()
  .describe("A confirmation of the identity through a provider.");

export const startedSchema = z
  .object({ url: z.string().describe("Address of the provider to open in the browser.") })
  .describe("The started sign-in.");

const credentialSchema = z
  .object({
    id: uuid("ID of the credential."),
    kind: z.enum(["clientSecret", "certificate"]).describe("A client secret or a certificate."),
    keyId: z.string().nullable().describe("Thumbprint of the certificate, or null for a secret."),
    expiresAt: timestamp("When the credential expires.").nullable(),
    createdAt: timestamp("When the credential was added."),
  })
  .describe("A credential. Secrets and private keys are never returned.");

export const addedCredentialSchema = credentialSchema
  .extend({ certificate: z.string().nullable().describe("The public certificate as PEM, for certificates.") })
  .describe("The added credential.");

export const providerSchema = z
  .object({
    id: uuid("ID of the provider."),
    type: z.literal("oidc").describe("Protocol of the provider."),
    name: z.string().describe("Name shown on the sign-in page."),
    config: oidcConfigSchema.describe("Configuration of the provider."),
    issuer: z.string().describe("Issuer URL the provider is discovered at."),
    redirectUri: z.string().describe("Redirect URI to register with the provider."),
    logoRef: z.string().nullable().describe("Reference to the uploaded logo, or null."),
    credentials: z.array(credentialSchema).describe("Credentials, newest first."),
    directoryKey: z
      .boolean()
      .describe("Whether a service account key for the Google directory is stored. The key is never shown."),
    warnings: z
      .array(z.enum(["noCredential", "credentialExpiring", "credentialExpired"]))
      .describe("Problems that need attention."),
    createdAt: timestamp("When the provider was set up."),
    updatedAt: timestamp("When the provider was last changed."),
  })
  .describe("An identity provider.");

export const createdProviderSchema = z
  .object({ provider: providerSchema, credential: addedCredentialSchema })
  .describe("The new provider with its first credential.");

export const signInProviderSchema = z
  .object({
    id: uuid("ID of the provider."),
    name: z.string().describe("Name shown on the sign-in page."),
    preset: z.enum(identityProviderPresets).describe("Kind of provider."),
    logoRef: z.string().nullable().describe("Reference to the uploaded logo, or null."),
  })
  .describe("A provider people sign in through.");

export const signInOptionsSchema = z
  .object({
    emailStep: z
      .boolean()
      .describe(
        "Whether the page asks for the e-mail address first. False only when `directProvider` is set.",
      ),
    directProvider: signInProviderSchema
      .nullable()
      .describe("The only provider, shown as a button right away, when password sign-in is off."),
    lastProvider: signInProviderSchema
      .nullable()
      .describe("The provider this browser signed in with last, offered as a shortcut, or null."),
    passwordSignIn: z.boolean().describe("Whether sign-in with a password is offered."),
    passkeys: z.literal(true).describe("Passkeys are always offered and need no e-mail address."),
  })
  .describe("Ways to sign in.");

export const discoverSchema = z
  .object({ email: z.string().trim().min(1).max(320).describe("E-mail address the person entered.") })
  .strict()
  .describe("The e-mail address to choose the sign-in method for.");

export const signInStepSchema = z
  .discriminatedUnion("step", [
    z
      .object({
        step: z.literal("provider").describe("Continue with the provider of the e-mail domain."),
        providerId: uuid("ID of the provider."),
        name: z.string().describe("Name of the provider."),
        preset: z.enum(identityProviderPresets).describe("Kind of provider."),
      })
      .describe("The domain belongs to a provider."),
    z
      .object({ step: z.literal("password").describe("Continue with the password form.") })
      .describe("Password sign-in is offered for this address."),
    z
      .object({ step: z.literal("none").describe("No sign-in method is set up for this address.") })
      .describe("No sign-in method is set up for this address."),
  ])
  .describe("The next step. The answer does not depend on whether an account with the address exists.");

export const linkInfoSchema = z
  .object({
    providerName: z.string().describe("Provider the person signed in with."),
    email: z.string().nullable().describe("E-mail address the provider reported."),
    accountName: z.string().describe("Name of the existing account."),
    factors: z
      .array(z.enum(["totp", "passkey", "recoveryCode"]))
      .describe("Second factors of the account. One of them is required when the list is not empty."),
  })
  .describe("An identity waiting to be linked to an existing account.");

export const linkConfirmationSchema = z
  .object({
    password: z.string().min(1).max(PASSWORD_MAX_LENGTH).describe("Password of the existing account."),
    factor: secondFactorSchema.nullable().optional().describe("Second factor of the existing account."),
  })
  .strict()
  .describe("Confirmation with the password and the second factor of the existing account.");

export const referenceSchema = z
  .object({ reference: z.string().describe("Reference for administrators, for example `7KQ2-M9XA`.") })
  .describe("The ended sign-in.");

export const referenceParams = z
  .object({ reference: signInRefusalReferenceSchema.describe("Reference shown on the refusal page.") })
  .strict();

export const refusalSchema = z
  .object({
    reference: z.string().describe("The reference."),
    reason: z.enum(signInRefusalReasons).describe("Why the sign-in was refused."),
    providerId: uuid("Provider of the sign-in.").nullable(),
    subject: z.string().nullable().describe("Identifier the provider reported."),
    email: z.string().nullable().describe("E-mail address the provider reported."),
    displayName: z.string().nullable().describe("Name the provider reported."),
    accountId: uuid("Existing account the sign-in was about.").nullable(),
    createdAt: timestamp("When the sign-in was refused."),
  })
  .describe("A refused sign-in.");

export const testResultSchema = z
  .union([
    z.object({
      subject: z.string().describe("Identifier Pagehall uses for the person."),
      email: z.string().nullable().describe("E-mail address."),
      emailVerified: z.boolean().describe("Whether the address lies in a configured domain."),
      signInName: z.string().nullable().describe("Sign-in name."),
      displayName: z.string().nullable().describe("Display name."),
      groups: z
        .array(z.object({ id: z.string(), name: z.string().nullable() }))
        .nullable()
        .describe("Groups from the token, or null when the token carries none."),
      claimNames: z.array(z.string()).describe("Names of all claims in the ID token."),
    }),
    z.object({ error: z.string().describe("Why the test sign-in failed.") }),
  ])
  .describe("What Pagehall received from the provider.");

export const identitySchema = z
  .object({
    id: uuid("ID of the linked identity."),
    providerId: uuid("ID of the provider."),
    providerName: z.string().describe("Name of the provider."),
    subject: z.string().describe("Identifier at the provider."),
    email: z.string().nullable().describe("E-mail address from the provider."),
    signInName: z.string().nullable().describe("Sign-in name from the provider."),
    displayName: z.string().nullable().describe("Name from the provider."),
    lastSignInAt: timestamp("Last sign-in through this identity.").nullable(),
    createdAt: timestamp("When the identity was linked."),
  })
  .describe("An identity linked to an account.");

export const linkIdentitySchema = z
  .object({
    providerId: uuid("ID of the provider."),
    subject: z.string().trim().min(1).max(500).describe("Identifier of the person at the provider."),
  })
  .strict()
  .describe("An identity to link.");

export const identityParams = z
  .object({
    accountId: uuid("ID of the account."),
    identityId: uuid("ID of the linked identity."),
  })
  .strict();

export const logoutBodySchema = z
  .object({ logout_token: z.string().min(1).max(16_384).describe("The logout token.") })
  .describe("Back-channel logout request of the provider.");

export const directoryKeySchema = z
  .object({
    key: z
      .string()
      .min(2)
      .max(20_000)
      .describe("The JSON key of the Google service account, as downloaded from Google Cloud."),
  })
  .strict()
  .describe("A service account key for reading the Google directory.");

export const ruleParams = z
  .object({
    providerId: uuid("ID of the identity provider."),
    ruleId: uuid("ID of the mapping rule."),
  })
  .strict();

export const runParams = z
  .object({
    providerId: uuid("ID of the identity provider."),
    runId: uuid("ID of the sync run."),
  })
  .strict();

export const mappingRuleBodySchema = mappingRuleInputSchema.describe(
  "A mapping rule. Groups are identified by their stable ID at the provider; the name is only shown.",
);

const ruleRoleSchema = z
  .union([
    z.object({ builtIn: z.string().describe("Key of the built-in role.") }).strict(),
    z
      .object({
        customRoleId: uuid("ID of the custom role."),
        name: z.string().describe("Name of the custom role."),
      })
      .strict(),
  ])
  .nullable()
  .describe("The role the rule grants, or null for membership only.");

export const mappingRuleSchema = z
  .object({
    id: uuid("ID of the rule."),
    providerId: uuid("ID of the provider."),
    position: z.number().int().describe("Order of the rule; earlier rules decide the home organization."),
    group: z
      .object({
        id: z.string().describe("Stable ID of the group at the provider."),
        name: z.string().nullable().describe("Last known name of the group, or null."),
        missing: z
          .boolean()
          .describe("Whether the group no longer exists at the provider. Such a rule grants nothing."),
      })
      .describe("The group at the provider."),
    target: z.enum(["organization", "instance"]).describe("What the rule grants access to."),
    organization: z
      .object({ id: uuid("ID of the organization."), name: z.string().describe("Name of the organization.") })
      .nullable()
      .describe("The organization, for organization rules."),
    role: ruleRoleSchema,
    synchronizedGroup: z
      .object({ id: uuid("ID of the group in Pagehall."), name: z.string().describe("Name of the group.") })
      .nullable()
      .describe("The synchronized Pagehall group the members are added to, or null."),
    homeOrganization: z
      .boolean()
      .describe("Whether the organization becomes the home organization of new accounts."),
    accounts: z.number().int().describe("Accounts in Pagehall that are in the group."),
    createdAt: timestamp("When the rule was created."),
    updatedAt: timestamp("When the rule was last changed."),
  })
  .describe("A rule that maps a group of the provider to access in Pagehall.");

export const ruleOrderSchema = z
  .object({
    ruleIds: z
      .array(uuid("ID of a rule."))
      .max(500)
      .describe("Every rule of the provider, in the new order."),
  })
  .strict()
  .describe("A new order of the rules.");

export const groupSearchQuery = z
  .object({ q: z.string().trim().max(200).default("").describe("Text in the name of the group.") })
  .strict();

export const groupPreviewQuery = z
  .object({ group: z.string().trim().min(1).max(256).describe("Stable ID of the group at the provider.") })
  .strict();

export const providerGroupMatchSchema = z
  .object({
    id: z.string().describe("Stable ID of the group at the provider."),
    name: z.string().nullable().describe("Name of the group."),
    members: z.number().int().nullable().describe("Members at the provider, or null when unknown."),
    accounts: z.number().int().describe("Accounts in Pagehall that are in the group."),
    mapped: z.boolean().describe("Whether a rule uses the group already."),
  })
  .describe("A group of the provider.");

export const rulePreviewSchema = z
  .object({
    members: z.number().int().nullable().describe("Members at the provider, or null when unknown."),
    accounts: z.number().int().describe("Accounts in Pagehall that gain access."),
    sample: z
      .array(z.object({ id: uuid("ID of the account."), name: z.string().describe("Name of the account.") }))
      .describe("Some of these accounts, by name."),
    withoutAccount: z
      .number()
      .int()
      .nullable()
      .describe(
        "Members without an account yet; they gain access at their first sign-in. Null when unknown.",
      ),
  })
  .describe("Who gains access through a rule.");

export const syncRequestedSchema = z
  .object({ runId: uuid("ID of the run when it ran at once.").nullable() })
  .describe(
    "The requested synchronization. With a job queue the run appears in the sync log shortly; otherwise it runs at once.",
  );

const syncRunShape = {
  id: uuid("ID of the run."),
  providerId: uuid("ID of the provider."),
  trigger: z.enum(["schedule", "manual"]).describe("What started the run."),
  status: z.enum(["running", "succeeded", "warnings", "failed", "cancelled"]).describe("Result of the run."),
  startedAt: timestamp("When the run started."),
  finishedAt: timestamp("When the run finished.").nullable(),
  durationMs: z.number().int().nullable().describe("Duration in milliseconds, or null while running."),
  changeCount: z.number().int().describe("Number of changes."),
  warningCount: z.number().int().describe("Number of warnings."),
  error: z.string().nullable().describe("Why the run failed, or null."),
};

export const syncRunSchema = z.object(syncRunShape).describe("A run of the synchronization.");

export const syncRunDetailsSchema = z
  .object({
    ...syncRunShape,
    changes: z
      .array(
        z.object({
          kind: z
            .enum([
              "membershipAdded",
              "membershipRemoved",
              "roleAdded",
              "roleRemoved",
              "groupMemberAdded",
              "groupMemberRemoved",
              "groupRenamed",
              "profileUpdated",
              "accountDeactivated",
              "accountReactivated",
            ])
            .describe("Kind of change."),
          accountId: uuid("ID of the account.").nullable(),
          organizationId: uuid("ID of the organization.").nullable(),
          detail: z
            .string()
            .nullable()
            .describe("Further detail, such as a role or the old and new name of a group."),
        }),
      )
      .describe("What the run changed."),
    warnings: z
      .array(
        z.object({
          kind: z
            .enum(["missingGroup", "grantRefused", "removalRefused", "accountFailed", "deactivationRefused"])
            .describe("Kind of warning."),
          accountId: uuid("ID of the account.").nullable(),
          ruleId: uuid("ID of the rule.").nullable(),
          detail: z.string().nullable().describe("Further detail."),
        }),
      )
      .describe("What needs attention."),
    references: z
      .record(z.string(), z.string())
      .describe("Names of the accounts named in the changes and warnings, by ID."),
  })
  .describe("A run of the synchronization with its changes and warnings.");

export const syncRunsQuery = z
  .object({
    cursor: z
      .string()
      .max(2000)
      .optional()
      .describe("Opaque cursor from `nextCursor` of the previous page. Leave it out for the first page."),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(200)
      .default(50)
      .describe("Maximum number of runs in the page."),
    filter: z
      .enum(["all", "changes", "failed"])
      .default("all")
      .describe("All runs, only runs with changes, or only failed runs."),
  })
  .strict();
