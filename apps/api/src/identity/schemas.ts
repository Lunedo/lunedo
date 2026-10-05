import { PASSWORD_MAX_LENGTH, signInRefusalReasons, testFailureReasons } from "@pagehall/server";
import {
  caCertificateSchema,
  clientSecretSchema,
  directoryPasswordSchema,
  identityProviderNameSchema,
  identityProviderPresets,
  identityProviderTypes,
  ldapConfigSchema,
  mappingRuleInputSchema,
  oidcConfigSchema,
  providerDraftFieldsSchema,
  samlConfigSchema,
  samlMetadataXmlSchema,
  signInRefusalReferenceSchema,
} from "@pagehall/shared";
import { z } from "zod";
import { authenticationResponseSchema, secondFactorSchema, signedInSchema } from "../auth/schemas.js";
import { inputTimestamp, timestamp, uuid } from "../http/schemas.js";

export const removalPreviewSchema = z
  .object({
    accounts: z.number().int().nonnegative().describe("Accounts with an identity of this provider."),
    accountsWithoutSignIn: z
      .number()
      .int()
      .nonnegative()
      .describe("Accounts that have no other working way to sign in once the provider is removed."),
    groups: z
      .number()
      .int()
      .nonnegative()
      .describe("Synchronized groups that become ordinary groups and keep their members and permissions."),
    rules: z.number().int().nonnegative().describe("Mapping rules that are removed."),
    grants: z
      .number()
      .int()
      .nonnegative()
      .describe("Memberships and roles granted by the provider's rules that are withdrawn."),
  })
  .describe("What removing the provider changes.");

export const providerIdParams = z.object({ providerId: uuid("ID of the identity provider.") }).strict();

export const scimTokenParams = z
  .object({
    providerId: uuid("ID of the identity provider."),
    tokenId: uuid("ID of the SCIM token."),
  })
  .strict();

const scimTokenShape = {
  id: uuid("ID of the token."),
  prefix: z.string().describe("First characters of the token, to recognize it."),
  expiresAt: timestamp("When the token stops working after a renewal, or null.").nullable(),
  lastUsedAt: timestamp("When the provider last used the token, or null.").nullable(),
  createdAt: timestamp("When the token was created."),
};

export const scimStatusSchema = z
  .object({
    url: z.string().describe("Base URL of the SCIM endpoint of this provider, to enter as tenant URL."),
    tokens: z
      .array(z.object(scimTokenShape).describe("A SCIM token."))
      .describe("Valid tokens, oldest first."),
    lastRequestAt: timestamp("When the provider last sent a request, or null.").nullable(),
    lastDay: z
      .object({
        requests: z.number().int().describe("Requests that changed something or failed."),
        changes: z.number().int().describe("Changes accepted."),
        failed: z.number().int().describe("Requests refused."),
      })
      .describe("SCIM activity of the last 24 hours."),
  })
  .describe("SCIM provisioning of a provider. SCIM is on while the provider has a token.");

export const createdScimTokenSchema = z
  .object({
    ...scimTokenShape,
    token: z.string().describe("The secret token. It is shown only this once."),
  })
  .describe("A new SCIM token.");

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
    z
      .object({
        kind: z.literal("samlSigning"),
        validDays: z
          .number()
          .int()
          .min(30)
          .max(1095)
          .describe("Validity of the generated signing certificate in days, 30 to 1095."),
      })
      .strict(),
    z
      .object({
        kind: z.literal("bindPassword"),
        secret: directoryPasswordSchema.describe("Password of the directory service account."),
      })
      .strict(),
  ])
  .describe(
    "A client secret, a certificate or a SAML signing key pair that Pagehall generates, or the password of a directory service account. Private keys and passwords never leave Pagehall.",
  );

const providerName = identityProviderNameSchema.describe("Name shown on the sign-in page.");

