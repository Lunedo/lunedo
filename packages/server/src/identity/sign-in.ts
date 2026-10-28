import { createHash, randomBytes, randomUUID } from "node:crypto";
import { directoryPasswordSchema, type LdapConfig, type OidcConfig, type SamlConfig } from "@lunedo/shared";
import { and, eq, gt, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import * as client from "openid-client";
import { ZodError } from "zod";
import type { Account, AccountService } from "../accounts/accounts.js";
import { EmailInUseError } from "../accounts/accounts.js";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import type { AccountLifecycleService } from "../accounts/lifecycle.js";
import { ANONYMOUS, accountPrincipal, SYSTEM } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import { type ChallengeStore, IDENTITY_LINK_LIFETIME_MS } from "../auth/challenges.js";
import { instanceAdministratorIds } from "../auth/emergency-recipients.js";
import {
  AuthError,
  ChallengeExpiredError,
  InvalidCredentialsError,
  LockedError,
  RateLimitedError,
} from "../auth/errors.js";
import { sessions } from "../auth/schema.js";
import type { ClientInfo, SessionService } from "../auth/sessions.js";
import type { PendingIdentity, SecondFactorType, SignedIn, SignInService } from "../auth/sign-in.js";
import {
  clientSubject,
  type RateLimiter,
  type SignInThrottle,
  type ThrottleSubjects,
} from "../auth/throttle.js";
import { hasSecondFactor, secondFactorsOf } from "../auth/two-factor.js";
import { secretsEqual } from "../crypto/constant-time.js";
import type { Database, Transaction } from "../database/database.js";
import type { MailService } from "../mail/mail-service.js";
import type { NotificationService } from "../notifications/service.js";
import { currentRequestContext, runWithRequestContext } from "../observability/request-context.js";
import { memberships } from "../organizations/access-schema.js";
import { OrganizationError } from "../organizations/organizations.js";
import { organizationDomains } from "../organizations/schema.js";
import type { SettingsService } from "../settings/service.js";
import {
  DirectorySignInError,
  type DirectorySignInFailure,
  type DirectoryTestResult,
  type IdentityProviderAdapter,
  type ProviderCredential,
  type ProviderDefinition,
  type ProviderGroup,
  ProviderPolicyError,
  type ProviderProfile,
  ProviderResponseError,
} from "./adapter.js";
import type { ReceivedClaim } from "./claims.js";
import type { GroupMappingService } from "./groups.js";
import { confirmsLinks, refreshManagedAccounts, takeOverLocalCredentials } from "./managed.js";
import type { ConnectionCheck, IdentityProviderService, SignInProvider } from "./providers.js";
import { callbackPath } from "./providers.js";
import { SamlAdapter, samlPaths } from "./saml.js";
import {
  identities,
  identityProviders,
  providerFlows,
  providerLogoutTokens,
  type SignInRefusalReason,
  samlAssertions,
  signInRefusals,
} from "./schema.js";

const FLOW_LIFETIME_MS = 10 * 60 * 1000;
const AUTH_TIME_TOLERANCE_MS = 60 * 1000;
const REFUSAL_RETENTION_DAYS = 90;
const DISCOVERIES_PER_CLIENT = 30;
const STARTS_PER_CLIENT = 20;
const CONNECTION_CHECKS_PER_CLIENT = 20;
const LOGOUTS_PER_CLIENT = 60;
const REFERENCE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export type ProviderFlowPurpose = "signIn" | "reauthentication" | "test" | "linkConfirmation";

export interface StartedFlow {
  url: string;
  browserToken: string;
}

export function providerProvedSecondFactor(
  setting: { mode: "provider" | "providerProof"; proofValues?: readonly string[] },
  methods: readonly string[],
): boolean {
  if (setting.mode === "provider") return true;
  return methods.some((method) => setting.proofValues?.includes(method));
}

export class DirectorySignInRefusedError extends AuthError {
  constructor(readonly reason: Exclude<DirectorySignInFailure, "invalidCredentials">) {
    super(reason, "The directory account cannot sign in right now");
  }
}

const DIRECTORY_AUDIT_REASONS = {
  passwordExpired: "directoryPasswordExpired",
  passwordMustChange: "directoryPasswordMustChange",
  accountLocked: "directoryAccountLocked",
  accountDisabled: "directoryAccountDisabled",
  outsideSignInHours: "directoryOutsideSignInHours",
} as const;

export interface SamlReceipt {
  state: string;
  browserToken: string | null;
}

export type CallbackResult =
  | { kind: "signedIn"; signedIn: SignedIn; returnTo: string | null }
  | { kind: "linkRequired"; pendingToken: string }
  | { kind: "linkConfirmed" }
  | {
      kind: "secondFactorRequired";
      pendingToken: string;
      factors: SecondFactorType[];
      returnTo: string | null;
    }
  | { kind: "refused"; reference: string; reason: SignInRefusalReason }
  | { kind: "reauthenticated"; token: string; returnTo: string | null }
  | { kind: "tested"; flowId: string; returnTo: string | null };

export interface TestResult {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  signInName: string | null;
  displayName: string | null;
  groups: { id: string; name: string | null }[] | null;
  claims: ReceivedClaim[];
}

export const testFailureReasons = [
  "providerRefused",
  "userNotAssigned",
  "consentRequired",
  "unknownApplication",
  "invalidClient",
  "otherTenant",
  "domainNotAllowed",
  "browserChanged",
  "invalidResponse",
] as const;
export type TestFailureReason = (typeof testFailureReasons)[number];

export interface TestFailure {
  error: string;
  reason: TestFailureReason;
}

const PROVIDER_ERROR_REASONS: [RegExp, TestFailureReason][] = [
  [/\bAADSTS50105\b/, "userNotAssigned"],
  [/\bAADSTS(65001|90094|90095)\b/, "consentRequired"],
  [/\bAADSTS700016\b/, "unknownApplication"],
];

function providerRefusal(query: URLSearchParams): TestFailure {
  const description = query.get("error_description") ?? "";
  const error = `${query.get("error") ?? "error"}${description ? `: ${description}` : ""}`.slice(0, 500);
  const reason =
    PROVIDER_ERROR_REASONS.find(([pattern]) => pattern.test(description))?.[1] ?? "providerRefused";
  return { error, reason };
}

function testFailure(error: ProviderPolicyError | ProviderResponseError): TestFailure {
  if (error instanceof ProviderPolicyError) {
    return {
      error: error.message,
      reason:
        error.reason === "otherTenant" || error.reason === "domainNotAllowed"
          ? error.reason
          : "invalidResponse",
    };
  }
  if (error.message.startsWith("No credential was accepted"))
    return { error: error.message, reason: "invalidClient" };
  return { error: error.message, reason: "invalidResponse" };
}

export interface SignInOptions {
  providers: SignInProvider[];
  lastProvider: SignInProvider | null;
  passkeys: true;
}

export type SignInStep =
  | { step: "provider"; providerId: string; name: string; preset: SignInProvider["preset"] }
  | {
      step: "directory";
      providerId: string;
      name: string;
      preset: SignInProvider["preset"];
      signInName: "email" | "userPrincipalName" | "sAMAccountName" | "uid";
    }
  | { step: "password" };

export interface SignInRefusal {
  reference: string;
  reason: SignInRefusalReason;
  providerId: string | null;
  subject: string | null;
  email: string | null;
  displayName: string | null;
  accountId: string | null;
  createdAt: Date;
}

export interface LinkWays {
  password: boolean;
  passkey: boolean;
  providers: { id: string; name: string; directory: boolean }[];
}

export interface LinkInfo extends LinkWays {
  providerName: string;
  email: string | null;
  accountName: string;
  factors: ("totp" | "passkey" | "recoveryCode")[];
  confirmed: boolean;
}

function reference(): string {
  const bytes = randomBytes(8);
  const characters = [...bytes].map((byte) => REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length]).join("");
  return `${characters.slice(0, 4)}-${characters.slice(4)}`;
}

