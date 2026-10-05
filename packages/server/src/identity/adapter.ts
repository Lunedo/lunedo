import type { LdapConfig, OidcConfig, SamlConfig } from "@pagehall/shared";
import type { ReceivedClaim } from "./claims.js";
import type { identityCredentialKinds, identityProviderTypes } from "./schema.js";

export type IdentityProviderType = (typeof identityProviderTypes)[number];
export type IdentityCredentialKind = (typeof identityCredentialKinds)[number];

interface ProviderBase {
  id: string;
  name: string;
  directoryKey: string | null;
}

export interface SamlIdentityProviderMetadata {
  entityId: string;
  ssoUrl: string;
  certificates: string[];
}

export type OidcProviderDefinition = ProviderBase & { type: "oidc"; config: OidcConfig };
export type SamlProviderDefinition = ProviderBase & {
  type: "saml";
  config: SamlConfig;
  metadata: SamlIdentityProviderMetadata | null;
};
export type LdapProviderDefinition = ProviderBase & {
  type: "ldap";
  config: LdapConfig;
  caCertificates: string | null;
};

export type ProviderDefinition = OidcProviderDefinition | SamlProviderDefinition | LdapProviderDefinition;

export interface ProviderCredential {
  id: string;
  kind: IdentityCredentialKind;
  secret: string;
  keyId: string | null;
  certificate: string | null;
}

export interface ProviderCapabilities {
  groups: boolean;
  directorySync: boolean;
  disabledAccounts: boolean;
  groupsByName: boolean;
}

export interface ProviderGroup {
  id: string;
  name: string | null;
}

export interface ProviderProfile {
  subject: string;
  email: string | null;
  signInName: string | null;
  displayName: string | null;
  groups: ProviderGroup[] | null;
}

export interface AuthorizationRequest {
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  reauthenticate: boolean;
}

export interface StartedAuthorization {
  url: URL;
  requestId: string | null;
}

export interface CallbackInput {
  callbackUrl: URL;
  redirectUri: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  requestId: string | null;
  samlResponse: string | null;
}

export interface DirectSignInInput {
  signInName: string;
  password: string;
}

export interface DirectSignInResult {
  profile: ProviderProfile;
  groupsFailed: boolean;
}

export type DirectoryTestStep = "connection" | "certificate" | "serviceAccount" | "search";

export interface DirectoryTestResult {
  steps: { step: DirectoryTestStep; ok: boolean; detail: string | null }[];
  sample: ProviderProfile | null;
  attributes: ReceivedClaim[];
}

export interface RedirectSignInResult {
  profile: ProviderProfile;
  methods: string[];
  authTime: number | null;
  providerSessionId: string | null;
  claims: ReceivedClaim[];
  assertion?: { id: string; expiresAt: Date };
}

export interface ProviderLogout {
  subject: string | null;
  providerSessionId: string | null;
  tokenId: string;
  expiresAt: Date;
}

export interface SynchronizedAccount {
  subject: string;
  state: "enabled" | "disabled" | "deleted" | "unknown";
  profile: ProviderProfile | null;
  groups?: ProviderGroup[] | null;
}

export interface DirectoryGroupMatch extends ProviderGroup {
  members: number | null;
}

export interface IdentityProviderAdapter {
  readonly type: IdentityProviderType;
  authorizationUrl(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    request: AuthorizationRequest,
  ): Promise<StartedAuthorization>;
  completeSignIn(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    input: CallbackInput,
  ): Promise<RedirectSignInResult>;
  verifyLogout?(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    logoutToken: string,
  ): Promise<ProviderLogout>;
  authenticate?(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    input: DirectSignInInput,
  ): Promise<DirectSignInResult>;
  verifyPassword?(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    subject: string,
    password: string,
  ): Promise<boolean>;
  testDirectory?(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    signInName: string | null,
  ): Promise<DirectoryTestResult>;
  readProfile?(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    subject: string,
  ): Promise<ProviderProfile | null>;
  readGroups?(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    subject: string,
  ): Promise<ProviderGroup[] | null>;
  synchronizeAccounts?(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    subjects: readonly string[],
  ): AsyncIterable<SynchronizedAccount>;
  hasDirectory?(provider: ProviderDefinition): boolean;
  readGroupNames?(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    groupIds: readonly string[],
  ): Promise<ProviderGroup[]>;
  readGroup?(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    groupId: string,
  ): Promise<ProviderGroup | null>;
  searchGroups?(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    query: string,
  ): Promise<DirectoryGroupMatch[]>;
  countMembers?(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    groupId: string,
  ): Promise<number | null>;
}

export function plainText(text: string): string {
  return text
    .replace(/[\t\n\r]+/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .trim();
}

export class ProviderResponseError extends Error {
  override name = "ProviderResponseError";

  constructor(message: string) {
    super(plainText(message));
  }
}

export class ProviderPolicyError extends Error {
  override name = "ProviderPolicyError";

  constructor(
    readonly reason: "domainNotAllowed" | "otherTenant",
    message: string,
  ) {
    super(message);
  }
}

export class ProviderTypeError extends Error {
  override name = "ProviderTypeError";
}

export function expectType<T extends ProviderDefinition["type"]>(
  provider: ProviderDefinition,
  type: T,
): Extract<ProviderDefinition, { type: T }> {
  if (provider.type !== type) {
    throw new ProviderTypeError(`A ${provider.type} provider was given to the ${type} adapter`);
  }
  return provider as Extract<ProviderDefinition, { type: T }>;
}

export const directorySignInFailures = [
  "invalidCredentials",
  "passwordExpired",
  "passwordMustChange",
  "accountLocked",
  "accountDisabled",
  "outsideSignInHours",
] as const;
export type DirectorySignInFailure = (typeof directorySignInFailures)[number];

export class DirectorySignInError extends Error {
  override name = "DirectorySignInError";

  constructor(
    readonly reason: DirectorySignInFailure,
    message: string,
  ) {
    super(plainText(message));
  }
}

export const directoryConnectionFailures = [
  "unreachable",
  "certificateUntrusted",
  "certificateInvalid",
  "insecureConnection",
  "serviceAccountRejected",
  "searchFailed",
] as const;
export type DirectoryConnectionFailure = (typeof directoryConnectionFailures)[number];

export class DirectoryConnectionError extends ProviderResponseError {
  override name = "DirectoryConnectionError";

  constructor(
    readonly reason: DirectoryConnectionFailure,
    message: string,
  ) {
    super(message);
  }
}