export const createProviderSchema = z
  .discriminatedUnion("type", [
    z
      .object({
        type: z.literal("oidc").describe("OpenID Connect."),
        name: providerName,
        config: oidcConfigSchema.describe("Configuration of the OpenID Connect provider."),
        draftId: uuid("ID of the draft this provider completes, when it was started as a draft.")
          .nullable()
          .optional(),
        credential: credentialInputSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("saml").describe("SAML 2.0."),
        name: providerName,
        config: samlConfigSchema.describe("Configuration of the SAML identity provider."),
        draftId: uuid("ID of the draft this provider completes, when it was started as a draft.")
          .nullable()
          .optional(),
        metadataXml: samlMetadataXmlSchema
          .nullable()
          .optional()
          .describe("The metadata file of the identity provider, when the metadata source is a file."),
        credential: credentialInputSchema
          .nullable()
          .optional()
          .describe(
            "Credential for Microsoft Graph, for Entra ID with directory sync. Pagehall generates its own signing key.",
          ),
      })
      .strict(),
    z
      .object({
        type: z.literal("ldap").describe("LDAP or Active Directory."),
        name: providerName,
        config: ldapConfigSchema.describe("Configuration of the directory."),
        draftId: uuid("ID of the draft this provider completes, when it was started as a draft.")
          .nullable()
          .optional(),
        credential: credentialInputSchema.describe("The password of the service account."),
      })
      .strict(),
  ])
  .describe("A new identity provider.");

const draftPreset = z
  .enum(identityProviderPresets)
  .describe("The kind of provider; it must belong to the type.");

export const createDraftSchema = z
  .object({
    type: z
      .enum(["oidc", "saml", "ldap"])
      .describe("OpenID Connect, SAML 2.0, or LDAP and Active Directory."),
    preset: draftPreset,
    name: providerName,
  })
  .strict()
  .describe("A provider to set up step by step.");

export const updateDraftSchema = z
  .object({
    name: providerName.optional(),
    preset: draftPreset.optional(),
    fields: providerDraftFieldsSchema
      .optional()
      .describe("The values typed into the assistant so far. Secrets are never stored in a draft."),
  })
  .strict()
  .describe("Changes to a draft.");

export const draftParams = z.object({ draftId: uuid("ID of the draft.") }).strict();

export const draftSchema = z
  .object({
    id: uuid("ID of the draft; the provider keeps it."),
    type: z.enum(["oidc", "saml", "ldap"]).describe("Type of the provider."),
    preset: draftPreset,
    name: z.string().describe("Name shown on the sign-in page."),
    fields: z.record(z.string(), z.unknown()).describe("The values typed into the assistant so far."),
    redirectUri: z
      .string()
      .describe("Redirect URI for OIDC, assertion consumer service URL for SAML, the sign-in page for LDAP."),
    saml: z
      .object({
        entityId: z.string().describe("Entity ID of Pagehall."),
        metadataUrl: z.string().describe("Address of Pagehall's metadata."),
        signingCredentialId: z
          .string()
          .nullable()
          .describe("ID of the signing certificate, for its download."),
      })
      .nullable()
      .describe("What to enter at a SAML identity provider."),
    createdAt: timestamp("When the draft was started."),
    updatedAt: timestamp("When the draft was last saved."),
  })
  .describe("A provider whose setup has not reached the connection yet.");

export const updateProviderSchema = z
  .object({
    name: identityProviderNameSchema.optional().describe("Name shown on the sign-in page."),
    config: z
      .union([oidcConfigSchema, samlConfigSchema, ldapConfigSchema])
      .optional()
      .describe("The whole new configuration. The type and the preset cannot change."),
  })
  .strict()
  .describe("Changes to the provider.");

export const samlMetadataUploadSchema = z
  .object({ xml: samlMetadataXmlSchema.describe("The metadata file of the identity provider.") })
  .strict()
  .describe("SAML metadata of the identity provider.");

export const caCertificateUploadSchema = z
  .object({
    certificate: caCertificateSchema.describe(
      "One or more certificates of the certificate authority that issued the directory server's certificate, in PEM format.",
    ),
  })
  .strict()
  .describe("The certificate authority to trust for this directory.");

