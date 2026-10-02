import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import * as client from "openid-client";
import type { Account, AccountService } from "../accounts/accounts.js";
import { EmailInUseError } from "../accounts/accounts.js";
import { ANONYMOUS, accountPrincipal, SYSTEM } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { ChallengeStore } from "../auth/challenges.js";
import { ChallengeExpiredError } from "../auth/errors.js";
import { sessions } from "../auth/schema.js";
import type { ClientInfo, SessionService } from "../auth/sessions.js";
import { passwordSignInSetting } from "../auth/settings.js";
import type { PendingIdentity, SignedIn, SignInService } from "../auth/sign-in.js";
import { secondFactorsOf } from "../auth/two-factor.js";
import { secretsEqual } from "../crypto/constant-time.js";
import type { Database, Transaction } from "../database/database.js";
import type { NotificationService } from "../notifications/service.js";
import { OrganizationError } from "../organizations/organizations.js";
import { organizationDomains, organizations } from "../organizations/schema.js";
import type { SettingsService } from "../settings/service.js";
import {
  type IdentityProviderAdapter,
  type ProviderDefinition,
  ProviderPolicyError,
  type ProviderProfile,
  ProviderResponseError,
} from "./adapter.js";
import type { IdentityProviderService, OrganizationProvider } from "./providers.js";
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
const REFERENCE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export type ProviderFlowPurpose = "signIn" | "reauthentication" | "test";

export interface StartedFlow {
  url: string;
  browserToken: string;
}

export type CallbackResult =
  | { kind: "signedIn"; signedIn: SignedIn; returnTo: string | null }
  | { kind: "linkRequired"; pendingToken: string }
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
  organization: { id: string; name: string; slug: string; logoRef: string | null } | null;
  providers: OrganizationProvider[];
  passwordSignIn: boolean;
}

