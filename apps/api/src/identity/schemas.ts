import { PASSWORD_MAX_LENGTH, signInRefusalReasons } from "@pagehall/server";
import {
  clientSecretSchema,
  identityProviderNameSchema,
  identityProviderPresets,
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
