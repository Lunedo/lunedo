import { createHash, randomBytes } from "node:crypto";
import type { OidcConfig } from "@pagehall/shared";
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import * as client from "openid-client";
import { ZodError } from "zod";
import type { Account, AccountService } from "../accounts/accounts.js";
import { EmailInUseError } from "../accounts/accounts.js";
import { ANONYMOUS, accountPrincipal, SYSTEM } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { ChallengeStore } from "../auth/challenges.js";
import { instanceAdministratorIds } from "../auth/emergency-recipients.js";
import { ChallengeExpiredError, RateLimitedError } from "../auth/errors.js";
import { sessions } from "../auth/schema.js";
import type { ClientInfo, SessionService } from "../auth/sessions.js";
import { passwordSignInSetting } from "../auth/settings.js";
import type { PendingIdentity, SecondFactorType, SignedIn, SignInService } from "../auth/sign-in.js";
import { clientSubject, type RateLimiter } from "../auth/throttle.js";
import { secondFactorsOf } from "../auth/two-factor.js";
import { secretsEqual } from "../crypto/constant-time.js";
import type { Database, Transaction } from "../database/database.js";
import type { NotificationService } from "../notifications/service.js";
import { OrganizationError } from "../organizations/organizations.js";
import { organizationDomains } from "../organizations/schema.js";
import type { SettingsService } from "../settings/service.js";
import {
  type IdentityProviderAdapter,
  type ProviderDefinition,
  ProviderPolicyError,
  type ProviderProfile,
  ProviderResponseError,
} from "./adapter.js";
import type { GroupMappingService } from "./groups.js";
import type { IdentityProviderService, SignInProvider } from "./providers.js";
import { callbackPath } from "./providers.js";
import {
  identities,
  providerFlows,
  providerLogoutTokens,
  type SignInRefusalReason,
  signInRefusals,
} from "./schema.js";

const FLOW_LIFETIME_MS = 10 * 60 * 1000;
const AUTH_TIME_TOLERANCE_MS = 60 * 1000;
const REFUSAL_RETENTION_DAYS = 90;
const DISCOVERIES_PER_CLIENT = 30;
const STARTS_PER_CLIENT = 20;
const LOGOUTS_PER_CLIENT = 60;
const REFERENCE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export type ProviderFlowPurpose = "signIn" | "reauthentication" | "test";

export interface StartedFlow {
  url: string;
  browserToken: string;
}

export function needsPagehallFactor(
  setting: OidcConfig["secondFactor"],
  methods: readonly string[],
): boolean {
  if (setting.mode === "pagehall") return true;
  if (setting.mode === "provider") return false;
  return !methods.some((method) => setting.proofValues.includes(method));
}

export type CallbackResult =
  | { kind: "signedIn"; signedIn: SignedIn; returnTo: string | null }
  | { kind: "linkRequired"; pendingToken: string }
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
  claimNames: string[];
}

export interface SignInOptions {
  emailStep: boolean;
  directProvider: SignInProvider | null;
  lastProvider: SignInProvider | null;
  passwordSignIn: boolean;
  passkeys: true;
}

export type SignInStep =
  | { step: "provider"; providerId: string; name: string; preset: SignInProvider["preset"] }
  | { step: "password" }
  | { step: "none" };

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