const checkedProvider = uuid(
  "ID of the provider whose stored password and CA certificate the check uses when none is sent.",
)
  .nullable()
  .optional();

export const connectionCheckSchema = z
  .discriminatedUnion("type", [
    z
      .object({
        type: z.literal("oidc").describe("OpenID Connect: reads the discovery document of the issuer."),
        config: oidcConfigSchema.describe("Configuration to check."),
        providerId: checkedProvider,
      })
      .strict(),
    z
      .object({
        type: z.literal("saml").describe("SAML 2.0: loads and reads the metadata address."),
        config: samlConfigSchema.describe("Configuration to check."),
        providerId: checkedProvider,
      })
      .strict(),
    z
      .object({
        type: z.literal("ldap").describe("LDAP: connects, checks the certificate, binds and searches once."),
        config: ldapConfigSchema.describe("Configuration to check."),
        bindPassword: directoryPasswordSchema
          .nullable()
          .optional()
          .describe(
            "Password of the service account. Without it, the stored password of the provider is used.",
          ),
        providerId: checkedProvider,
      })
      .strict(),
  ])
  .describe("Connection settings to check before they are saved.");

export const connectionCheckResultSchema = z.object({
  ok: z.boolean().describe("Whether Pagehall reached the provider with these settings."),
  check: z.enum(["discovery", "metadata", "directory"]).describe("What was checked."),
  url: z.string().nullable().describe("The address Pagehall contacted."),
  status: z.number().int().nullable().describe("The HTTP status of the answer, when there was one."),
  problem: z
    .enum([
      "unreachable",
      "status",
      "invalidDocument",
      "issuerMismatch",
      "connection",
      "certificate",
      "serviceAccount",
      "search",
    ])
    .nullable()
    .describe("What went wrong, or null."),
  detail: z.string().nullable().describe("The message of the provider or the network, for administrators."),
});

export const directoryTestSchema = z
  .object({
    signInName: z
      .string()
      .trim()
      .min(1)
      .max(320)
      .nullable()
      .optional()
      .describe("A sign-in name to look up. Without it, Pagehall reads any one person."),
  })
  .strict()
  .describe("What to look up in the directory.");

const receivedClaimsSchema = z
  .array(
    z.object({
      name: z.string().describe("Name of the claim or attribute."),
      values: z.array(z.string()).describe("Its values as text."),
    }),
  )
  .describe("Claims or attributes as received, without tokens, hashes or secrets.");

export const directoryTestResultSchema = z
  .object({
    steps: z
      .array(
        z.object({
          step: z
            .enum(["connection", "certificate", "serviceAccount", "search"])
            .describe("What was checked."),
          ok: z.boolean().describe("Whether the check passed."),
          detail: z.string().nullable().describe("What failed, or null."),
        }),
      )
      .describe("The checks in order. A failed check ends the test."),
    sample: z
      .object({
        subject: z.string().describe("Identifier Pagehall uses for the person."),
        email: z.string().nullable().describe("E-mail address."),
        signInName: z.string().nullable().describe("Sign-in name."),
        displayName: z.string().nullable().describe("Display name."),
        groups: z
          .array(z.object({ id: z.string(), name: z.string().nullable() }))
          .nullable()
          .describe("Groups including nested groups."),
      })
      .nullable()
      .describe("The person found, or null."),
    attributes: receivedClaimsSchema,
  })
  .describe("Result of the directory test.");

export const directorySignInSchema = z
  .object({
    signInName: z.string().trim().min(1).max(320).describe("Sign-in name in the directory."),
    password: z.string().max(1024).describe("Directory password. An empty password is always refused."),
  })
  .strict()
  .describe("Sign-in with a directory password.");

export const directoryReauthenticationSchema = z
  .object({
    providerId: uuid("Directory provider linked to the account."),
    password: z.string().max(1024).describe("Directory password."),
  })
  .strict()
  .describe("Confirmation of the identity with the directory password.");

