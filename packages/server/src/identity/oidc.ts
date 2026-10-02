import { createPrivateKey, webcrypto } from "node:crypto";
import type { OidcConfig } from "@pagehall/shared";
import { createRemoteJWKSet, type JWTPayload, jwtVerify } from "jose";
import * as client from "openid-client";
import {
  type AuthorizationRequest,
  type CallbackInput,
  type DirectoryGroupMatch,
  type IdentityProviderAdapter,
  type ProviderCredential,
  type ProviderDefinition,
  type ProviderGroup,
  type ProviderLogout,
  ProviderPolicyError,
  type ProviderProfile,
  ProviderResponseError,
  type RedirectSignInResult,
  type SynchronizedAccount,
} from "./adapter.js";
import { type DirectoryAccount, DirectoryClients } from "./directory.js";

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
    const config = provider.config;
    if (config.preset === "entraId") return true;
    return config.preset === "google" && config.directory !== null && provider.directoryKey !== null;
  }

  #profileFrom(
    provider: ProviderDefinition,
    subject: string,
    account: DirectoryAccount,
    groups: ProviderGroup[] | null,
  ): ProviderProfile {
    const config = provider.config;
    const signInName =
      config.preset === "entraId" && config.signInNameSource === "email" ? account.email : account.signInName;
    return { subject, email: account.email, signInName, displayName: account.displayName, groups };
  }

  async readGroups(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    subject: string,
  ): Promise<ProviderGroup[] | null> {
    const config = provider.config;
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
    const config = provider.config;
    if (config.preset === "entraId") {
      const account = await this.#directory.graphAccount(
        provider.id,
        config,
        credentials,
        objectIdOf(subject),
      );
      return account ? this.#profileFrom(provider, subject, account, null) : null;
    }
    if (config.preset === "google" && this.hasDirectory(provider)) {
      const account = await this.#directory.googleAccount(
        provider.id,
        config,
        provider.directoryKey ?? "",
        subject,
      );
      return account ? this.#profileFrom(provider, subject, account, null) : null;
    }
    return null;
  }

  async *synchronizeAccounts(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    subjects: readonly string[],
  ): AsyncIterable<SynchronizedAccount> {
    const config = provider.config;
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
        profile: this.#profileFrom(provider, subject, account, groups),
      };
    }
  }

  async readGroup(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    groupId: string,
  ): Promise<ProviderGroup | null> {
    const config = provider.config;
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
    const config = provider.config;
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
    const config = provider.config;
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

  async #configuration(provider: ProviderDefinition, credential: ProviderCredential) {
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
  ): Promise<URL> {
    const credential = credentials[0];
    if (!credential) throw new ProviderResponseError("The provider has no credential");
    const configuration = await this.#configuration(provider, credential);
    return client.buildAuthorizationUrl(configuration, {
      redirect_uri: request.redirectUri,
      scope: oidcScopes(provider.config).join(" "),
      response_type: "code",
      state: request.state,
      nonce: request.nonce,
      code_challenge: request.codeChallenge,
      code_challenge_method: "S256",
      ...(request.reauthenticate ? { prompt: "login", max_age: "0" } : {}),
      ...(provider.config.preset === "google" && provider.config.domains.length === 1
        ? { hd: provider.config.domains[0] ?? "" }
        : {}),
    });
  }

  async completeSignIn(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    input: CallbackInput,
  ): Promise<RedirectSignInResult> {
    let lastError: unknown = null;
    for (const credential of credentials) {
      const configuration = await this.#configuration(provider, credential);
      try {
        const tokens = await client.authorizationCodeGrant(configuration, input.callbackUrl, {
          pkceCodeVerifier: input.codeVerifier,
          expectedState: input.state,
          expectedNonce: input.nonce,
          idTokenExpected: true,
        });
        const claims = tokens.claims();
        if (!claims) throw new ProviderResponseError("The provider returned no ID token");
        const profile = await this.#profile(provider, credentials, claims);
        return {
          profile,
          authTime: typeof claims.auth_time === "number" ? claims.auth_time : null,
          providerSessionId: typeof claims.sid === "string" ? claims.sid : null,
          claimNames: Object.keys(claims).sort(),
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
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    claims: Record<string, unknown>,
  ): Promise<ProviderProfile> {
    const config = provider.config;
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
      groups: config.claims.groups
        ? groupsClaim(claims, config.claims.groups, config.claims.groupNames)
        : null,
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
    const credential = credentials[0];
    if (!credential) throw new ProviderResponseError("The provider has no credential");
    const configuration = await this.#configuration(provider, credential);
    const metadata = configuration.serverMetadata();
    if (!metadata.jwks_uri) throw new ProviderResponseError("The provider publishes no keys");
    this.#checkTransport(metadata.jwks_uri);
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(logoutToken, this.#keySet(provider.id, metadata.jwks_uri), {
        issuer: metadata.issuer,
        audience: provider.config.clientId,
        algorithms: [provider.config.idTokenAlgorithm],
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
      subject: provider.config.preset === "entraId" ? null : subject,
      providerSessionId: sessionId,
      tokenId: String(payload.jti),
      expiresAt: new Date(Math.max(issuedAt, Date.now()) + 15 * 60 * 1000),
    };
  }
}