export interface SignInRefusal {
  reference: string;
  reason: SignInRefusalReason;
  providerId: string | null;
  organizationId: string | null;
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
    this.#clock = options.clock ?? (() => new Date());
  }

  #adapter(type: string): IdentityProviderAdapter {
    const adapter = this.#adapters.get(type);
    if (!adapter) throw new Error(`No adapter for ${type} providers`);
    return adapter;
  }

  async #load(providerId: string) {
    const loaded = await this.#providers.definition(providerId);
    if (!loaded) throw new OrganizationError("notFound", "The identity provider does not exist");
    return loaded;
  }

  async start(input: {
    providerId: string;
    purpose: ProviderFlowPurpose;
    baseUrl: string;
    organizationId?: string | null;
    returnTo?: string | null;
    sessionId?: string | null;
    accountId?: string | null;
  }): Promise<StartedFlow> {
    const { provider, credentials } = await this.#load(input.providerId);
    let organizationId =
      provider.level === "organization" ? provider.organizationId : (input.organizationId ?? null);
    if (input.purpose === "signIn" && provider.level === "instance") {
      const usable = organizationId
        ? await this.#providers.enabledFor(provider.id, organizationId)
        : await this.#providers.enabledAnywhere(provider.id);
      if (!usable) throw new OrganizationError("notFound", "The identity provider is not available here");
    }
    if (input.purpose === "reauthentication") {
      const [identity] = await this.#database
        .select({ id: identities.id })
        .from(identities)
        .where(and(eq(identities.providerId, provider.id), eq(identities.accountId, input.accountId ?? "")));
      if (!identity) throw new OrganizationError("notFound", "The account is not linked to this provider");
      organizationId = null;
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
      organizationId,
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
    const { provider, credentials } = await this.#load(flow.providerId);
    const organizationId = provider.level === "organization" ? provider.organizationId : flow.organizationId;
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
      if (error instanceof ProviderPolicyError && error.reason === "domainNotAllowed") {
        return this.#refuse({ providerId: provider.id, organizationId, reason: "domainNotAllowed" });
      }
      if (error instanceof ProviderPolicyError || error instanceof ProviderResponseError) {
        if (flow.purpose === "test") {
          await this.#database
            .update(providerFlows)
            .set({ result: { error: error.message } })
            .where(eq(providerFlows.id, flow.id));
          return { kind: "tested", flowId: flow.id, returnTo: flow.returnTo };
        }
        return this.#refuse({ providerId: provider.id, organizationId, reason: "invalidResponse" });
      }
      throw error;
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

    for (let attempt = 0; ; attempt++) {
      try {
        return await this.#signInWith({
          provider,
          organizationId,
          profile,
          emailVerified,
          providerSessionId: result.providerSessionId,
          client: input.client,
          returnTo: flow.returnTo,
          started,
        });
      } catch (error) {
        if (error instanceof Refused) {
          return this.#refuse({
            providerId: provider.id,
            organizationId,
            reason: error.reason,
            profile,
          });
        }
        if (attempt === 0 && isUniqueViolation(error)) continue;
        throw error;
      }
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

  async #allowedFor(
    provider: { id: string; level: string; organizationId: string | null },
    account: Account,
  ): Promise<SignInRefusalReason | null> {
    if (provider.level === "organization") {
      return account.homeOrganizationId === provider.organizationId ? null : "otherOrganization";
    }
    if (account.homeOrganizationId) {
      return (await this.#providers.enabledFor(provider.id, account.homeOrganizationId))
        ? null
        : "providerNotEnabled";
    }
    return (await this.#providers.enabledAnywhere(provider.id)) ? null : "providerNotEnabled";
  }

  async #signInWith(input: {
    provider: ProviderDefinition;
    organizationId: string | null;
    profile: ProviderProfile;
    emailVerified: boolean;
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
      const refusal = await this.#allowedFor(provider, account);
      if (refusal) throw new Refused(refusal);
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
          return identity.id;
        },
        { ...input, returnTo: input.returnTo },
      );
    }

    if (input.emailVerified && profile.email) {
      const existing = await this.#accounts.findByEmail(profile.email);
      if (existing) {
        if (!canSignIn(existing)) throw new Refused("accountInactive");
        const refusal = await this.#allowedFor(provider, existing);
        if (refusal) throw new Refused(refusal);
        if (!existing.passwordHash) throw new Refused("linkUnavailable");
        const payload: PendingIdentity = {
          providerId: provider.id,
          subject: profile.subject,
          email: profile.email,
          signInName: profile.signInName,
          displayName: profile.displayName,
          providerSessionId: input.providerSessionId,
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
      const held = new Set((profile.groups ?? []).flatMap((group) => [group.id, group.name ?? ""]));
      if (!creation.requiredGroups.some((group) => held.has(group))) throw new Refused("groupRequired");
    }
    const email = profile.email;
    const home = await this.#homeOrganization(provider, input.organizationId, email);
    return this.#withSession(
      null,
      async (tx) => {
        const account = await this.#accounts.createFromProvider(tx, {
          email,
          name: profile.displayName ?? email,
          homeOrganizationId: home,
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

  async #homeOrganization(
    provider: { id: string; level: string; organizationId: string | null },
    contextOrganizationId: string | null,
    email: string,
  ): Promise<string | null> {
    if (provider.level === "organization") return provider.organizationId;
    const domain = domainOf(email);
    if (domain) {
      const [owner] = await this.#database
        .select({ organizationId: organizationDomains.organizationId })
        .from(organizationDomains)
        .where(eq(organizationDomains.domain, domain));
      if (owner && (await this.#providers.enabledFor(provider.id, owner.organizationId))) {
        return owner.organizationId;
      }
    }
    if (contextOrganizationId && (await this.#providers.enabledFor(provider.id, contextOrganizationId))) {
      return contextOrganizationId;
    }
    return null;
  }

  async #withSession(
    account: (Account & { email: string }) | null,
    prepare: (tx: Transaction) => Promise<string | { identityId: string; account: Account }>,
    input: {
      provider: { id: string };
      providerSessionId: string | null;
      client: ClientInfo;
      returnTo: string | null;
      started: Date;
    },
  ): Promise<CallbackResult> {
    const mailIds: string[] = [];
    const signedIn = await this.#database.transaction(async (tx) => {
      const prepared = await prepare(tx);
      const identityId = typeof prepared === "string" ? prepared : prepared.identityId;
      const target = typeof prepared === "string" ? account : prepared.account;
      if (!target) throw new Error("No account to sign in");
      return this.#signIn.createProviderSession(
        tx,
        target,
        { providerId: input.provider.id, identityId, providerSessionId: input.providerSessionId },
        input.client,
        mailIds,
        input.started,
      );
    });
    await this.#notifications.dispatch(mailIds);
    return { kind: "signedIn", signedIn, returnTo: input.returnTo };
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
    organizationId: string | null;
    reason: SignInRefusalReason;
    profile?: ProviderProfile;
    accountId?: string | null;
  }): Promise<CallbackResult> {
    const code = reference();
    await this.#database.transaction(async (tx) => {
      await tx.insert(signInRefusals).values({
        reference: code,
        providerId: input.providerId,
        organizationId: input.organizationId,
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
        ...(input.organizationId
          ? { scope: { type: "organization" as const, id: input.organizationId } }
          : {}),
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
    const loaded = await this.#providers.definition(identity.providerId);
    const result = await this.#refuse({
      providerId: identity.providerId,
      organizationId: loaded?.provider.organizationId ?? null,
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

  async signInOptions(organizationSlug: string | null): Promise<SignInOptions> {
    let organization: SignInOptions["organization"] = null;
    if (organizationSlug) {
      const [row] = await this.#database
        .select({
          id: organizations.id,
          name: organizations.name,
          slug: organizations.slug,
          logoRef: organizations.logoRef,
        })
        .from(organizations)
        .where(eq(organizations.slug, organizationSlug.toLowerCase()));
      organization = row ? { ...row, logoRef: null } : null;
    } else {
      const rows = await this.#database
        .select({
          id: organizations.id,
          name: organizations.name,
          slug: organizations.slug,
          logoRef: organizations.logoRef,
        })
        .from(organizations)
        .limit(2);
      organization = rows.length === 1 ? (rows[0] ?? null) : null;
    }
    const providers = await this.#providers.enabledProviders(organization?.id ?? null);
    const passwordSignIn = await this.#settings.get(
      passwordSignInSetting,
      organization ? { organization: organization.id } : {},
    );
    return { organization, providers, passwordSignIn };
  }

  async refusal(code: string, organizationId: string | null): Promise<SignInRefusal | null> {
    const [row] = await this.#database
      .select()
      .from(signInRefusals)
      .where(
        and(
          eq(signInRefusals.reference, code),
          organizationId ? eq(signInRefusals.organizationId, organizationId) : undefined,
        ),
      );
    if (!row) return null;
    return {
      reference: row.reference,
      reason: row.reason,
      providerId: row.providerId,
      organizationId: row.organizationId,
      subject: row.subject,
      email: row.email,
      displayName: row.displayName,
      accountId: row.accountId,
      createdAt: row.createdAt,
    };
  }

  async backchannelLogout(providerId: string, logoutToken: string): Promise<number> {
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
        ...(provider.organizationId
          ? { scope: { type: "organization" as const, id: provider.organizationId } }
          : {}),
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
