import { createPrivateKey, webcrypto } from "node:crypto";
import type { OidcConfig } from "@lunedo/shared";
import { createRemoteJWKSet, type JWTPayload, jwtVerify } from "jose";
import * as client from "openid-client";
import {
  type AuthorizationRequest,
  type CallbackInput,
  type DirectoryGroupMatch,
  expectType,
  type IdentityProviderAdapter,
  type OidcProviderDefinition,
  type ProviderCapabilities,
  type ProviderCredential,
  type ProviderDefinition,
  type ProviderGroup,
  type ProviderLogout,
  ProviderPolicyError,
  type ProviderProfile,
  ProviderResponseError,
  type RedirectSignInResult,
  type StartedAuthorization,
  type SynchronizedAccount,
} from "./adapter.js";
import { receivedClaims } from "./claims.js";
import { type DirectoryAccount, DirectoryClients, googleReadsUsers } from "./directory.js";

const DISCOVERY_CACHE_MS = 10 * 60 * 1000;
const CLOCK_TOLERANCE_SECONDS = 60;
const LOGOUT_EVENT = "http://schemas.openid.net/event/backchannel-logout";
const REQUEST_TIMEOUT_SECONDS = 10;

export function oidcIssuer(config: OidcConfig): string {
  switch (config.preset) {
    case "entraId":
      return `${config.authority}/${config.tenantId}/v2.0`;
    case "google":
      return config.issuer;
    case "generic":
      return config.issuer;
  }
}

export function oidcCapabilities(config: OidcConfig, directoryKey: boolean): ProviderCapabilities {
  switch (config.preset) {
    case "entraId":
      return { groups: true, directorySync: true, disabledAccounts: true, groupsByName: false };
    case "google": {
      const directorySync = config.directory !== null && directoryKey;
      return {
        groups: config.directory !== null,
        directorySync,
        disabledAccounts: directorySync && googleReadsUsers(config),
        groupsByName: false,
      };
    }
    case "generic":
      return {
        groups: config.claims.groups !== null,
        directorySync: false,
        disabledAccounts: false,
        groupsByName: false,
      };
  }
}

function oidcScopes(config: OidcConfig): string[] {
  return config.preset === "generic" ? config.scopes : ["openid", "profile", "email"];
}

function stringClaim(claims: Record<string, unknown>, name: string | null): string | null {
  if (!name) return null;
  const value = claims[name];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function groupsClaim(
  claims: Record<string, unknown>,
  name: string,
  namesClaim: string | null = null,
): ProviderGroup[] | null {
  const value = claims[name];
  if (!Array.isArray(value)) return null;
  const names = namesClaim ? claims[namesClaim] : undefined;
  const nameList = Array.isArray(names) ? names : [];
  return value.flatMap((entry, index) => {
    if (typeof entry !== "string" || entry === "") return [];
    const named = nameList[index];
    return [{ id: entry, name: typeof named === "string" && named !== "" ? named : null }];
  });
}

function genericGroups(
  claims: Record<string, unknown>,
  names: { groups: string | null; groupNames: string | null },
): Pick<ProviderProfile, "groups" | "groupsClaimMissing"> {
  if (!names.groups) return { groups: null };
  if (claims[names.groups] === undefined && claims._claim_names === undefined) {
    return { groups: [], groupsClaimMissing: true };
  }
  return { groups: groupsClaim(claims, names.groups, names.groupNames), groupsClaimMissing: false };
}

function objectIdOf(subject: string): string {
  return subject.split(":")[1] ?? subject;
}

async function privateKey(credential: ProviderCredential): Promise<client.CryptoKey> {
  const der = createPrivateKey(credential.secret).export({ format: "der", type: "pkcs8" });
  return webcrypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, [
    "sign",
  ]) as Promise<client.CryptoKey>;
}

async function clientAuthentication(credential: ProviderCredential): Promise<client.ClientAuth> {
  if (credential.kind === "clientSecret") return client.ClientSecretPost(credential.secret);
  const key = await privateKey(credential);
  return client.PrivateKeyJwt(
    { key, ...(credential.keyId ? { kid: credential.keyId } : {}) },
    {
      [client.modifyAssertion](header) {
        if (credential.keyId) header.x5t = credential.keyId;
      },
    },
  );
}

function isInvalidClient(error: unknown): boolean {
  return error instanceof client.ResponseBodyError && error.error === "invalid_client";
}

interface CachedConfiguration {
  configuration: client.Configuration;
  expiresAt: number;
}