export const directorySignInResultSchema = z
  .discriminatedUnion("status", [
    signedInSchema.describe("Signed in."),
    z
      .object({
        status: z.literal("secondFactorRequired"),
        factors: z.array(z.string()).describe("Second factors of the account."),
      })
      .describe("A Pagehall second factor is required next."),
    z
      .object({ status: z.literal("linkRequired") })
      .describe("An account with the address exists; the person confirms the link next."),
    z
      .object({
        status: z.literal("refused"),
        reference: z.string().describe("Reference for administrators."),
        reason: z.enum(signInRefusalReasons).describe("Why the sign-in was refused."),
      })
      .describe("The sign-in was refused."),
  ])
  .describe("The outcome of a directory sign-in.");

export const samlResponseBodySchema = z
  .object({
    SAMLResponse: z.string().min(1).max(1_000_000).describe("The SAML response, Base64-encoded."),
    RelayState: z.string().max(200).optional().describe("The state Pagehall sent with the request."),
  })
  .describe("The SAML response the identity provider posts.");

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
    kind: z
      .enum(["clientSecret", "certificate", "samlSigning", "bindPassword"])
      .describe("A client secret, a certificate, a SAML signing key pair or a service account password."),
    keyId: z.string().nullable().describe("Thumbprint of the certificate, or null for a secret or password."),
    expiresAt: timestamp("When the credential expires.").nullable(),
    createdAt: timestamp("When the credential was added."),
  })
  .describe("A credential. Secrets and private keys are never returned.");

const providerCredentialSchema = credentialSchema
  .extend({
    inUse: z
      .boolean()
      .describe(
        "Whether Pagehall uses this credential: the one an administrator chose, otherwise the newest valid one.",
      ),
    chosen: z.boolean().describe("Whether an administrator chose this credential."),
  })
  .describe("A credential. Secrets and private keys are never returned.");

export const credentialChoiceSchema = z
  .object({
    use: z
      .enum(["this", "newest"])
      .describe(
        "this uses the credential from now on; newest returns to the newest valid credential of its kind.",
      ),
  })
  .strict();

export const addedCredentialSchema = credentialSchema
  .extend({ certificate: z.string().nullable().describe("The public certificate as PEM, for certificates.") })
  .describe("The added credential.");

const certificateInfoSchema = z
  .object({
    fingerprint: z.string().describe("SHA-256 fingerprint of the certificate."),
    subject: z.string().describe("Subject of the certificate."),
    expiresAt: timestamp("When the certificate expires."),
  })
  .describe("A certificate.");

const providerBase = {
  id: uuid("ID of the provider."),
  name: z.string().describe("Name shown on the sign-in page."),
  issuer: z
    .string()
    .describe("Issuer URL for OIDC, entity ID of the identity provider for SAML, server address for LDAP."),
  redirectUri: z
    .string()
    .describe("Redirect URI for OIDC, assertion consumer service URL for SAML, the sign-in page for LDAP."),
  logoRef: z.string().nullable().describe("Reference to the uploaded logo, or null."),
  credentials: z.array(providerCredentialSchema).describe("Credentials, newest first."),
  directoryKey: z
    .boolean()
    .describe("Whether a service account key for the Google directory is stored. The key is never shown."),
  capabilities: z
    .object({
      groups: z.boolean().describe("Whether Pagehall learns the groups of a person from this provider."),
      directorySync: z
        .boolean()
        .describe("Whether profiles and groups are synchronized in the background, not only at sign-in."),
      disabledAccounts: z
        .boolean()
        .describe("Whether accounts disabled or deleted in the provider are detected without a sign-in."),
      groupsByName: z
        .boolean()
        .describe("Whether groups are identified by their names, so that renaming a group breaks its rules."),
    })
    .describe("What the provider can do with its current configuration."),
  scim: z.boolean().describe("Whether SCIM is on: the provider has a SCIM token and sends changes at once."),
  setupComplete: z
    .boolean()
    .describe(
      "Whether the setup assistant was finished. Until then, nobody signs in through the provider except for test sign-ins.",
    ),
  deactivatedAt: z.iso
    .datetime()
    .nullable()
    .describe(
      "When the provider was deactivated, or null while it is active. Nobody signs in through a deactivated provider and it is not synchronized.",
    ),
  warnings: z
    .array(
      z.enum([
        "noCredential",
        "credentialExpiring",
        "credentialExpired",
        "metadataRefreshFailed",
        "caCertificateExpiring",
        "noGraphCredential",
      ]),
    )
    .describe("Problems that need attention."),
  createdAt: timestamp("When the provider was set up."),
  updatedAt: timestamp("When the provider was last changed."),
};

