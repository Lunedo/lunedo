import type { OidcConfig } from "@pagehall/shared";
import type { identityCredentialKinds, identityProviderLevels, identityProviderTypes } from "./schema.js";

export type IdentityProviderType = (typeof identityProviderTypes)[number];
export type IdentityProviderLevel = (typeof identityProviderLevels)[number];
export type IdentityCredentialKind = (typeof identityCredentialKinds)[number];

export interface ProviderDefinition {
  id: string;
  type: IdentityProviderType;
  level: IdentityProviderLevel;
  organizationId: string | null;
  name: string;
  config: OidcConfig;
}

export interface ProviderCredential {
  id: string;
  kind: IdentityCredentialKind;
  secret: string;
  keyId: string | null;
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

export interface CallbackInput {
  callbackUrl: URL;
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface RedirectSignInResult {
  profile: ProviderProfile;
  authTime: number | null;
  providerSessionId: string | null;
  claimNames: string[];
}

export interface ProviderLogout {
  subject: string | null;
  providerSessionId: string | null;
  tokenId: string;
  expiresAt: Date;
}

export interface SynchronizedAccount {
  subject: string;
  profile: ProviderProfile | null;
  enabled: boolean;
}

export interface IdentityProviderAdapter {
  readonly type: IdentityProviderType;
  authorizationUrl(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    request: AuthorizationRequest,
  ): Promise<URL>;
  completeSignIn(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    input: CallbackInput,
  ): Promise<RedirectSignInResult>;
  verifyLogout(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    logoutToken: string,
  ): Promise<ProviderLogout>;
  readProfile?(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    subject: string,
  ): Promise<ProviderProfile | null>;
  readGroups?(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    subject: string,
  ): Promise<ProviderGroup[]>;
  synchronizeAccounts?(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    subjects: readonly string[],
  ): AsyncIterable<SynchronizedAccount>;
}

export class ProviderResponseError extends Error {
  override name = "ProviderResponseError";
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