export class OidcAdapter implements IdentityProviderAdapter {
  readonly type = "oidc" as const;
  readonly #allowInsecure: boolean;
  readonly #fetch: typeof fetch;
  readonly #cache = new Map<string, CachedConfiguration>();
  readonly #keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
  readonly #directory: DirectoryClients;

  constructor(options: { allowInsecure: boolean; fetch?: typeof fetch }) {
    this.#allowInsecure = options.allowInsecure;
    this.#fetch = options.fetch ?? fetch;
    this.#directory = new DirectoryClients(options);
  }

  hasDirectory(provider: ProviderDefinition): boolean {
    return (
      provider.type === "oidc" &&
      oidcCapabilities(provider.config, provider.directoryKey !== null).directorySync
    );
  }

  #profileFrom(
    provider: OidcProviderDefinition,
    subject: string,
    account: DirectoryAccount,
    groups: ProviderGroup[] | null,
  ): ProviderProfile {
    const config = expectType(provider, "oidc").config;
    const signInName =
      config.preset === "entraId" && config.signInNameSource === "email" ? account.email : account.signInName;
    return { subject, email: account.email, signInName, displayName: account.displayName, groups };
  }

  async readGroups(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    subject: string,
  ): Promise<ProviderGroup[] | null> {
    const config = expectType(provider, "oidc").config;
    if (config.preset === "entraId") {
      return this.#directory.graphGroupsOf(provider.id, config, credentials, objectIdOf(subject));
    }
    if (config.preset === "google" && this.hasDirectory(provider)) {
      return this.#directory.googleGroupsOf(provider.id, config, provider.directoryKey ?? "", subject);
    }
    return null;
  }

  async readProfile(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    subject: string,
  ): Promise<ProviderProfile | null> {
    const config = expectType(provider, "oidc").config;
    if (config.preset === "entraId") {
      const account = await this.#directory.graphAccount(
        provider.id,
        config,
        credentials,
        objectIdOf(subject),
      );
      return account ? this.#profileFrom(expectType(provider, "oidc"), subject, account, null) : null;
    }
    if (config.preset === "google" && this.hasDirectory(provider) && googleReadsUsers(config)) {
      const account = await this.#directory.googleAccount(
        provider.id,
        config,
        provider.directoryKey ?? "",
        subject,
      );
      return account ? this.#profileFrom(expectType(provider, "oidc"), subject, account, null) : null;
    }
    return null;
  }

  async *synchronizeAccounts(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    subjects: readonly string[],
  ): AsyncIterable<SynchronizedAccount> {
    const config = expectType(provider, "oidc").config;
    for (const subject of subjects) {
      let account: DirectoryAccount | null;
      let groups: ProviderGroup[] | null;
      if (config.preset === "entraId") {
        account = await this.#directory.graphAccount(provider.id, config, credentials, objectIdOf(subject));
        groups = account
          ? await this.#directory.graphGroupsOf(provider.id, config, credentials, objectIdOf(subject))
          : null;
      } else if (config.preset === "google" && this.hasDirectory(provider)) {
        const key = provider.directoryKey ?? "";
        if (!googleReadsUsers(config)) {
          const known = await this.#directory.googleGroupsOf(provider.id, config, key, subject);
          yield { subject, state: "unknown", profile: null, groups: known };
          continue;
        }
        account = await this.#directory.googleAccount(provider.id, config, key, subject);
        groups = account ? await this.#directory.googleGroupsOf(provider.id, config, key, subject) : null;
      } else {
        return;
      }
      if (!account) {
        yield { subject, state: "deleted", profile: null };
        continue;
      }
      yield {
        subject,
        state: account.enabled ? "enabled" : "disabled",
        profile: this.#profileFrom(expectType(provider, "oidc"), subject, account, groups),
      };
    }
  }

  async readGroupNames(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    groupIds: readonly string[],
  ): Promise<ProviderGroup[]> {
    const config = expectType(provider, "oidc").config;
    if (config.preset !== "entraId") return [];
    return this.#directory.graphGroupNames(provider.id, config, credentials, groupIds);
  }

  async readGroup(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    groupId: string,
  ): Promise<ProviderGroup | null> {
    const config = expectType(provider, "oidc").config;
    if (config.preset === "entraId")
      return this.#directory.graphGroup(provider.id, config, credentials, groupId);
    if (config.preset === "google" && this.hasDirectory(provider)) {
      return this.#directory.googleGroup(provider.id, config, provider.directoryKey ?? "", groupId);
    }
    throw new ProviderResponseError("The provider has no directory to read groups from");
  }

  async searchGroups(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    query: string,
  ): Promise<DirectoryGroupMatch[]> {
    const config = expectType(provider, "oidc").config;
    if (config.preset === "entraId") {
      return this.#directory.graphSearchGroups(provider.id, config, credentials, query);
    }
    if (config.preset === "google" && this.hasDirectory(provider)) {
      return this.#directory.googleSearchGroups(provider.id, config, provider.directoryKey ?? "", query);
    }
    return [];
  }

  async countMembers(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    groupId: string,
  ): Promise<number | null> {
    const config = expectType(provider, "oidc").config;
    if (config.preset === "entraId") {
      return this.#directory.graphMemberCount(provider.id, config, credentials, groupId);
    }
    if (config.preset === "google" && this.hasDirectory(provider)) {
      return this.#directory.googleMemberCount(provider.id, config, provider.directoryKey ?? "", groupId);
    }
    return null;
  }

  #checkTransport(url: string): void {
    if (new URL(url).protocol !== "https:" && !this.#allowInsecure) {
      throw new ProviderResponseError("Identity providers must be reached through HTTPS");
    }
  }

  async #configuration(provider: OidcProviderDefinition, credential: ProviderCredential) {
    const issuer = oidcIssuer(provider.config);
    this.#checkTransport(issuer);
    const key = `${provider.id}:${credential.id}:${issuer}:${provider.config.clientId}:${provider.config.idTokenAlgorithm}`;
    const cached = this.#cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.configuration;
    let configuration: client.Configuration;
    try {
      configuration = await client.discovery(
        new URL(issuer),
        provider.config.clientId,
        { id_token_signed_response_alg: provider.config.idTokenAlgorithm },
        await clientAuthentication(credential),
        {
          timeout: REQUEST_TIMEOUT_SECONDS,
          ...(this.#allowInsecure ? { execute: [client.allowInsecureRequests] } : {}),
        },
      );
    } catch (error) {
      throw new ProviderResponseError(
        `The discovery document could not be read: ${(error as Error).message}`,
      );
    }
    configuration.timeout = REQUEST_TIMEOUT_SECONDS;
    this.#cache.set(key, { configuration, expiresAt: Date.now() + DISCOVERY_CACHE_MS });
    return configuration;
  }

  async authorizationUrl(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    request: AuthorizationRequest,
  ): Promise<StartedAuthorization> {
    const oidc = expectType(provider, "oidc");
    const credential = credentials[0];
    if (!credential) throw new ProviderResponseError("The provider has no credential");
    const configuration = await this.#configuration(oidc, credential);
    const url = client.buildAuthorizationUrl(configuration, {
      redirect_uri: request.redirectUri,
      scope: oidcScopes(oidc.config).join(" "),
      response_type: "code",
      state: request.state,
      nonce: request.nonce,
      code_challenge: request.codeChallenge,
      code_challenge_method: "S256",
      ...(request.reauthenticate ? { prompt: "login", max_age: "0" } : {}),
      ...(oidc.config.preset === "google" && oidc.config.domains.length === 1
        ? { hd: oidc.config.domains[0] ?? "" }
        : {}),
    });
    return { url, requestId: null };
  }

  async completeSignIn(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    input: CallbackInput,
  ): Promise<RedirectSignInResult> {
    const oidc = expectType(provider, "oidc");
    let lastError: unknown = null;
    for (const credential of credentials) {
      const configuration = await this.#configuration(oidc, credential);
      try {
        const tokens = await client.authorizationCodeGrant(configuration, input.callbackUrl, {
          pkceCodeVerifier: input.codeVerifier,
          expectedState: input.state,
          expectedNonce: input.nonce,
          idTokenExpected: true,
        });
        const claims = tokens.claims();
        if (!claims) throw new ProviderResponseError("The provider returned no ID token");
        const profile = await this.#profile(oidc, credentials, claims);
        return {
          profile,
          methods: Array.isArray(claims.amr)
            ? claims.amr.filter((value): value is string => typeof value === "string")
            : [],
          authTime: typeof claims.auth_time === "number" ? claims.auth_time : null,
          providerSessionId: typeof claims.sid === "string" ? claims.sid : null,
          claims: receivedClaims(claims),
        };
      } catch (error) {
        if (isInvalidClient(error)) {
          lastError = error;
          continue;
        }
        if (error instanceof ProviderPolicyError || error instanceof ProviderResponseError) throw error;
        throw new ProviderResponseError(
          `The provider response was not accepted: ${(error as Error).message}`,
        );
      }
    }
    throw new ProviderResponseError(
      `No credential was accepted by the provider: ${(lastError as Error | null)?.message ?? "none"}`,
    );
  }

  async #profile(
    provider: OidcProviderDefinition,
    credentials: readonly ProviderCredential[],
    claims: Record<string, unknown>,
  ): Promise<ProviderProfile> {
    const config = expectType(provider, "oidc").config;
    if (config.preset === "entraId") {
      const tenant = stringClaim(claims, "tid");
      const objectId = stringClaim(claims, "oid");
      if (!tenant || !objectId) throw new ProviderResponseError("The ID token has no tenant or object ID");
      if (tenant.toLowerCase() !== config.tenantId) {
        throw new ProviderPolicyError("otherTenant", "The ID token comes from another tenant");
      }
      const userPrincipalName = stringClaim(claims, "preferred_username") ?? stringClaim(claims, "upn");
      const email =
        config.emailSource === "email"
          ? stringClaim(claims, "email")
          : config.emailSource === "userPrincipalName"
            ? userPrincipalName
            : ((await this.#directory.graphAccount(provider.id, config, credentials, objectId))?.email ??
              null);
      const signInName =
        config.signInNameSource === "email"
          ? email
          : config.signInNameSource === "preferredUsername"
            ? stringClaim(claims, "preferred_username")
            : userPrincipalName;
      return {
        subject: `${tenant.toLowerCase()}:${objectId.toLowerCase()}`,
        email,
        signInName,
        displayName: stringClaim(claims, "name"),
        groups: claims._claim_names !== undefined ? null : groupsClaim(claims, "groups"),
      };
    }
    const subject = stringClaim(claims, "sub");
    if (!subject) throw new ProviderResponseError("The ID token has no subject");
    if (config.preset === "google") {
      const domain = stringClaim(claims, "hd")?.toLowerCase() ?? null;
      if (!domain || !config.domains.includes(domain)) {
        throw new ProviderPolicyError("domainNotAllowed", "The Google account is not in a configured domain");
      }
      return {
        subject,
        email: stringClaim(claims, "email"),
        signInName: stringClaim(claims, "email"),
        displayName: stringClaim(claims, "name"),
        groups: null,
      };
    }
    return {
      subject,
      email: stringClaim(claims, config.claims.email),
      signInName: stringClaim(claims, config.claims.signInName),
      displayName: stringClaim(claims, config.claims.displayName),
      ...genericGroups(claims, config.claims),
    };
  }

  #keySet(providerId: string, uri: string): ReturnType<typeof createRemoteJWKSet> {
    const key = `${providerId}:${uri}`;
    const existing = this.#keySets.get(key);
    if (existing) return existing;
    const created = createRemoteJWKSet(new URL(uri));
    this.#keySets.set(key, created);
    return created;
  }

  async verifyLogout(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    logoutToken: string,
  ): Promise<ProviderLogout> {
    const oidc = expectType(provider, "oidc");
    const credential = credentials[0];
    if (!credential) throw new ProviderResponseError("The provider has no credential");
    const configuration = await this.#configuration(oidc, credential);
    const metadata = configuration.serverMetadata();
    if (!metadata.jwks_uri) throw new ProviderResponseError("The provider publishes no keys");
    this.#checkTransport(metadata.jwks_uri);
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(logoutToken, this.#keySet(provider.id, metadata.jwks_uri), {
        issuer: metadata.issuer,
        audience: oidc.config.clientId,
        algorithms: [oidc.config.idTokenAlgorithm],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        maxTokenAge: "10 minutes",
        requiredClaims: ["iat", "jti"],
      }));
    } catch (error) {
      throw new ProviderResponseError(`The logout token was not accepted: ${(error as Error).message}`);
    }
    const events = payload.events as Record<string, unknown> | undefined;
    if (!events || typeof events !== "object" || typeof events[LOGOUT_EVENT] !== "object") {
      throw new ProviderResponseError("The logout token has no logout event");
    }
    if ("nonce" in payload) throw new ProviderResponseError("A logout token must not contain a nonce");
    const subject = typeof payload.sub === "string" ? payload.sub : null;
    const sessionId = typeof payload.sid === "string" ? payload.sid : null;
    if (!subject && !sessionId) throw new ProviderResponseError("The logout token names nobody");
    const issuedAt = (payload.iat ?? 0) * 1000;
    return {
      subject: oidc.config.preset === "entraId" ? null : subject,
      providerSessionId: sessionId,
      tokenId: String(payload.jti),
      expiresAt: new Date(Math.max(issuedAt, Date.now()) + 15 * 60 * 1000),
    };
  }
}