export interface LinkInfo {
  providerName: string;
  email: string | null;
  accountName: string;
  factors: ("totp" | "passkey" | "recoveryCode")[];
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
  readonly #settings: SettingsService;
  readonly #rateLimiter: RateLimiter;
  readonly #mapping: GroupMappingService;
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
    settings: SettingsService;
    rateLimiter: RateLimiter;
    mapping: GroupMappingService;
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
    this.#settings = options.settings;
    this.#rateLimiter = options.rateLimiter;
    this.#mapping = options.mapping;
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
    const browserToken = client.randomState();
    const state = client.randomState();
    const nonce = client.randomNonce();
    const codeVerifier = client.randomPKCECodeVerifier();
    const redirectUri = `${input.baseUrl.replace(/\/+$/, "")}${callbackPath(provider.id)}`;
    const url = await this.#adapter(provider.type).authorizationUrl(provider, credentials, {
      redirectUri,
      state,
      nonce,
      codeChallenge: await client.calculatePKCECodeChallenge(codeVerifier),
      reauthenticate: input.purpose === "reauthentication",
    });
    await this.#database.insert(providerFlows).values({
      purpose: input.purpose,
      providerId: provider.id,
      stateHash: hashState(state),
      browserHash: hashState(browserToken),
      nonce,
      codeVerifier,
      redirectUri,
      sessionId: input.sessionId ?? null,
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
      throw new ChallengeExpiredError();
    }
    const { provider, credentials } = await this.#load(flow.providerId, flow.purpose);
    const callbackUrl = new URL(flow.redirectUri);
    callbackUrl.search = input.query.toString();

    let result: Awaited<ReturnType<IdentityProviderAdapter["completeSignIn"]>>;
    try {
      if (input.query.has("error")) throw new ProviderResponseError("The provider refused the sign-in");
      result = await this.#adapter(provider.type).completeSignIn(provider, credentials, {
        callbackUrl,
        state,
        nonce: flow.nonce,
        codeVerifier: flow.codeVerifier,
      });
    } catch (error) {
      if (!(error instanceof ProviderPolicyError) && !(error instanceof ProviderResponseError)) throw error;
      if (flow.purpose === "test") {
        await this.#database
          .update(providerFlows)
          .set({ result: { error: error.message } })
          .where(eq(providerFlows.id, flow.id));
        return { kind: "tested", flowId: flow.id, returnTo: flow.returnTo };
      }
      const reason =
        error instanceof ProviderPolicyError && error.reason === "domainNotAllowed"
          ? "domainNotAllowed"
          : "invalidResponse";
      return this.#refuse({ providerId: provider.id, reason });
    }
    const profile = result.profile;
    const emailVerified = this.#emailVerified(provider.config.domains, profile.email);

    if (flow.purpose === "test") {
      const test: TestResult = {
        subject: profile.subject,
        email: profile.email,
        emailVerified,
        signInName: profile.signInName,
        displayName: profile.displayName,
        groups: profile.groups,
        claimNames: result.claimNames,
      };
      await this.#database.update(providerFlows).set({ result: test }).where(eq(providerFlows.id, flow.id));
      return { kind: "tested", flowId: flow.id, returnTo: flow.returnTo };
    }

    if (flow.purpose === "reauthentication") {
      return this.#reauthenticate(flow, provider.id, profile, result.authTime);
    }

    const groups = await this.#groups(provider, credentials, profile);
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.#signInWith({
          provider,
          profile,
          groups,
          emailVerified,
          secondFactor: needsPagehallFactor(provider.config.secondFactor, result.methods),
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

  async #groups(
    provider: ProviderDefinition,
    credentials: Parameters<IdentityProviderAdapter["completeSignIn"]>[1],
    profile: ProviderProfile,
  ): Promise<ProviderProfile["groups"]> {
    if (profile.groups !== null) return profile.groups;
    const adapter = this.#adapter(provider.type);
    if (!adapter.readGroups) return null;
    try {
      return await adapter.readGroups(provider, credentials, profile.subject);
    } catch {
      return null;
    }
  }

  #emailVerified(domains: readonly string[], email: string | null): boolean {
    const domain = domainOf(email);
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
    emailVerified: boolean;
    secondFactor: boolean;
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
        async (tx) => {
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
          await this.#mapping.applyAtSignIn(tx, {
            providerId: provider.id,
            identityId: identity.id,
            accountId: account.id,
            groups: input.groups,
          });
          return identity.id;
        },
        { ...input, returnTo: input.returnTo },
      );
    }

    if (input.emailVerified && profile.email) {
      const existing = await this.#accounts.findByEmail(profile.email);
      if (existing) {
        if (!canSignIn(existing)) throw new Refused("accountInactive");
        if (!existing.passwordHash) throw new Refused("linkUnavailable");
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
    const home =
      (await this.#mapping.homeOrganizationFor(
        this.#database,
        provider.id,
        (input.groups ?? []).map((group) => group.id),
      )) ?? (await this.#homeOrganization(email));
    return this.#withSession(
      null,
      async (tx, mailIds) => {
        const account = await this.#accounts.createFromProvider(tx, {
          email,
          name: profile.displayName ?? email,
          homeOrganizationId: home,
        });
        if (home === null) {
          const notified = await this.#notifications.notify(tx, {
            type: "account.withoutOrganization",
            recipients: await instanceAdministratorIds(tx),
            organizationId: null,
            targetId: account.id,
            params: { accountName: account.name, email: account.email, providerName: provider.name },
          });
          mailIds.push(...notified.mailIds);
        }
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
        const scope = home ? { scope: { type: "organization" as const, id: home } } : {};
        await this.#audit.record(tx, {
          name: "account.createdAtSignIn",
          actor: SYSTEM,
          targetId: account.id,
          fields: { providerId: provider.id, organizationId: home },
          ...scope,
        });
        await this.#audit.record(tx, {
          name: "identity.linked",
          actor: SYSTEM,
          targetId: account.id,
          fields: { providerId: provider.id, via: "signIn" },
          ...scope,
        });
        return { identityId: created.id, account };
      },
      input,
    );
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
      secondFactor: boolean;
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
      if (input.secondFactor) {
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
        input.secondFactor ? "secondFactorSetup" : "full",
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
    if (identity?.accountId !== session.accountId || !fresh) {
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

  async linkInfo(pendingToken: string): Promise<LinkInfo> {
    const pending = await this.#challenges.findByToken(pendingToken, "identityLink");
    const account = pending?.accountId ? await this.#accounts.get(pending.accountId) : null;
    const identity = pending?.payload as PendingIdentity | undefined;
    if (!pending || !account || !identity) throw new ChallengeExpiredError();
    const loaded = await this.#providers.definition(identity.providerId);
    if (!loaded) throw new ChallengeExpiredError();
    const factors = await secondFactorsOf(this.#database, account.id);
    return {
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

  async testResult(flowId: string, sessionId: string): Promise<TestResult | { error: string } | null> {
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
    return (flow?.result as TestResult | { error: string } | null | undefined) ?? null;
  }

  async signInOptions(lastProviderId: string | null): Promise<SignInOptions> {
    const providers = await this.#providers.signInProviders();
    const passwordSignIn = await this.#settings.get(passwordSignInSetting, {});
    const directProvider = providers.length === 1 && !passwordSignIn ? (providers[0] ?? null) : null;
    return {
      emailStep: directProvider === null,
      directProvider,
      lastProvider: providers.find((provider) => provider.id === lastProviderId) ?? null,
      passwordSignIn,
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
    if (provider) {
      return { step: "provider", providerId: provider.id, name: provider.name, preset: provider.preset };
    }
    return (await this.#settings.get(passwordSignInSetting, {})) ? { step: "password" } : { step: "none" };
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
    const logout = await this.#adapter(provider.type).verifyLogout(provider, credentials, logoutToken);
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

  async cleanup(): Promise<number> {
    const now = this.#clock();
    const flows = await this.#database.delete(providerFlows).where(lt(providerFlows.expiresAt, now));
    const tokens = await this.#database
      .delete(providerLogoutTokens)
      .where(lt(providerLogoutTokens.expiresAt, now));
    const refusals = await this.#database
      .delete(signInRefusals)
      .where(
        lt(signInRefusals.createdAt, new Date(now.getTime() - REFUSAL_RETENTION_DAYS * 24 * 60 * 60 * 1000)),
      );
    return (flows.rowCount ?? 0) + (tokens.rowCount ?? 0) + (refusals.rowCount ?? 0);
  }
}