export const providerSchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("oidc").describe("OpenID Connect."),
      ...providerBase,
      config: oidcConfigSchema.describe("Configuration of the provider."),
    }),
    z.object({
      type: z.literal("saml").describe("SAML 2.0."),
      ...providerBase,
      config: samlConfigSchema.describe("Configuration of the provider."),
      saml: z
        .object({
          entityId: z
            .string()
            .describe("Entity ID of Pagehall as service provider, the address of its metadata."),
          metadataUrl: z.string().describe("Address of Pagehall's service provider metadata."),
          identityProvider: z
            .object({
              entityId: z.string().describe("Entity ID of the identity provider."),
              ssoUrl: z.string().describe("Sign-in address of the identity provider."),
              certificates: z
                .array(certificateInfoSchema)
                .describe("Signing certificates of the identity provider."),
              fetchedAt: timestamp("When the metadata was last loaded."),
              refreshFailedAt: timestamp("When the last refresh failed, or null.").nullable(),
              refreshError: z.string().nullable().describe("Why the last refresh failed, or null."),
            })
            .nullable()
            .describe("What the metadata of the identity provider says."),
        })
        .describe("SAML details."),
    }),
    z.object({
      type: z.literal("ldap").describe("LDAP or Active Directory."),
      ...providerBase,
      config: ldapConfigSchema.describe("Configuration of the provider."),
      ldap: z
        .object({
          caCertificate: certificateInfoSchema
            .nullable()
            .describe("Uploaded certificate authority, or null when the system's trusted authorities apply."),
        })
        .describe("Directory details."),
    }),
  ])
  .describe("An identity provider.");

export const createdProviderSchema = z
  .object({ provider: providerSchema, credential: addedCredentialSchema.nullable() })
  .describe("The new provider with its first credential.");

export const signInProviderSchema = z
  .object({
    id: uuid("ID of the provider."),
    type: z.enum(identityProviderTypes).describe("Protocol of the provider."),
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
      .object({
        step: z.literal("directory").describe("Continue with the directory password of this provider."),
        providerId: uuid("ID of the provider."),
        name: z.string().describe("Name of the provider."),
        preset: z.enum(identityProviderPresets).describe("Kind of provider."),
        signInName: z
          .enum(["email", "userPrincipalName", "sAMAccountName", "uid"])
          .describe("What the directory expects as sign-in name besides the password."),
      })
      .describe("The domain belongs to a directory; the page asks for the password."),
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
      .describe(
        "Second factors of the account. One of them is required with the password, or after a provider confirmed the link when that provider needs a Pagehall second factor.",
      ),
    password: z.boolean().describe("Whether the password of the account can confirm the link."),
    passkey: z.boolean().describe("Whether a passkey of the account can confirm the link."),
    providers: z
      .array(
        z.object({
          id: uuid("ID of the provider."),
          name: z.string().describe("Name of the provider."),
          directory: z
            .boolean()
            .describe("Whether it is a directory that confirms with its password instead of its own page."),
        }),
      )
      .describe(
        "Providers already linked to the account; a fresh sign-in through one of them confirms the link.",
      ),
    confirmed: z
      .boolean()
      .describe(
        "Whether a linked provider confirmed the link already and only the second factor is missing.",
      ),
  })
  .describe("An identity waiting to be linked to an existing account.");