function hashState(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function domainOf(email: string | null): string | null {
  const at = email?.lastIndexOf("@") ?? -1;
  return email && at > 0 ? email.slice(at + 1).toLowerCase() : null;
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "23505" || error instanceof EmailInUseError;
}

function canSignIn(account: Account | null): account is Account & { email: string } {
  return (
    account !== null &&
    account.state === "active" &&
    (account.type === "standard" || account.type === "guest") &&
    account.email !== null
  );
}

class LinkConfirmationRequired extends Error {}

class Refused extends Error {
  constructor(readonly reason: SignInRefusalReason) {
    super(reason);
  }
}

export class ProviderSignInService {
  readonly #database: Database;
  readonly #providers: IdentityProviderService;
  readonly #adapters: Map<string, IdentityProviderAdapter>;
  readonly #accounts: AccountService;
  readonly #signIn: SignInService;
  readonly #sessions: SessionService;
  readonly #challenges: ChallengeStore;
  readonly #audit: AuditLog;
  readonly #notifications: NotificationService;
  readonly #mail: MailService | undefined;
  readonly #settings: SettingsService;
  readonly #rateLimiter: RateLimiter;
  readonly #throttle: SignInThrottle | undefined;
  readonly #mapping: GroupMappingService;
  readonly #lifecycle: AccountLifecycleService | undefined;
  readonly #clock: () => Date;

  constructor(options: {
    database: Database;
    providers: IdentityProviderService;
    adapters: IdentityProviderAdapter[];
    accounts: AccountService;
    signIn: SignInService;
    sessions: SessionService;
    challenges: ChallengeStore;
    audit: AuditLog;
    notifications: NotificationService;
    mail?: MailService;
    settings: SettingsService;
    rateLimiter: RateLimiter;
    throttle?: SignInThrottle;
    mapping: GroupMappingService;
    lifecycle?: AccountLifecycleService;
    clock?: () => Date;
  }) {
    this.#database = options.database;
    this.#providers = options.providers;
    this.#adapters = new Map(options.adapters.map((adapter) => [adapter.type, adapter]));
    this.#accounts = options.accounts;
    this.#signIn = options.signIn;
    this.#sessions = options.sessions;
    this.#challenges = options.challenges;
    this.#audit = options.audit;
    this.#notifications = options.notifications;
    this.#mail = options.mail;
    this.#settings = options.settings;
    this.#rateLimiter = options.rateLimiter;
    this.#throttle = options.throttle;
    this.#mapping = options.mapping;
    this.#lifecycle = options.lifecycle;
    this.#clock = options.clock ?? (() => new Date());
  }

  #adapter(type: string): IdentityProviderAdapter {
    const adapter = this.#adapters.get(type);
    if (!adapter) throw new Error(`No adapter for ${type} providers`);
    return adapter;
  }

  async #load(providerId: string, purpose?: ProviderFlowPurpose) {
    const loaded = await this.#providers.definition(providerId);
    if (!loaded) throw new OrganizationError("notFound", "The identity provider does not exist");
    if (!loaded.active && purpose !== undefined && purpose !== "test") {
      throw new OrganizationError("providerDeactivated", "The identity provider is deactivated");
    }
    return loaded;
  }

  async start(input: {
    providerId: string;
    purpose: ProviderFlowPurpose;
    baseUrl: string;
    returnTo?: string | null;
    sessionId?: string | null;
    accountId?: string | null;
    clientIp?: string | undefined;
    challengeId?: string | null;
  }): Promise<StartedFlow> {
    await this.#limit("providerStart", input.clientIp, STARTS_PER_CLIENT);
    const { provider, credentials } = await this.#load(input.providerId, input.purpose);
    if (input.purpose === "reauthentication") {
      const [identity] = await this.#database
        .select({ id: identities.id })
        .from(identities)
        .where(and(eq(identities.providerId, provider.id), eq(identities.accountId, input.accountId ?? "")));
      if (!identity) throw new OrganizationError("notFound", "The account is not linked to this provider");
    }
    if (provider.type === "ldap") {
      throw new OrganizationError("invalidInput", "Directory providers sign in on the Lunedo page");
    }
    const browserToken = client.randomState();
    const state = client.randomState();
    const nonce = client.randomNonce();
    const codeVerifier = client.randomPKCECodeVerifier();
    const base = input.baseUrl.replace(/\/+$/, "");
    const redirectUri =
      provider.type === "saml"
        ? `${base}${samlPaths(provider.id).acs}`
        : `${base}${callbackPath(provider.id)}`;
    const started = await this.#adapter(provider.type).authorizationUrl(provider, credentials, {
      redirectUri,
      state,
      nonce,
      codeChallenge: await client.calculatePKCECodeChallenge(codeVerifier),
      reauthenticate: input.purpose === "reauthentication" || input.purpose === "linkConfirmation",
    });
    const url = started.url;
    await this.#database.insert(providerFlows).values({
      purpose: input.purpose,
      providerId: provider.id,
      stateHash: hashState(state),
      browserHash: hashState(browserToken),
      nonce: provider.type === "oidc" ? nonce : null,
      codeVerifier: provider.type === "oidc" ? codeVerifier : null,
      requestId: started.requestId,
      redirectUri,
      sessionId: input.sessionId ?? null,
      challengeId: input.challengeId ?? null,
      returnTo: input.returnTo ?? null,
      expiresAt: new Date(this.#clock().getTime() + FLOW_LIFETIME_MS),
    });
    return { url: url.toString(), browserToken };
  }

  async callback(input: {
    providerId: string;
    query: URLSearchParams;
    browserToken: string | undefined;
    client: ClientInfo;
  }): Promise<CallbackResult> {
    const started = await this.#databaseNow();
    const state = input.query.get("state") ?? "";
    const [flow] = await this.#database
      .update(providerFlows)
      .set({ consumedAt: this.#clock() })
      .where(
        and(
          eq(providerFlows.stateHash, hashState(state)),
          eq(providerFlows.providerId, input.providerId),
          isNull(providerFlows.consumedAt),
          gt(providerFlows.expiresAt, this.#clock()),
        ),
      )
      .returning();
    if (!flow) throw new ChallengeExpiredError();
    if (
      !input.browserToken ||
      !secretsEqual(hashState(input.browserToken).toString("hex"), flow.browserHash.toString("hex"))
    ) {
      if (flow.purpose !== "test") throw new ChallengeExpiredError();
      return this.#testFailed(flow, {
        error: "The test sign-in returned in another browser or after the browser cookie was lost",
        reason: "browserChanged",
      });
    }
    const { provider, credentials } = await this.#load(flow.providerId, flow.purpose);
    const callbackUrl = new URL(flow.redirectUri);
    callbackUrl.search = input.query.toString();

    if (input.query.has("error") && flow.purpose === "test") {
      await this.#forgetResponse(flow.id);
      return this.#testFailed(flow, providerRefusal(input.query));
    }
    let result: Awaited<ReturnType<IdentityProviderAdapter["completeSignIn"]>>;
    try {
      if (input.query.has("error")) throw new ProviderResponseError("The provider refused the sign-in");
      if (provider.type === "saml" && !flow.samlResponse) throw new ChallengeExpiredError();
      result = await this.#adapter(provider.type).completeSignIn(provider, credentials, {
        callbackUrl,
        redirectUri: flow.redirectUri,
        state,
        nonce: flow.nonce ?? "",
        codeVerifier: flow.codeVerifier ?? "",
        requestId: flow.requestId,
        samlResponse: flow.samlResponse,
      });
      if (result.assertion) await this.#consumeAssertion(provider.id, result.assertion);
    } catch (error) {
      if (!(error instanceof ProviderPolicyError) && !(error instanceof ProviderResponseError)) throw error;
      await this.#forgetResponse(flow.id);
      if (flow.purpose === "test") return this.#testFailed(flow, testFailure(error));
      const reason =
        error instanceof ProviderPolicyError && error.reason === "domainNotAllowed"
          ? "domainNotAllowed"
          : "invalidResponse";
      return this.#refuse({ providerId: provider.id, reason });
    }
    await this.#forgetResponse(flow.id);
    const profile = result.profile;
    const emailVerified = this.#emailVerified(provider.config.domains, profile);

    if (flow.purpose === "test") {
      const test: TestResult = {
        subject: profile.subject,
        email: profile.email,
        emailVerified,
        signInName: profile.signInName,
        displayName: profile.displayName,
        groups: profile.groups,
        claims: result.claims,
      };
      await this.#database.update(providerFlows).set({ result: test }).where(eq(providerFlows.id, flow.id));
      return { kind: "tested", flowId: flow.id, returnTo: flow.returnTo };
    }

    if (flow.purpose === "reauthentication") {
      return this.#reauthenticate(
        flow,
        provider.id,
        profile,
        result.authTime,
        provider.type === "ldap" || providerProvedSecondFactor(provider.config.secondFactor, result.methods),
      );
    }
    if (flow.purpose === "linkConfirmation") {
      return this.#confirmLink(
        flow,
        provider,
        profile,
        result.authTime,
        result.methods,
        input.client,
        started,
      );
    }

    if (
      provider.type !== "ldap" &&
      !providerProvedSecondFactor(provider.config.secondFactor, result.methods)
    ) {
      return this.#refuse({ providerId: provider.id, reason: "secondFactorMissing", profile });
    }
    const { groups, failed: groupsFailed } = await this.#groups(provider, credentials, profile);
    await this.#trackGroupsClaim(provider.id, profile);
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.#signInWith({
          provider,
          profile,
          groups,
          groupsFailed,
          emailVerified,
          secondFactor: "policy",
          providerSessionId: result.providerSessionId,
          client: input.client,
          returnTo: flow.returnTo,
          started,
        });
      } catch (error) {
        if (error instanceof Refused) {
          return this.#refuse({
            providerId: provider.id,
            reason: error.reason,
            profile,
          });
        }
        if (attempt === 0 && isUniqueViolation(error)) continue;
        if (error instanceof ZodError) {
          return this.#refuse({ providerId: provider.id, reason: "invalidResponse", profile });
        }
        throw error;
      }
    }
  }

  async #trackGroupsClaim(providerId: string, profile: ProviderProfile): Promise<void> {
    if (profile.groupsClaimMissing === undefined) return;
    await this.#database.transaction(async (tx) => {
      if (profile.groupsClaimMissing) {
        await tx
          .update(identityProviders)
          .set({ groupsClaimMissingSince: this.#clock() })
          .where(
            and(
              eq(identityProviders.id, providerId),
              isNull(identityProviders.groupsClaimMissingSince),
              isNotNull(identityProviders.groupsClaimSeenAt),
            ),
          );
        await runWithRequestContext(
          { requestId: currentRequestContext()?.requestId ?? randomUUID(), actor: SYSTEM },
          () =>
            this.#audit.record(tx, {
              name: "auth.groupsClaimMissing",
              actor: SYSTEM,
              targetId: providerId,
              fields: {},
            }),
        );
        return;
      }
      await tx
        .update(identityProviders)
        .set({
          groupsClaimSeenAt: sql`coalesce(${identityProviders.groupsClaimSeenAt}, ${this.#clock()})`,
          groupsClaimMissingSince: null,
        })
        .where(
          and(
            eq(identityProviders.id, providerId),
            or(
              isNull(identityProviders.groupsClaimSeenAt),
              isNotNull(identityProviders.groupsClaimMissingSince),
            ),
          ),
        );
    });
  }

  async #groups(
    provider: ProviderDefinition,
    credentials: Parameters<IdentityProviderAdapter["completeSignIn"]>[1],
    profile: ProviderProfile,
  ): Promise<{ groups: ProviderProfile["groups"]; failed: boolean }> {
    const adapter = this.#adapter(provider.type);
    if (profile.groups !== null) {
      return { groups: await this.#withNames(adapter, provider, credentials, profile.groups), failed: false };
    }
    if (!adapter.readGroups) return { groups: null, failed: false };
    try {
      return { groups: await adapter.readGroups(provider, credentials, profile.subject), failed: false };
    } catch {
      return { groups: null, failed: true };
    }
  }

  async #withNames(
    adapter: IdentityProviderAdapter,
    provider: ProviderDefinition,
    credentials: Parameters<IdentityProviderAdapter["completeSignIn"]>[1],
    groups: ProviderGroup[],
  ): Promise<ProviderGroup[]> {
    const unnamed = groups.filter((group) => group.name === null).map((group) => group.id);
    if (unnamed.length === 0 || !adapter.readGroupNames || !adapter.hasDirectory?.(provider)) return groups;
    let named: ProviderGroup[];
    try {
      named = await adapter.readGroupNames(provider, credentials, unnamed);
    } catch {
      return groups;
    }
    const names = new Map(named.map((group) => [group.id.toLowerCase(), group.name]));
    return groups.map((group) =>
      group.name === null ? { ...group, name: names.get(group.id.toLowerCase()) ?? null } : group,
    );
  }

  #emailVerified(domains: readonly string[], profile: ProviderProfile): boolean {
    const domain = domainOf(profile.email);
    return domain !== null && domains.includes(domain);
  }

  async #databaseNow(): Promise<Date> {
    const result = await this.#database.execute<{ now: Date | string }>(sql`select now() as now`);
    return new Date(result.rows[0]?.now ?? Date.now());
  }

  async #signInWith(input: {
    provider: ProviderDefinition;
    profile: ProviderProfile;
    groups: ProviderProfile["groups"];
    groupsFailed: boolean;
    emailVerified: boolean;
    secondFactor: boolean | "policy";
    providerSessionId: string | null;
    client: ClientInfo;
    returnTo: string | null;
    started: Date;
  }): Promise<CallbackResult> {
    const { provider, profile } = input;
    const [identity] = await this.#database
      .select()
      .from(identities)
      .where(and(eq(identities.providerId, provider.id), eq(identities.subject, profile.subject)));
    if (identity) {
      const account = await this.#accounts.get(identity.accountId);
      if (!canSignIn(account)) throw new Refused("accountInactive");
      return this.#withSession(
        account,
        async (tx, mailIds) => {
          await tx
            .update(identities)
            .set({
              email: profile.email,
              emailVerified: input.emailVerified,
              signInName: profile.signInName,
              displayName: profile.displayName,
              lastSignInAt: this.#clock(),
            })
            .where(eq(identities.id, identity.id));
          await this.#mapping.applyAtSignIn(
            tx,
            {
              providerId: provider.id,
              identityId: identity.id,
              accountId: account.id,
              groups: input.groups,
              groupsFailed: input.groupsFailed,
            },
            mailIds,
          );
          const mailId = await takeOverLocalCredentials(
            tx,
            { audit: this.#audit, mail: this.#mail },
            account.id,
            accountPrincipal(account.id),
            "signIn",
          );
          if (mailId) mailIds.push(mailId);
          return identity.id;
        },
        { ...input, returnTo: input.returnTo },
      );
    }

    let placeholder: Account | null = null;
    if (input.emailVerified && profile.email) {
      const existing = await this.#accounts.findByEmail(profile.email);
      if (existing?.state === "placeholder") {
        if (profile.emailUnverified) throw new Refused("emailNotVerified");
        placeholder = existing;
      } else if (existing) {
        if (!canSignIn(existing)) throw new Refused("accountInactive");
        if (!(await confirmsLinks(this.#database, existing.id))) {
          if (profile.emailUnverified) throw new Refused("emailNotVerified");
          const adopted = await this.#adoptExisting(existing, input);
          if (adopted) return adopted;
        }
        const ways = await this.#linkWays(existing);
        if (!ways.password && !ways.passkey && ways.providers.length === 0) {
          throw new Refused("linkUnavailable");
        }
        const payload: PendingIdentity = {
          providerId: provider.id,
          subject: profile.subject,
          email: profile.email,
          signInName: profile.signInName,
          displayName: profile.displayName,
          providerSessionId: input.providerSessionId,
          groups: input.groups,
        };
        const pending = await this.#challenges.create(this.#database, {
          purpose: "identityLink",
          accountId: existing.id,
          payload,
          withToken: true,
          lifetimeMs: IDENTITY_LINK_LIFETIME_MS,
        });
        return { kind: "linkRequired", pendingToken: pending.token ?? "" };
      }
    }

    const creation = provider.config.accountCreation;
    if (!creation.enabled) throw new Refused("accountCreationDisabled");
    if (!profile.email || !input.emailVerified) throw new Refused("domainNotAllowed");
    if (creation.requiredGroups.length > 0) {
      const held = new Set((input.groups ?? []).map((group) => group.id));
      if (!creation.requiredGroups.some((group) => held.has(group))) throw new Refused("groupRequired");
    }
    const email = profile.email;
    const ruleHome = await this.#mapping.homeOrganizationFor(
      this.#database,
      provider.id,
      (input.groups ?? []).map((group) => group.id),
    );
    const home = ruleHome ?? (await this.#homeOrganization(email));
    return this.#withSession(
      null,
      async (tx, mailIds) => {
        const account = placeholder
          ? await this.#adopt(
              tx,
              placeholder,
              profile.displayName ?? placeholder.name,
              ruleHome ? null : home,
            )
          : await this.#accounts.createFromProvider(tx, {
              email,
              name: profile.displayName ?? email,
              homeOrganizationId: ruleHome ? null : home,
            });
        const [created] = await tx
          .insert(identities)
          .values({
            accountId: account.id,
            providerId: provider.id,
            subject: profile.subject,
            email,
            emailVerified: true,
            signInName: profile.signInName,
            displayName: profile.displayName,
            lastSignInAt: this.#clock(),
          })
          .returning({ id: identities.id });
        if (!created) throw new Error("The identity was not stored");
        await this.#mapping.applyAtSignIn(tx, {
          providerId: provider.id,
          identityId: created.id,
          accountId: account.id,
          groups: input.groups,
        });
        const [membership] = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(eq(memberships.accountId, account.id))
          .limit(1);
        if (!membership) {
          const notified = await this.#notifications.notify(tx, {
            type: "account.withoutOrganization",
            recipients: await instanceAdministratorIds(tx),
            organizationId: null,
            targetId: account.id,
            params: { accountName: account.name, email: account.email, providerName: provider.name },
          });
          mailIds.push(...notified.mailIds);
        }
        const scope = home ? { scope: { type: "organization" as const, id: home } } : {};
        if (!placeholder) {
          await this.#audit.record(tx, {
            name: "account.createdAtSignIn",
            actor: SYSTEM,
            targetId: account.id,
            fields: { providerId: provider.id, organizationId: home },
            ...scope,
          });
        }
        await this.#audit.record(tx, {
          name: "identity.linked",
          actor: SYSTEM,
          targetId: account.id,
          fields: { providerId: provider.id, via: "signIn" },
          ...scope,
        });
        await refreshManagedAccounts(tx, this.#audit, { accountIds: [account.id] }, SYSTEM);
        return { identityId: created.id, account };
      },
      input,
    );
  }

  async #adoptExisting(
    existing: Account & { email: string },
    input: {
      provider: ProviderDefinition;
      profile: ProviderProfile;
      groups: ProviderProfile["groups"];
      groupsFailed: boolean;
      secondFactor: boolean | "policy";
      providerSessionId: string | null;
      client: ClientInfo;
      returnTo: string | null;
      started: Date;
    },
  ): Promise<CallbackResult | null> {
    const { provider, profile } = input;
    try {
      return await this.#withSession(
        existing,
        async (tx, mailIds) => {
          const account = await this.#accounts.lock(tx, existing.id);
          if (!canSignIn(account)) throw new Refused("accountInactive");
          if (await confirmsLinks(tx, account.id)) throw new LinkConfirmationRequired();
          const [other] = await tx
            .select({ id: identities.id, subject: identities.subject })
            .from(identities)
            .where(and(eq(identities.accountId, account.id), eq(identities.providerId, provider.id)));
          if (other?.subject === profile.subject) return other.id;
          if (other) throw new Refused("linkAmbiguous");
          const [created] = await tx
            .insert(identities)
            .values({
              accountId: account.id,
              providerId: provider.id,
              subject: profile.subject,
              email: profile.email,
              emailVerified: true,
              signInName: profile.signInName,
              displayName: profile.displayName,
              lastSignInAt: this.#clock(),
            })
            .returning({ id: identities.id });
          if (!created) throw new Error("The identity was not stored");
          await this.#mapping.applyAtSignIn(
            tx,
            {
              providerId: provider.id,
              identityId: created.id,
              accountId: account.id,
              groups: input.groups,
              groupsFailed: input.groupsFailed,
            },
            mailIds,
          );
          const scope = account.homeOrganizationId
            ? { scope: { type: "organization" as const, id: account.homeOrganizationId } }
            : {};
          await this.#audit.record(tx, {
            name: "identity.linked",
            actor: accountPrincipal(account.id),
            targetId: account.id,
            fields: { providerId: provider.id, via: "signIn" },
            ...scope,
          });
          await refreshManagedAccounts(
            tx,
            this.#audit,
            { accountIds: [account.id] },
            accountPrincipal(account.id),
          );
          const mailId = await takeOverLocalCredentials(
            tx,
            { audit: this.#audit, mail: this.#mail },
            account.id,
            accountPrincipal(account.id),
            "signIn",
          );
          if (mailId) mailIds.push(mailId);
          return created.id;
        },
        input,
      );
    } catch (error) {
      if (error instanceof LinkConfirmationRequired) return null;
      throw error;
    }
  }

  async #adopt(
    tx: Transaction,
    placeholder: Account,
    name: string,
    homeOrganizationId: string | null,
  ): Promise<Account> {
    if (
      !this.#lifecycle ||
      !(await this.#lifecycle.adoptPlaceholder(tx, placeholder.id, { name, homeOrganizationId }))
    ) {
      throw new Refused("accountInactive");
    }
    const account = await this.#accounts.get(placeholder.id, tx);
    if (!account) throw new Refused("accountInactive");
    return account;
  }

  async #homeOrganization(email: string): Promise<string | null> {
    const domain = domainOf(email);
    if (!domain) return null;
    const [owner] = await this.#database
      .select({ organizationId: organizationDomains.organizationId })
      .from(organizationDomains)
      .where(eq(organizationDomains.domain, domain));
    return owner?.organizationId ?? null;
  }

  async #withSession(
    account: (Account & { email: string }) | null,
    prepare: (
      tx: Transaction,
      mailIds: string[],
    ) => Promise<string | { identityId: string; account: Account }>,
    input: {
      provider: { id: string };
      providerSessionId: string | null;
      client: ClientInfo;
      returnTo: string | null;
      started: Date;
      secondFactor: boolean | "policy";
    },
  ): Promise<CallbackResult> {
    const mailIds: string[] = [];
    const outcome = await this.#database.transaction(async (tx) => {
      const prepared = await prepare(tx, mailIds);
      const identityId = typeof prepared === "string" ? prepared : prepared.identityId;
      const target = typeof prepared === "string" ? account : prepared.account;
      if (!target) throw new Error("No account to sign in");
      const session = {
        providerId: input.provider.id,
        identityId,
        providerSessionId: input.providerSessionId,
      };
      const secondFactor =
        input.secondFactor === "policy"
          ? await this.#signIn.secondFactorRequired(target.id, tx)
          : input.secondFactor;
      if (secondFactor) {
        const pending = await this.#signIn.providerSecondFactor(tx, target, session, input.client);
        if (pending) return pending;
      }
      return this.#signIn.createProviderSession(
        tx,
        target,
        session,
        input.client,
        mailIds,
        input.started,
        secondFactor ? "secondFactorSetup" : "full",
      );
    });
    await this.#notifications.dispatch(mailIds);
    if ("pendingToken" in outcome) {
      return { kind: "secondFactorRequired", ...outcome, returnTo: input.returnTo };
    }
    return { kind: "signedIn", signedIn: outcome, returnTo: input.returnTo };
  }

  async #reauthenticate(
    flow: typeof providerFlows.$inferSelect,
    providerId: string,
    profile: ProviderProfile,
    authTime: number | null,
    proved: boolean,
  ): Promise<CallbackResult> {
    if (!flow.sessionId) throw new ChallengeExpiredError();
    const [session] = await this.#database
      .select({ id: sessions.id, accountId: sessions.accountId })
      .from(sessions)
      .where(eq(sessions.id, flow.sessionId));
    if (!session) throw new ChallengeExpiredError();
    const [identity] = await this.#database
      .select({ accountId: identities.accountId })
      .from(identities)
      .where(and(eq(identities.providerId, providerId), eq(identities.subject, profile.subject)));
    const fresh = authTime !== null && authTime * 1000 >= flow.createdAt.getTime() - AUTH_TIME_TOLERANCE_MS;
    if (identity?.accountId !== session.accountId || !fresh || !proved) {
      await this.#audit.recordAlone({
        name: "auth.reauthenticationFailed",
        actor: accountPrincipal(session.accountId),
        targetId: session.accountId,
        fields: { sessionId: session.id, method: "identityProvider" },
      });
      throw new ChallengeExpiredError();
    }
    const token = await this.#database.transaction(async (tx) => {
      const rotated = await this.#sessions.rotate(tx, session.id, { reauthenticated: true });
      await this.#audit.record(tx, {
        name: "auth.reauthenticated",
        actor: accountPrincipal(session.accountId),
        targetId: session.accountId,
        fields: { sessionId: session.id, method: "identityProvider" },
      });
      return rotated;
    });
    return { kind: "reauthenticated", token, returnTo: flow.returnTo };
  }

  async #refuse(input: {
    providerId: string;
    reason: SignInRefusalReason;
    profile?: ProviderProfile;
    accountId?: string | null;
  }): Promise<CallbackResult> {
    const code = reference();
    await this.#database.transaction(async (tx) => {
      await tx.insert(signInRefusals).values({
        reference: code,
        providerId: input.providerId,
        reason: input.reason,
        subject: input.profile?.subject ?? null,
        email: input.profile?.email ?? null,
        displayName: input.profile?.displayName ?? null,
        accountId: input.accountId ?? null,
      });
      await this.#audit.record(tx, {
        name: "auth.signInRefused",
        actor: ANONYMOUS,
        targetId: input.providerId,
        fields: { reason: input.reason, reference: code },
      });
    });
    return { kind: "refused", reference: code, reason: input.reason };
  }

  async #linkWays(account: Account): Promise<LinkWays> {
    const factors = await secondFactorsOf(this.#database, account.id);
    const linked = await this.#database
      .select({ id: identityProviders.id, name: identityProviders.name, type: identityProviders.type })
      .from(identities)
      .innerJoin(identityProviders, eq(identityProviders.id, identities.providerId))
      .where(and(eq(identities.accountId, account.id), isNull(identityProviders.deactivatedAt)))
      .orderBy(identityProviders.name);
    return {
      password: this.#signIn.passwordConfirmsLink(account),
      passkey: factors.passkeys > 0,
      providers: linked.map((row) => ({ id: row.id, name: row.name, directory: row.type === "ldap" })),
    };
  }

  async #pendingLink(pendingToken: string) {
    const pending = await this.#challenges.findByToken(pendingToken, "identityLink");
    const account = pending?.accountId ? await this.#accounts.get(pending.accountId) : null;
    const identity = pending?.payload as PendingIdentity | undefined;
    if (!pending || !account || !canSignIn(account) || !identity) throw new ChallengeExpiredError();
    return { pending, account, identity };
  }

  async #linkedIdentity(
    accountId: string,
    providerId: string,
  ): Promise<{ subject: string; signInName: string | null }> {
    const [identity] = await this.#database
      .select({ subject: identities.subject, signInName: identities.signInName })
      .from(identities)
      .where(and(eq(identities.providerId, providerId), eq(identities.accountId, accountId)));
    if (!identity) throw new OrganizationError("notFound", "The account is not linked to this provider");
    return identity;
  }

  async startLinkConfirmation(input: {
    pendingToken: string;
    providerId: string;
    baseUrl: string;
    clientIp?: string | undefined;
  }): Promise<StartedFlow> {
    const { pending, account } = await this.#pendingLink(input.pendingToken);
    await this.#linkedIdentity(account.id, input.providerId);
    return this.start({
      providerId: input.providerId,
      purpose: "linkConfirmation",
      baseUrl: input.baseUrl,
      clientIp: input.clientIp,
      challengeId: pending.id,
    });
  }

  async #finishLink(
    pendingId: string,
    account: Account,
    factorRequired: boolean,
    client: ClientInfo,
    started: Date,
  ): Promise<{ signedIn: SignedIn } | { confirmed: true }> {
    const factors = await secondFactorsOf(this.#database, account.id);
    if (factorRequired && hasSecondFactor(factors)) {
      await this.#signIn.markIdentityLinkConfirmed(pendingId, "identityProvider");
      return { confirmed: true };
    }
    const kind = factorRequired ? "secondFactorSetup" : "full";
    return { signedIn: await this.#signIn.completeIdentityLink(pendingId, [], kind, client, started) };
  }

  async #confirmLink(
    flow: typeof providerFlows.$inferSelect,
    provider: ProviderDefinition,
    profile: ProviderProfile,
    authTime: number | null,
    methods: readonly string[],
    client: ClientInfo,
    started: Date,
  ): Promise<CallbackResult> {
    const pending = flow.challengeId
      ? await this.#challenges.findById(flow.challengeId, "identityLink")
      : null;
    const account = pending?.accountId ? await this.#accounts.get(pending.accountId) : null;
    if (!pending || !canSignIn(account)) throw new ChallengeExpiredError();
    const [identity] = await this.#database
      .select({ accountId: identities.accountId })
      .from(identities)
      .where(and(eq(identities.providerId, provider.id), eq(identities.subject, profile.subject)));
    const fresh = authTime !== null && authTime * 1000 >= flow.createdAt.getTime() - AUTH_TIME_TOLERANCE_MS;
    if (identity?.accountId !== account.id || !fresh) {
      await this.#challenges.recordFailure(pending.id);
      await this.#audit.recordAlone({
        name: "auth.signInFailed",
        actor: ANONYMOUS,
        targetId: account.id,
        fields: { reason: "invalidCredentials", method: "identityProvider" },
      });
      throw new ChallengeExpiredError();
    }
    if (provider.type !== "ldap" && !providerProvedSecondFactor(provider.config.secondFactor, methods)) {
      await this.#challenges.recordFailure(pending.id);
      throw new ChallengeExpiredError();
    }
    const outcome = await this.#finishLink(
      pending.id,
      account,
      await this.#signIn.secondFactorRequired(account.id),
      client,
      started,
    );
    if ("confirmed" in outcome) return { kind: "linkConfirmed" };
    return { kind: "signedIn", signedIn: outcome.signedIn, returnTo: null };
  }

  async confirmLinkWithDirectory(input: {
    pendingToken: string;
    providerId: string;
    password: string;
    client: ClientInfo;
  }): Promise<{ signedIn: SignedIn } | { confirmed: true }> {
    const started = await this.#databaseNow();
    const { pending, account } = await this.#pendingLink(input.pendingToken);
    const { provider, credentials } = await this.#load(input.providerId, "signIn");
    const adapter = this.#adapter(provider.type);
    if (provider.type !== "ldap" || !adapter.verifyPassword) {
      throw new OrganizationError("invalidInput", "This provider confirms the identity through its own page");
    }
    const { subject, signInName } = await this.#linkedIdentity(account.id, provider.id);
    const subjects = this.#directorySubjects(provider.id, signInName ?? subject, input.client.ip);
    await this.#checkDirectoryAttempt(subjects);
    let valid = false;
    if (directoryPasswordSchema.safeParse(input.password).success) {
      try {
        valid = await adapter.verifyPassword(provider, credentials, subject, input.password);
      } catch (error) {
        if (!(error instanceof DirectorySignInError)) throw error;
      }
    }
    if (!valid) {
      await this.#challenges.recordFailure(pending.id);
      await this.#directoryFailure(subjects, "invalidCredentials");
      throw new InvalidCredentialsError();
    }
    await this.#throttle?.recordSuccess(subjects.email ?? "");
    const factorRequired =
      provider.config.secondFactor.mode === "lunedo" || (await this.#signIn.secondFactorRequired(account.id));
    return this.#finishLink(pending.id, account, factorRequired, input.client, started);
  }

  async linkInfo(pendingToken: string): Promise<LinkInfo> {
    const { pending, account, identity } = await this.#pendingLink(pendingToken);
    const loaded = await this.#providers.definition(identity.providerId);
    if (!loaded) throw new ChallengeExpiredError();
    const factors = await secondFactorsOf(this.#database, account.id);
    return {
      ...(await this.#linkWays(account)),
      confirmed: pending.methods.includes("identityProvider"),
      providerName: loaded.provider.name,
      email: identity.email,
      accountName: account.name,
      factors: [
        ...(factors.totp ? (["totp"] as const) : []),
        ...(factors.passkeys > 0 ? (["passkey"] as const) : []),
        ...(factors.recoveryCodes > 0 ? (["recoveryCode"] as const) : []),
      ],
    };
  }

  async declineLink(pendingToken: string): Promise<{ reference: string }> {
    const pending = await this.#challenges.findByToken(pendingToken, "identityLink");
    const identity = pending?.payload as PendingIdentity | undefined;
    if (!pending || !identity) throw new ChallengeExpiredError();
    const consumed = await this.#challenges.consume(this.#database, pending.id);
    if (!consumed) throw new ChallengeExpiredError();
    const result = await this.#refuse({
      providerId: identity.providerId,
      reason: "linkDeclined",
      profile: {
        subject: identity.subject,
        email: identity.email,
        signInName: identity.signInName,
        displayName: identity.displayName,
        groups: null,
      },
      accountId: pending.accountId,
    });
    return { reference: result.kind === "refused" ? result.reference : "" };
  }

  async #testFailed(
    flow: { id: string; returnTo: string | null },
    failure: TestFailure,
  ): Promise<CallbackResult> {
    await this.#database.update(providerFlows).set({ result: failure }).where(eq(providerFlows.id, flow.id));
    return { kind: "tested", flowId: flow.id, returnTo: flow.returnTo };
  }

  async testResult(flowId: string, sessionId: string): Promise<TestResult | TestFailure | null> {
    const [flow] = await this.#database
      .select({ result: providerFlows.result })
      .from(providerFlows)
      .where(
        and(
          eq(providerFlows.id, flowId),
          eq(providerFlows.purpose, "test"),
          eq(providerFlows.sessionId, sessionId),
        ),
      );
    const result = flow?.result as TestResult | TestFailure | { error: string } | null | undefined;
    if (!result) return null;
    if ("error" in result && !("reason" in result)) return { error: result.error, reason: "invalidResponse" };
    return result;
  }

  async signInOptions(lastProviderId: string | null): Promise<SignInOptions> {
    const providers = await this.#providers.signInProviders();
    return {
      providers,
      lastProvider: providers.find((provider) => provider.id === lastProviderId) ?? null,
      passkeys: true,
    };
  }

  async discover(email: string, clientIp?: string): Promise<SignInStep> {
    const limit = await this.#rateLimiter.consume(
      `signInDiscovery:client:${clientSubject(clientIp ?? "unknown")}`,
      DISCOVERIES_PER_CLIENT,
      60,
    );
    if (!limit.allowed) throw new RateLimitedError(limit.retryAfterSeconds);
    const domain = domainOf(email);
    const provider = domain ? await this.#providers.providerForDomain(domain) : null;
    if (provider?.type === "ldap") {
      const loaded = await this.#providers.definition(provider.id);
      if (loaded?.provider.type === "ldap") {
        const attribute = loaded.provider.config.signInAttribute;
        return {
          step: "directory",
          providerId: provider.id,
          name: provider.name,
          preset: provider.preset,
          signInName: attribute === "mail" ? "email" : attribute,
        };
      }
    }
    if (provider) {
      return { step: "provider", providerId: provider.id, name: provider.name, preset: provider.preset };
    }
    return { step: "password" };
  }

  async refusal(code: string): Promise<SignInRefusal | null> {
    const [row] = await this.#database
      .select()
      .from(signInRefusals)
      .where(eq(signInRefusals.reference, code));
    if (!row) return null;
    return {
      reference: row.reference,
      reason: row.reason,
      providerId: row.providerId,
      subject: row.subject,
      email: row.email,
      displayName: row.displayName,
      accountId: row.accountId,
      createdAt: row.createdAt,
    };
  }

  async #limit(kind: string, clientIp: string | undefined, perMinute: number): Promise<void> {
    if (clientIp === undefined) return;
    const limit = await this.#rateLimiter.consume(`${kind}:client:${clientSubject(clientIp)}`, perMinute, 60);
    if (!limit.allowed) throw new RateLimitedError(limit.retryAfterSeconds);
  }

  async backchannelLogout(providerId: string, logoutToken: string, clientIp?: string): Promise<number> {
    await this.#limit("providerLogout", clientIp, LOGOUTS_PER_CLIENT);
    const { provider, credentials } = await this.#load(providerId);
    const adapter = this.#adapter(provider.type);
    if (!adapter.verifyLogout)
      throw new ProviderResponseError("The provider does not sign people out this way");
    const logout = await adapter.verifyLogout(provider, credentials, logoutToken);
    return this.#database.transaction(async (tx) => {
      const recorded = await tx
        .insert(providerLogoutTokens)
        .values({ providerId, tokenId: logout.tokenId, expiresAt: logout.expiresAt })
        .onConflictDoNothing()
        .returning({ tokenId: providerLogoutTokens.tokenId });
      if (recorded.length === 0) throw new ProviderResponseError("The logout token was used before");
      const matches = [
        ...(logout.subject
          ? [
              sql`${sessions.identityId} in (select id from identities where provider_id = ${providerId} and subject = ${logout.subject})`,
            ]
          : []),
        ...(logout.providerSessionId
          ? [
              sql`(${sessions.providerSessionId} = ${logout.providerSessionId} and ${sessions.identityId} in (select id from identities where provider_id = ${providerId}))`,
            ]
          : []),
      ];
      const ended = await tx
        .delete(sessions)
        .where(or(...matches))
        .returning({ id: sessions.id, accountId: sessions.accountId });
      await this.#audit.record(tx, {
        name: "auth.providerSignedOut",
        actor: SYSTEM,
        targetId: providerId,
        fields: { endedSessions: ended.length },
      });
      return ended.length;
    });
  }

  async #consumeAssertion(providerId: string, assertion: { id: string; expiresAt: Date }): Promise<void> {
    const stored = await this.#database
      .insert(samlAssertions)
      .values({ providerId, assertionId: assertion.id, expiresAt: assertion.expiresAt })
      .onConflictDoNothing()
      .returning({ assertionId: samlAssertions.assertionId });
    if (stored.length === 0) throw new ProviderResponseError("The assertion was used before");
  }

  async #forgetResponse(flowId: string): Promise<void> {
    await this.#database
      .update(providerFlows)
      .set({ samlResponse: null })
      .where(eq(providerFlows.id, flowId));
  }

  async receiveSamlResponse(input: {
    providerId: string;
    samlResponse: string;
    relayState: string | null;
    clientIp?: string | undefined;
  }): Promise<SamlReceipt> {
    await this.#limit("samlResponse", input.clientIp, STARTS_PER_CLIENT);
    const { provider, credentials } = await this.#load(input.providerId, "signIn");
    if (provider.type !== "saml")
      throw new OrganizationError("notFound", "The identity provider does not exist");
    if (input.relayState) {
      const [flow] = await this.#database
        .update(providerFlows)
        .set({ samlResponse: input.samlResponse })
        .where(
          and(
            eq(providerFlows.stateHash, hashState(input.relayState)),
            eq(providerFlows.providerId, provider.id),
            isNull(providerFlows.consumedAt),
            isNull(providerFlows.samlResponse),
            gt(providerFlows.expiresAt, this.#clock()),
          ),
        )
        .returning({ id: providerFlows.id });
      if (flow) return { state: input.relayState, browserToken: null };
    }
    if (!provider.config.idpInitiated) {
      throw new OrganizationError(
        "providerInitiatedSignIn",
        "Sign-in started at the identity provider is turned off for this provider",
      );
    }
    const instanceUrl = await this.#settings.get(instanceUrlSetting, {});
    if (!instanceUrl) {
      throw new OrganizationError(
        "providerInitiatedSignIn",
        "Sign-in started at the identity provider needs the address of the instance in the settings",
      );
    }
    const redirectUri = `${instanceUrl.replace(/\/+$/, "")}${samlPaths(provider.id).acs}`;
    await this.#checkUnsolicitedResponse(provider, credentials, input.samlResponse, redirectUri);
    const state = client.randomState();
    const browserToken = client.randomState();
    await this.#database.insert(providerFlows).values({
      purpose: "signIn",
      providerId: provider.id,
      stateHash: hashState(state),
      browserHash: hashState(browserToken),
      requestId: null,
      samlResponse: input.samlResponse,
      redirectUri,
      expiresAt: new Date(this.#clock().getTime() + FLOW_LIFETIME_MS),
    });
    return { state, browserToken };
  }

  async #checkUnsolicitedResponse(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    samlResponse: string,
    redirectUri: string,
  ): Promise<void> {
    let result: Awaited<ReturnType<IdentityProviderAdapter["completeSignIn"]>>;
    try {
      result = await this.#adapter(provider.type).completeSignIn(provider, credentials, {
        callbackUrl: new URL(redirectUri),
        redirectUri,
        state: "",
        nonce: "",
        codeVerifier: "",
        requestId: null,
        samlResponse,
      });
    } catch (error) {
      if (error instanceof ProviderPolicyError) throw new ProviderResponseError(error.message);
      throw error;
    }
    if (!result.assertion) throw new ProviderResponseError("The SAML response has no assertion");
    const [used] = await this.#database
      .select({ assertionId: samlAssertions.assertionId })
      .from(samlAssertions)
      .where(
        and(eq(samlAssertions.providerId, provider.id), eq(samlAssertions.assertionId, result.assertion.id)),
      );
    if (used) throw new ProviderResponseError("The assertion was used before");
  }

  async serviceProviderMetadata(providerId: string, baseUrl: string): Promise<string> {
    const { provider, credentials } =
      (await this.#providers.draftServiceProvider(providerId)) ?? (await this.#load(providerId));
    const adapter = this.#adapter(provider.type);
    if (!(adapter instanceof SamlAdapter)) {
      throw new OrganizationError("notFound", "The identity provider has no SAML metadata");
    }
    return adapter.serviceProviderMetadata(provider, credentials, baseUrl);
  }

  #directorySubjects(providerId: string, signInName: string, clientIp: string | undefined): ThrottleSubjects {
    return { email: `directory:${providerId}:${signInName.trim().toLowerCase()}`, clientIp };
  }

  async #checkDirectoryAttempt(subjects: ThrottleSubjects): Promise<void> {
    if (!this.#throttle) return;
    const rate = await this.#throttle.attempt(subjects);
    if (!rate.allowed) throw new RateLimitedError(rate.retryAfterSeconds);
    const lockout = await this.#throttle.lockout(subjects);
    if (lockout) {
      await this.#audit.recordAlone({
        name: "auth.signInFailed",
        actor: ANONYMOUS,
        targetId: null,
        fields: {
          reason: lockout.subject === "account" ? "accountLocked" : "clientLocked",
          method: "identityProvider",
        },
      });
      throw new LockedError(Math.max(1, Math.ceil((lockout.lockedUntil.getTime() - Date.now()) / 1000)));
    }
  }

  async #directoryFailure(
    subjects: ThrottleSubjects,
    reason: "invalidCredentials" | (typeof DIRECTORY_AUDIT_REASONS)[keyof typeof DIRECTORY_AUDIT_REASONS],
  ): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const lockouts =
        reason === "invalidCredentials" ? ((await this.#throttle?.recordFailure(subjects, tx)) ?? []) : [];
      await this.#audit.record(tx, {
        name: "auth.signInFailed",
        actor: ANONYMOUS,
        targetId: null,
        fields: { reason, method: "identityProvider" },
      });
      for (const lockout of lockouts) {
        await this.#audit.record(tx, {
          name: "auth.lockedOut",
          actor: ANONYMOUS,
          targetId: null,
          fields: {
            subject: lockout.subject,
            failures: lockout.failures,
            lockedUntil: lockout.lockedUntil.toISOString(),
          },
        });
      }
    });
  }

  async signInWithDirectory(input: {
    providerId: string;
    signInName: string;
    password: string;
    client: ClientInfo;
  }): Promise<CallbackResult> {
    const started = await this.#databaseNow();
    const subjects = this.#directorySubjects(input.providerId, input.signInName, input.client.ip);
    await this.#checkDirectoryAttempt(subjects);
    const { provider, credentials } = await this.#load(input.providerId, "signIn");
    const adapter = this.#adapter(provider.type);
    if (provider.type !== "ldap" || !adapter.authenticate) {
      throw new OrganizationError("invalidInput", "This provider signs in through its own page");
    }
    if (!directoryPasswordSchema.safeParse(input.password).success || input.signInName.trim() === "") {
      await this.#directoryFailure(subjects, "invalidCredentials");
      throw new InvalidCredentialsError();
    }
    let result: Awaited<ReturnType<NonNullable<IdentityProviderAdapter["authenticate"]>>>;
    try {
      result = await adapter.authenticate(provider, credentials, {
        signInName: input.signInName,
        password: input.password,
      });
    } catch (error) {
      if (!(error instanceof DirectorySignInError)) throw error;
      if (error.reason === "invalidCredentials") {
        await this.#directoryFailure(subjects, "invalidCredentials");
        throw new InvalidCredentialsError();
      }
      await this.#directoryFailure(subjects, DIRECTORY_AUDIT_REASONS[error.reason]);
      throw new DirectorySignInRefusedError(error.reason);
    }
    await this.#throttle?.recordSuccess(subjects.email ?? "");
    const profile = result.profile;
    const emailVerified = this.#emailVerified(provider.config.domains, profile);
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.#signInWith({
          provider,
          profile,
          groups: profile.groups,
          groupsFailed: result.groupsFailed,
          emailVerified,
          secondFactor: provider.config.secondFactor.mode === "lunedo" ? true : "policy",
          providerSessionId: null,
          client: input.client,
          returnTo: null,
          started,
        });
      } catch (error) {
        if (error instanceof Refused) {
          return this.#refuse({ providerId: provider.id, reason: error.reason, profile });
        }
        if (attempt === 0 && isUniqueViolation(error)) continue;
        if (error instanceof ZodError) {
          return this.#refuse({ providerId: provider.id, reason: "invalidResponse", profile });
        }
        throw error;
      }
    }
  }

  async reauthenticateWithDirectory(input: {
    sessionId: string;
    accountId: string;
    providerId: string;
    password: string;
    client: ClientInfo;
  }): Promise<string> {
    const subjects = { email: `reauthentication:${input.accountId}`, clientIp: input.client.ip };
    await this.#checkDirectoryAttempt(subjects);
    const { provider, credentials } = await this.#load(input.providerId, "reauthentication");
    const adapter = this.#adapter(provider.type);
    if (provider.type !== "ldap" || !adapter.verifyPassword) {
      throw new OrganizationError("invalidInput", "This provider confirms the identity through its own page");
    }
    const [identity] = await this.#database
      .select({ subject: identities.subject })
      .from(identities)
      .where(and(eq(identities.providerId, provider.id), eq(identities.accountId, input.accountId)));
    if (!identity) throw new OrganizationError("notFound", "The account is not linked to this provider");
    let valid = false;
    if (directoryPasswordSchema.safeParse(input.password).success) {
      try {
        valid = await adapter.verifyPassword(provider, credentials, identity.subject, input.password);
      } catch (error) {
        if (!(error instanceof DirectorySignInError)) throw error;
      }
    }
    if (!valid) {
      await this.#database.transaction(async (tx) => {
        await this.#throttle?.recordFailure(subjects, tx);
        await this.#audit.record(tx, {
          name: "auth.reauthenticationFailed",
          actor: accountPrincipal(input.accountId),
          targetId: input.accountId,
          fields: { sessionId: input.sessionId, method: "identityProvider" },
        });
      });
      throw new InvalidCredentialsError();
    }
    await this.#throttle?.recordSuccess(subjects.email);
    return this.#database.transaction(async (tx) => {
      const token = await this.#sessions.rotate(tx, input.sessionId, { reauthenticated: true });
      await this.#audit.record(tx, {
        name: "auth.reauthenticated",
        actor: accountPrincipal(input.accountId),
        targetId: input.accountId,
        fields: { sessionId: input.sessionId, method: "identityProvider" },
      });
      return token;
    });
  }

  async checkConnection(input: {
    type: "oidc" | "saml" | "ldap";
    config: unknown;
    bindPassword: string | null;
    caCertificate?: string | null;
    providerId: string | null;
    clientIp?: string | undefined;
  }): Promise<ConnectionCheck> {
    await this.#limit("connectionCheck", input.clientIp, CONNECTION_CHECKS_PER_CLIENT);
    const parsed = this.#providers.parseConnection(input.type, input.config);
    if (input.type === "oidc") return this.#providers.checkDiscovery(parsed as OidcConfig);
    if (input.type === "saml") return this.#providers.checkMetadata(parsed as SamlConfig);
    const config = parsed as LdapConfig;
    const stored = input.providerId ? await this.#load(input.providerId) : null;
    const sameTarget =
      stored?.provider.type === "ldap" &&
      stored.provider.config.url === config.url &&
      (stored.provider.config.startTls === config.startTls || config.startTls) &&
      (input.caCertificate == null || input.caCertificate === stored.provider.caCertificates);
    if (input.bindPassword === null && !sameTarget) {
      throw new OrganizationError(
        "invalidInput",
        "Enter the password of the service account to check another server",
      );
    }
    const credentials =
      input.bindPassword !== null
        ? [
            {
              id: "connection-check",
              kind: "bindPassword" as const,
              secret: input.bindPassword,
              keyId: null,
              certificate: null,
            },
          ]
        : (stored?.credentials ?? []);
    const adapter = this.#adapter("ldap");
    if (!adapter.testDirectory) throw new Error("The directory adapter cannot test connections");
    const result = await adapter.testDirectory(
      {
        id: stored?.provider.id ?? "connection-check",
        name: stored?.provider.name ?? "",
        directoryKey: null,
        type: "ldap",
        config,
        caCertificates:
          input.caCertificate ?? (stored?.provider.type === "ldap" ? stored.provider.caCertificates : null),
      },
      credentials,
      null,
    );
    const failed = result.steps.find((step) => !step.ok);
    return {
      ok: failed === undefined,
      check: "directory",
      url: config.url,
      status: null,
      problem: failed?.step ?? null,
      detail: failed?.detail ?? null,
    };
  }

  async testDirectory(providerId: string, signInName: string | null): Promise<DirectoryTestResult> {
    const { provider, credentials } = await this.#load(providerId);
    const adapter = this.#adapter(provider.type);
    if (provider.type !== "ldap" || !adapter.testDirectory) {
      throw new OrganizationError("invalidInput", "Only directory providers are tested this way");
    }
    return adapter.testDirectory(provider, credentials, signInName);
  }

  async cleanup(): Promise<number> {
    const now = this.#clock();
    const flows = await this.#database.delete(providerFlows).where(lt(providerFlows.expiresAt, now));
    const tokens = await this.#database
      .delete(providerLogoutTokens)
      .where(lt(providerLogoutTokens.expiresAt, now));
    const assertions = await this.#database.delete(samlAssertions).where(lt(samlAssertions.expiresAt, now));
    const refusals = await this.#database
      .delete(signInRefusals)
      .where(
        lt(signInRefusals.createdAt, new Date(now.getTime() - REFUSAL_RETENTION_DAYS * 24 * 60 * 60 * 1000)),
      );
    return (
      (flows.rowCount ?? 0) + (tokens.rowCount ?? 0) + (assertions.rowCount ?? 0) + (refusals.rowCount ?? 0)
    );
  }
}