export const linkConfirmationSchema = z
  .object({
    password: z
      .string()
      .min(1)
      .max(PASSWORD_MAX_LENGTH)
      .optional()
      .describe("Password of the existing account, when it confirms with its password."),
    passkey: authenticationResponseSchema
      .optional()
      .describe(
        "Answer of a passkey of the existing account with user verification, when it confirms with it.",
      ),
    factor: secondFactorSchema.nullable().optional().describe("Second factor of the existing account."),
  })
  .strict()
  .describe(
    "Confirmation with the password or a passkey of the existing account, or the second factor after a linked provider confirmed the link.",
  );

export const linkPasskeyOptionsSchema = z
  .object({
    use: z
      .enum(["signIn", "secondFactor"])
      .default("secondFactor")
      .describe(
        "Whether the passkey confirms the link on its own or as the second factor after the password.",
      ),
  })
  .strict()
  .describe("What the passkey is for.");

export const linkProviderSchema = z
  .object({ providerId: uuid("Provider linked to the account that confirms the link.") })
  .strict()
  .describe("A provider to confirm the link with a fresh sign-in.");

export const linkDirectorySchema = z
  .object({
    providerId: uuid("Directory provider linked to the account."),
    password: z.string().max(1024).describe("Directory password."),
  })
  .strict()
  .describe("Confirmation of the link with the directory password.");

export const linkDirectoryResultSchema = z
  .discriminatedUnion("status", [
    signedInSchema.describe("Linked and signed in."),
    z
      .object({ status: z.literal("confirmed") })
      .describe("The directory confirmed the link; the second factor of the account is required next."),
  ])
  .describe("The outcome of the confirmation.");

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
      claims: receivedClaimsSchema,
    }),
    z.object({
      error: z.string().describe("What failed, as the provider or Pagehall reported it."),
      reason: z
        .enum(testFailureReasons)
        .describe("Why the test sign-in failed, so that the interface can say what to do."),
    }),
  ])
  .describe("What Pagehall received from the provider.");

export const identitySchema = z
  .object({
    id: uuid("ID of the linked identity."),
    providerId: uuid("ID of the provider."),
    providerName: z.string().describe("Name of the provider."),
    providerType: z
      .enum(identityProviderTypes)
      .describe(
        "Protocol of the provider. Directory providers confirm the identity with the directory password.",
      ),
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
      .describe(
        "Whether the organization becomes the home organization of accounts that have none, ahead of other rules.",
      ),
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
  trigger: z
    .enum(["schedule", "manual", "scim", "reconciliation", "signIn"])
    .describe(
      "What started the run: the schedule, a person, a SCIM request of the provider, the daily reconciliation while SCIM is on, or a sign-in whose rules could not all be applied.",
    ),
  status: z.enum(["running", "succeeded", "warnings", "failed", "cancelled"]).describe("Result of the run."),
  startedAt: timestamp("When the run started."),
  finishedAt: timestamp("When the run finished.").nullable(),
  durationMs: z.number().int().nullable().describe("Duration in milliseconds, or null while running."),
  changeCount: z.number().int().describe("Number of changes."),
  warningCount: z.number().int().describe("Number of warnings."),
  error: z.string().nullable().describe("Why the run failed, or null."),
  heldDeactivations: z
    .number()
    .int()
    .nullable()
    .describe(
      "How many accounts the run would have deactivated when it stopped to protect them, or null. Such a run deactivated nobody until an administrator confirms it.",
    ),
  confirmedAt: timestamp("When an administrator confirmed the held deactivations, or null.").nullable(),
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
              "homeOrganizationChanged",
              "accountCreated",
              "groupCreated",
              "groupDeleted",
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
            .enum([
              "missingGroup",
              "grantRefused",
              "removalRefused",
              "accountFailed",
              "deactivationRefused",
              "memberUnknown",
              "deactivationLimit",
              "noAccountsFound",
            ])
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
