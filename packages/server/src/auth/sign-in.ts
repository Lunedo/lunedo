import { eq, sql } from "drizzle-orm";
import type { Account, AccountService } from "../accounts/accounts.js";
import { ANONYMOUS, accountPrincipal } from "../accounts/principal.js";
import { accounts } from "../accounts/schema.js";
import { accountScopeChain } from "../accounts/scope.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { SignInMethod } from "../audit/catalog.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import { identities } from "../identity/schema.js";
import type { MailService } from "../mail/mail-service.js";
import { knownDevices } from "../notifications/schema.js";
import type { NotificationService } from "../notifications/service.js";
import { languageSetting } from "../settings/builtin.js";
import type { SettingsService } from "../settings/service.js";
import type { ChallengeStore } from "./challenges.js";
import { emergencyRecipientsOf } from "./emergency-recipients.js";
import {
  ChallengeExpiredError,
  InvalidCredentialsError,
  InvalidSecondFactorError,
  LockedError,
  PasswordSignInDisabledError,
  RateLimitedError,
  SetupIncompleteError,
} from "./errors.js";
import type { PasswordHasher } from "./passwords.js";
import {
  type ClientInfo,
  describeClient,
  type Session,
  type SessionKind,
  type SessionService,
} from "./sessions.js";
import { passwordSignInSetting, twoFactorRequiredSetting } from "./settings.js";
import {
  clientSubject,
  type Lockout,
  type RateLimiter,
  type SignInThrottle,
  type ThrottleSubjects,
} from "./throttle.js";
import { hashToken } from "./tokens.js";
import {
  hasSecondFactor,
  type RecoveryCodeService,
  type SecondFactors,
  secondFactorsOf,
  type TotpService,
} from "./two-factor.js";
import type { AuthenticationResponseJSON, WebAuthnService } from "./webauthn.js";

export type SecondFactorType = "totp" | "passkey" | "recoveryCode";

export type SecondFactorInput =
  | { type: "totp"; code: string }
  | { type: "recoveryCode"; code: string }
  | { type: "passkey"; response: AuthenticationResponseJSON };

export type ReauthenticationInput =
  | { method: "password"; password: string }
  | { method: "totp"; code: string }
  | { method: "passkey"; response: AuthenticationResponseJSON };

export interface SignedIn {
  status: "signedIn";
  session: Session;
  token: string;
}

export interface PendingIdentity {
  providerId: string;
  subject: string;
  email: string | null;
  signInName: string | null;
  displayName: string | null;
  providerSessionId: string | null;
  groups: { id: string; name: string | null }[] | null;
}

export type IdentityLinkedHook = (
  tx: Transaction,
  link: {
    providerId: string;
    identityId: string;
    accountId: string;
    groups: { id: string; name: string | null }[] | null;
  },
) => Promise<unknown>;

export interface SecondFactorRequired {
  status: "secondFactorRequired";
  pendingToken: string;
  factors: SecondFactorType[];
}

const INTERACTIVE_TYPES = new Set(["standard", "guest", "portal"]);

function canSignIn(account: Account | null): account is Account & { email: string } {
  return (
    account !== null &&
    account.state === "active" &&
    INTERACTIVE_TYPES.has(account.type) &&
    account.email !== null
  );
}

const PASSKEY_OPTIONS_PER_CLIENT_PER_MINUTE = 30;

export interface PendingProviderSession {
  providerId: string;
  identityId: string;
  providerSessionId: string | null;
}

function providerOfPending(payload: unknown): PendingProviderSession | null {
  if (typeof payload !== "object" || payload === null || !("provider" in payload)) return null;
  const provider = (payload as { provider: unknown }).provider;
  if (typeof provider !== "object" || provider === null) return null;
  const { providerId, identityId, providerSessionId } = provider as Record<string, unknown>;
  if (typeof providerId !== "string" || typeof identityId !== "string") return null;
  return {
    providerId,
    identityId,
    providerSessionId: typeof providerSessionId === "string" ? providerSessionId : null,
  };
}

function availableFactors(factors: SecondFactors): SecondFactorType[] {
  const available: SecondFactorType[] = [];
  if (factors.totp) available.push("totp");
  if (factors.passkeys > 0) available.push("passkey");
  if (factors.recoveryCodes > 0) available.push("recoveryCode");
  return available;
}

function secondsUntil(date: Date): number {
  return Math.max(1, Math.ceil((date.getTime() - Date.now()) / 1000));
}

class RecoveryCodeRejected extends Error {}

export type SecondFactorRequirement = "instanceOwner" | "reset" | "instance" | "organization";

export class SignInService {
  readonly #database: Database;
  readonly #accounts: AccountService;
  readonly #hasher: PasswordHasher;
  readonly #throttle: SignInThrottle;
  readonly #rateLimiter: RateLimiter;
  readonly #sessions: SessionService;
  readonly #challenges: ChallengeStore;
  readonly #totp: TotpService;
  readonly #recoveryCodes: RecoveryCodeService;
  readonly #webauthn: WebAuthnService;
  readonly #audit: AuditLog;
  readonly #mail: MailService;
  readonly #notifications: NotificationService;
  readonly #settings: SettingsService;
  readonly #setupComplete: () => Promise<boolean>;
  readonly #onIdentityLinked: IdentityLinkedHook | undefined;
  readonly #beforeSession: ((executor: Executor, accountId: string) => Promise<void>) | undefined;

  constructor(options: {
    database: Database;
    accounts: AccountService;
    hasher: PasswordHasher;
    throttle: SignInThrottle;
    rateLimiter: RateLimiter;
    sessions: SessionService;
    challenges: ChallengeStore;
    totp: TotpService;
    recoveryCodes: RecoveryCodeService;
    webauthn: WebAuthnService;
    audit: AuditLog;
    mail: MailService;
    notifications: NotificationService;
    settings: SettingsService;
    setupComplete: () => Promise<boolean>;
    onIdentityLinked?: IdentityLinkedHook;
    beforeSession?: (executor: Executor, accountId: string) => Promise<void>;
  }) {
    this.#database = options.database;
    this.#accounts = options.accounts;
    this.#hasher = options.hasher;
    this.#throttle = options.throttle;
    this.#rateLimiter = options.rateLimiter;
    this.#sessions = options.sessions;
    this.#challenges = options.challenges;
    this.#totp = options.totp;
    this.#recoveryCodes = options.recoveryCodes;
    this.#webauthn = options.webauthn;
    this.#audit = options.audit;
    this.#mail = options.mail;
    this.#notifications = options.notifications;
    this.#settings = options.settings;
    this.#setupComplete = options.setupComplete;
    this.#onIdentityLinked = options.onIdentityLinked;
    this.#beforeSession = options.beforeSession;
  }

  async secondFactorRequired(accountId: string, executor: Executor = this.#database): Promise<boolean> {
    return (await this.secondFactorRequirement(accountId, executor)) !== null;
  }

  async secondFactorRequirement(
    accountId: string,
    executor: Executor = this.#database,
  ): Promise<SecondFactorRequirement | null> {
    if ((await this.#accounts.ownerId(executor)) === accountId) return "instanceOwner";
    const [reset] = await executor
      .select({ at: accounts.secondFactorResetAt })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    if (reset?.at) return "reset";
    const setting = await this.#settings.explain(
      twoFactorRequiredSetting,
      await accountScopeChain(executor, accountId),
      { executor },
    );
    if (!setting.value) return null;
    return setting.source !== "default" && setting.source.level === "organization"
      ? "organization"
      : "instance";
  }

  async #checkAttempt(subjects: ThrottleSubjects, accountId: string | null, method: SignInMethod) {
    if (!(await this.#setupComplete())) throw new SetupIncompleteError();
    const rate = await this.#throttle.attempt(subjects);
    if (!rate.allowed) throw new RateLimitedError(rate.retryAfterSeconds);
    const lockout = await this.#throttle.lockout(subjects);
    if (lockout) {
      await this.#audit.recordAlone({
        name: "auth.signInFailed",
        actor: ANONYMOUS,
        targetId: accountId,
        fields: { reason: lockout.subject === "account" ? "accountLocked" : "clientLocked", method },
      });
      throw new LockedError(secondsUntil(lockout.lockedUntil));
    }
  }

  async #recordFailure(
    subjects: ThrottleSubjects,
    accountId: string | null,
    method: SignInMethod,
    reason: "invalidCredentials" | "invalidSecondFactor",
  ): Promise<Lockout[]> {
    return this.#database.transaction(async (tx) => {
      const lockouts = await this.#throttle.recordFailure(subjects, tx);
      await this.#audit.record(tx, {
        name: "auth.signInFailed",
        actor: ANONYMOUS,
        targetId: accountId,
        fields: { reason, method },
      });
      for (const lockout of lockouts) {
        await this.#audit.record(tx, {
          name: "auth.lockedOut",
          actor: ANONYMOUS,
          targetId: lockout.subject === "account" ? accountId : null,
          fields: {
            subject: lockout.subject,
            failures: lockout.failures,
            lockedUntil: lockout.lockedUntil.toISOString(),
          },
        });
      }
      return lockouts;
    });
  }

  async #databaseNow(): Promise<Date> {
    const result = await this.#database.execute<{ now: Date | string }>(sql`select now() as now`);
    return new Date(result.rows[0]?.now ?? Date.now());
  }

  async passwordSignInAllowed(executor: Executor = this.#database): Promise<boolean> {
    return this.#settings.get(passwordSignInSetting, {}, { executor });
  }

  async #emergencySignIn(
    tx: Transaction,
    account: Account,
    sessionId: string,
    client: ClientInfo,
    mailIds: string[],
  ): Promise<void> {
    await this.#audit.record(tx, {
      name: "auth.emergencySignIn",
      actor: accountPrincipal(account.id),
      targetId: account.id,
      fields: { sessionId },
    });
    const recipients = await emergencyRecipientsOf(tx, this.#settings);
    const described = describeClient(client.userAgent);
    const result = await this.#notifications.notify(tx, {
      type: "auth.emergencySignIn",
      recipients: recipients.accountIds,
      organizationId: null,
      targetId: account.id,
      params: {
        accountName: account.name,
        browser: described.browser,
        operatingSystem: described.operatingSystem,
        clientIp: client.ip ?? null,
      },
    });
    mailIds.push(...result.mailIds);
    const language = await this.#settings.get(languageSetting, {}, { executor: tx });
    for (const address of recipients.addresses) {
      mailIds.push(
        await this.#mail.queue(tx, {
          to: address,
          template: "emergencySignIn",
          security: true,
          language,
          params: {
            accountName: account.name,
            browser: described.browser,
            operatingSystem: described.operatingSystem,
            clientIp: client.ip ?? null,
          },
        }),
      );
    }
  }

  async createProviderSession(
    tx: Transaction,
    account: Account,
    provider: {
      providerId: string;
      identityId: string;
      providerSessionId: string | null;
      methods?: SignInMethod[];
    },
    client: ClientInfo,
    mailIds: string[],
    verifiedSince: Date,
    kind: SessionKind = "full",
  ): Promise<SignedIn> {
    return this.#createSession(
      tx,
      account,
      provider.methods ?? ["identityProvider"],
      kind,
      client,
      mailIds,
      verifiedSince,
      provider,
    );
  }

  async providerSecondFactor(
    tx: Transaction,
    account: Account,
    provider: PendingProviderSession,
    client: ClientInfo,
  ): Promise<{ pendingToken: string; factors: SecondFactorType[] } | null> {
    const factors = await secondFactorsOf(tx, account.id);
    if (!hasSecondFactor(factors)) return null;
    await this.#beforeSession?.(tx, account.id);
    const pending = await this.#challenges.create(tx, {
      purpose: "secondFactor",
      accountId: account.id,
      methods: ["identityProvider"],
      deviceHash: client.deviceToken ? hashToken(client.deviceToken) : null,
      payload: { provider },
      withToken: true,
    });
    return { pendingToken: pending.token ?? "", factors: availableFactors(factors) };
  }

  async #createSession(
    tx: Transaction,
    account: Account,
    methods: SignInMethod[],
    kind: SessionKind,
    client: ClientInfo,
    mailIds: string[],
    verifiedSince: Date,
    provider: { providerId: string; identityId: string; providerSessionId: string | null } | null = null,
  ): Promise<SignedIn> {
    await this.#beforeSession?.(tx, account.id);
    const [current] = await tx
      .select({ resetAt: accounts.secondFactorResetAt })
      .from(accounts)
      .where(eq(accounts.id, account.id))
      .for("update");
    if (current?.resetAt && current.resetAt.getTime() >= verifiedSince.getTime()) {
      throw new ChallengeExpiredError();
    }
    const { session, token } = await this.#sessions.create(tx, {
      accountId: account.id,
      kind,
      methods,
      client,
      ...(provider ? { identityId: provider.identityId, providerSessionId: provider.providerSessionId } : {}),
    });
    await tx.update(accounts).set({ lastSignInAt: new Date() }).where(eq(accounts.id, account.id));
    await this.#audit.record(tx, {
      name: "auth.signedIn",
      actor: accountPrincipal(account.id),
      targetId: account.id,
      fields: { sessionId: session.id, methods, ...(provider ? { providerId: provider.providerId } : {}) },
    });
    if (
      provider === null &&
      methods.includes("password") &&
      (await this.#accounts.ownerId(tx)) === account.id &&
      !(await this.passwordSignInAllowed(tx))
    ) {
      await this.#emergencySignIn(tx, account, session.id, client, mailIds);
    }
    await this.#recordDevice(tx, account.id, client, mailIds);
    return { status: "signedIn", session, token };
  }

  async #recordDevice(
    tx: Transaction,
    accountId: string,
    client: ClientInfo,
    mailIds: string[],
  ): Promise<void> {
    if (!client.deviceToken) return;
    const deviceHash = hashToken(client.deviceToken);
    const inserted = await tx
      .insert(knownDevices)
      .values({ accountId, deviceHash })
      .onConflictDoNothing()
      .returning({ accountId: knownDevices.accountId });
    if (inserted.length === 0) return;
    const others = await tx.execute(sql`
      select 1 from known_devices where account_id = ${accountId} and device_hash <> ${deviceHash} limit 1`);
    if (others.rows.length === 0) return;
    const described = describeClient(client.userAgent);
    const result = await this.#notifications.notify(tx, {
      type: "signIn.newBrowser",
      recipients: [accountId],
      organizationId: null,
      targetId: accountId,
      params: {
        browser: described.browser,
        operatingSystem: described.operatingSystem,
        clientIp: client.ip ?? null,
      },
    });
    mailIds.push(...result.mailIds);
  }

  async #signedIn(run: (tx: Transaction, mailIds: string[]) => Promise<SignedIn>): Promise<SignedIn> {
    const mailIds: string[] = [];
    const result = await this.#database.transaction((tx) => run(tx, mailIds));
    await this.#notifications.dispatch(mailIds);
    return result;
  }

  async signInWithPassword(input: {
    email: string;
    password: string;
    client: ClientInfo;
  }): Promise<SignedIn | SecondFactorRequired> {
    const subjects = { email: input.email, clientIp: input.client.ip };
    const started = await this.#databaseNow();
    const found = await this.#accounts.findByEmail(input.email);
    const account = canSignIn(found) && found.passwordHash ? found : null;
    await this.#checkAttempt(subjects, account?.id ?? null, "password");

    let valid = false;
    if (account?.passwordHash) {
      const verification = await this.#hasher.verify(account.passwordHash, input.password);
      valid = verification.valid;
      if (valid && verification.needsRehash) {
        await this.#accounts.setPasswordHash(
          this.#database,
          account.id,
          await this.#hasher.hash(input.password),
        );
      }
    } else {
      await this.#hasher.verifyNothing(input.password);
    }
    if (!account || !valid) {
      await this.#recordFailure(subjects, account?.id ?? null, "password", "invalidCredentials");
      throw new InvalidCredentialsError();
    }
    if (!(await this.passwordSignInAllowed()) && (await this.#accounts.ownerId()) !== account.id) {
      throw new PasswordSignInDisabledError();
    }

    const factors = await secondFactorsOf(this.#database, account.id);
    if (hasSecondFactor(factors)) {
      await this.#beforeSession?.(this.#database, account.id);
      const pending = await this.#challenges.create(this.#database, {
        purpose: "secondFactor",
        accountId: account.id,
        methods: ["password"],
        deviceHash: input.client.deviceToken ? hashToken(input.client.deviceToken) : null,
        withToken: true,
      });
      return {
        status: "secondFactorRequired",
        pendingToken: pending.token ?? "",
        factors: availableFactors(factors),
      };
    }
    const kind = (await this.secondFactorRequired(account.id)) ? "secondFactorSetup" : "full";
    await this.#throttle.recordSuccess(account.email);
    return this.#signedIn((tx, mailIds) =>
      this.#createSession(tx, account, ["password"], kind, input.client, mailIds, started),
    );
  }

  async #pending(pendingToken: string) {
    const pending = await this.#challenges.findByToken(pendingToken, "secondFactor");
    const account = pending?.accountId ? await this.#accounts.get(pending.accountId) : null;
    if (!pending || !canSignIn(account)) throw new ChallengeExpiredError();
    return { pending, account };
  }

  async secondFactorPasskeyOptions(pendingToken: string) {
    const { pending, account } = await this.#pending(pendingToken);
    const options = await this.#webauthn.authenticationOptions({
      accountId: account.id,
      userVerification: "preferred",
    });
    await this.#challenges.setChallenge(pending.id, options.challenge);
    return options;
  }

  async completeSecondFactor(input: {
    pendingToken: string;
    factor: SecondFactorInput;
    client: ClientInfo;
  }): Promise<SignedIn> {
    const started = await this.#databaseNow();
    const { pending, account } = await this.#pending(input.pendingToken);
    const method: SignInMethod = input.factor.type;
    const subjects = { email: account.email, clientIp: input.client.ip };
    await this.#checkAttempt(subjects, account.id, method);

    let valid = false;
    if (input.factor.type === "totp") {
      valid = await this.#totp.verify(this.#database, account.id, input.factor.code);
    } else if (input.factor.type === "passkey") {
      const expectedChallenge = pending.challenge;
      await this.#challenges.setChallenge(pending.id, "");
      valid =
        !!expectedChallenge &&
        (await this.#webauthn.verify({
          response: input.factor.response,
          expectedChallenge,
          accountId: account.id,
          requireUserVerification: false,
        })) !== null;
    }

    const failed = async () => {
      await this.#challenges.recordFailure(pending.id);
      await this.#recordFailure(subjects, account.id, method, "invalidSecondFactor");
      return new InvalidSecondFactorError();
    };
    if (input.factor.type !== "recoveryCode" && !valid) throw await failed();

    const mailIds: string[] = [];
    let result: SignedIn;
    try {
      result = await this.#database.transaction(async (tx) => {
        if (!(await this.#challenges.consume(tx, pending.id))) throw new ChallengeExpiredError();
        const remaining =
          input.factor.type === "recoveryCode"
            ? await this.#recoveryCodes.use(tx, account.id, input.factor.code)
            : null;
        if (input.factor.type === "recoveryCode" && remaining === null) throw new RecoveryCodeRejected();
        const signedIn = await this.#createSession(
          tx,
          account,
          [...pending.methods, method],
          "full",
          input.client,
          mailIds,
          started,
          providerOfPending(pending.payload),
        );
        if (remaining !== null) {
          await this.#audit.record(tx, {
            name: "twoFactor.recoveryCodeUsed",
            actor: ANONYMOUS,
            targetId: account.id,
            fields: { remaining },
          });
          mailIds.push(
            await this.#mail.queue(tx, {
              to: account.email,
              template: "recoveryCodeUsed",
              security: true,
              language: await this.#mail.languageOf(account.id),
              params: { remaining },
            }),
          );
        }
        return signedIn;
      });
    } catch (error) {
      if (error instanceof RecoveryCodeRejected) throw await failed();
      throw error;
    }
    await this.#throttle.recordSuccess(account.email);
    await this.#mail.dispatch(mailIds);
    return result;
  }

  async #pendingLink(pendingToken: string) {
    const pending = await this.#challenges.findByToken(pendingToken, "identityLink");
    const account = pending?.accountId ? await this.#accounts.get(pending.accountId) : null;
    if (!pending || !canSignIn(account) || !pending.payload) throw new ChallengeExpiredError();
    return { pending, account, identity: pending.payload as PendingIdentity };
  }

  async passwordConfirmsLink(account: Account, executor: Executor = this.#database): Promise<boolean> {
    if (!account.passwordHash) return false;
    return (
      (await this.passwordSignInAllowed(executor)) || (await this.#accounts.ownerId(executor)) === account.id
    );
  }

  async identityLinkPasskeyOptions(pendingToken: string, use: "signIn" | "secondFactor" = "secondFactor") {
    const { pending, account } = await this.#pendingLink(pendingToken);
    const options = await this.#webauthn.authenticationOptions({
      accountId: account.id,
      userVerification: use === "signIn" ? "required" : "preferred",
    });
    await this.#challenges.setChallenge(pending.id, options.challenge);
    return options;
  }

  async confirmIdentityLink(input: {
    pendingToken: string;
    password?: string | null;
    passkey?: AuthenticationResponseJSON | null;
    factor: SecondFactorInput | null;
    client: ClientInfo;
  }): Promise<SignedIn> {
    const started = await this.#databaseNow();
    const { pending, account } = await this.#pendingLink(input.pendingToken);
    const subjects = { email: account.email, clientIp: input.client.ip };
    const factors = await secondFactorsOf(this.#database, account.id);
    let methods: SignInMethod[];
    let factorNeeded: boolean;
    if (input.passkey) {
      await this.#checkAttempt(subjects, account.id, "passkey");
      const expectedChallenge = pending.challenge;
      await this.#challenges.setChallenge(pending.id, "");
      const assertion = expectedChallenge
        ? await this.#webauthn.verify({
            response: input.passkey,
            expectedChallenge,
            accountId: account.id,
            requireUserVerification: true,
          })
        : null;
      if (!assertion?.userVerified) {
        await this.#challenges.recordFailure(pending.id);
        await this.#recordFailure(subjects, account.id, "passkey", "invalidCredentials");
        throw new InvalidCredentialsError();
      }
      methods = ["passkey"];
      factorNeeded = false;
    } else if (typeof input.password === "string") {
      await this.#checkAttempt(subjects, account.id, "password");
      let passwordValid = false;
      if (account.passwordHash) {
        passwordValid = (await this.#hasher.verify(account.passwordHash, input.password)).valid;
      } else {
        await this.#hasher.verifyNothing(input.password);
      }
      if (!passwordValid) {
        await this.#challenges.recordFailure(pending.id);
        await this.#recordFailure(subjects, account.id, "password", "invalidCredentials");
        throw new InvalidCredentialsError();
      }
      if (!(await this.passwordConfirmsLink(account))) throw new PasswordSignInDisabledError();
      methods = ["password"];
      factorNeeded = hasSecondFactor(factors);
    } else if (pending.methods.includes("identityProvider")) {
      await this.#checkAttempt(subjects, account.id, "identityProvider");
      methods = ["identityProvider"];
      factorNeeded = true;
    } else {
      throw new InvalidCredentialsError();
    }
    const factor = input.factor;
    const failedFactor = async (method: SignInMethod) => {
      await this.#challenges.recordFailure(pending.id);
      await this.#recordFailure(subjects, account.id, method, "invalidSecondFactor");
      return new InvalidSecondFactorError();
    };
    if (factorNeeded) {
      if (!factor || !hasSecondFactor(factors)) throw await failedFactor("totp");
      if (factor.type === "totp" && !(await this.#totp.verify(this.#database, account.id, factor.code))) {
        throw await failedFactor("totp");
      }
      if (factor.type === "passkey") {
        const expectedChallenge = pending.challenge;
        await this.#challenges.setChallenge(pending.id, "");
        const verified =
          !!expectedChallenge &&
          (await this.#webauthn.verify({
            response: factor.response,
            expectedChallenge,
            accountId: account.id,
            requireUserVerification: false,
          })) !== null;
        if (!verified) throw await failedFactor("passkey");
      }
      methods.push(factor.type);
    }
    const kind =
      factorNeeded || methods.includes("passkey") || !(await this.secondFactorRequired(account.id))
        ? "full"
        : "secondFactorSetup";
    try {
      return await this.completeIdentityLink(pending.id, methods, kind, input.client, started, {
        beforeLink: async (tx) => {
          if (factorNeeded && factor?.type === "recoveryCode") {
            const remaining = await this.#recoveryCodes.use(tx, account.id, factor.code);
            if (remaining === null) throw new RecoveryCodeRejected();
          }
        },
      });
    } catch (error) {
      if (error instanceof RecoveryCodeRejected) throw await failedFactor("recoveryCode");
      throw error;
    }
  }

  async #pendingLinkById(pendingId: string) {
    const pending = await this.#challenges.findById(pendingId, "identityLink");
    const account = pending?.accountId ? await this.#accounts.get(pending.accountId) : null;
    if (!pending || !canSignIn(account) || !pending.payload) throw new ChallengeExpiredError();
    return { pending, account, identity: pending.payload as PendingIdentity };
  }

  async markIdentityLinkConfirmed(pendingId: string, method: SignInMethod): Promise<void> {
    const { pending } = await this.#pendingLinkById(pendingId);
    await this.#challenges.addMethod(pending.id, method);
  }

  async completeIdentityLink(
    pendingId: string,
    confirmedBy: SignInMethod[],
    kind: "full" | "secondFactorSetup",
    client: ClientInfo,
    started: Date,
    options: { beforeLink?: (tx: Transaction) => Promise<void> } = {},
  ): Promise<SignedIn> {
    const { pending, account, identity } = await this.#pendingLinkById(pendingId);
    const methods: SignInMethod[] = [...confirmedBy, "identityProvider"];
    const mailIds: string[] = [];
    const result = await this.#database.transaction(async (tx) => {
      if (!(await this.#challenges.consume(tx, pending.id))) throw new ChallengeExpiredError();
      await options.beforeLink?.(tx);
      const [linked] = await tx
        .insert(identities)
        .values({
          accountId: account.id,
          providerId: identity.providerId,
          subject: identity.subject,
          email: identity.email,
          emailVerified: true,
          signInName: identity.signInName,
          displayName: identity.displayName,
          lastSignInAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: identities.id });
      if (!linked) throw new ChallengeExpiredError();
      await this.#onIdentityLinked?.(tx, {
        providerId: identity.providerId,
        identityId: linked.id,
        accountId: account.id,
        groups: identity.groups ?? null,
      });
      await this.#audit.record(tx, {
        name: "identity.linked",
        actor: accountPrincipal(account.id),
        targetId: account.id,
        fields: { providerId: identity.providerId, via: "signIn" },
      });
      return this.#createSession(tx, account, [...new Set(methods)], kind, client, mailIds, started, {
        providerId: identity.providerId,
        identityId: linked.id,
        providerSessionId: identity.providerSessionId,
      });
    });
    await this.#throttle.recordSuccess(account.email);
    await this.#notifications.dispatch(mailIds);
    return result;
  }

  async passkeyOptions(clientIp: string | undefined) {
    const limit = await this.#rateLimiter.consume(
      `passkeyOptions:client:${clientSubject(clientIp ?? "unknown")}`,
      PASSKEY_OPTIONS_PER_CLIENT_PER_MINUTE,
      60,
    );
    if (!limit.allowed) throw new RateLimitedError(limit.retryAfterSeconds);
    const options = await this.#webauthn.authenticationOptions({ userVerification: "required" });
    const created = await this.#challenges.create(this.#database, {
      purpose: "passkeySignIn",
      challenge: options.challenge,
      withToken: true,
    });
    return { options, token: created.token ?? "" };
  }

  async signInWithPasskey(input: {
    token: string;
    response: AuthenticationResponseJSON;
    client: ClientInfo;
  }): Promise<SignedIn> {
    const clientSubjects = { clientIp: input.client.ip };
    const started = await this.#databaseNow();
    await this.#checkAttempt(clientSubjects, null, "passkey");
    const found = await this.#challenges.findByToken(input.token, "passkeySignIn");
    const challenge = found ? await this.#challenges.consume(this.#database, found.id) : null;
    if (!challenge?.challenge) throw new ChallengeExpiredError();

    const assertion = await this.#webauthn.verify({
      response: input.response,
      expectedChallenge: challenge.challenge,
      requireUserVerification: true,
    });
    const account = assertion ? await this.#accounts.get(assertion.accountId) : null;
    if (!assertion?.userVerified || !canSignIn(account)) {
      await this.#recordFailure(clientSubjects, account?.id ?? null, "passkey", "invalidCredentials");
      throw new InvalidCredentialsError();
    }
    const lockout = await this.#throttle.lockout({ email: account.email });
    if (lockout) {
      await this.#audit.recordAlone({
        name: "auth.signInFailed",
        actor: ANONYMOUS,
        targetId: account.id,
        fields: { reason: "accountLocked", method: "passkey" },
      });
      throw new LockedError(secondsUntil(lockout.lockedUntil));
    }
    await this.#throttle.recordSuccess(account.email);
    return this.#signedIn((tx, mailIds) =>
      this.#createSession(tx, account, ["passkey"], "full", input.client, mailIds, started),
    );
  }

  async reauthenticationPasskeyOptions(session: Session) {
    const options = await this.#webauthn.authenticationOptions({
      accountId: session.accountId,
      userVerification: "preferred",
    });
    await this.#challenges.replaceForSession(
      session.id,
      session.accountId,
      "reauthentication",
      options.challenge,
    );
    return options;
  }

  async reauthenticate(session: Session, input: ReauthenticationInput, client: ClientInfo): Promise<string> {
    const account = await this.#accounts.get(session.accountId);
    if (!canSignIn(account)) throw new InvalidCredentialsError();
    const subjects = { email: account.email, clientIp: client.ip };
    const rate = await this.#throttle.attempt(subjects);
    if (!rate.allowed) throw new RateLimitedError(rate.retryAfterSeconds);
    const lockout = await this.#throttle.lockout(subjects);
    if (lockout) throw new LockedError(secondsUntil(lockout.lockedUntil));

    let valid = false;
    if (input.method === "password") {
      valid = account.passwordHash
        ? (await this.#hasher.verify(account.passwordHash, input.password)).valid
        : false;
    } else if (input.method === "totp") {
      valid = await this.#totp.verify(this.#database, account.id, input.code);
    } else {
      const challenge = await this.#challenges.consumeForSession(session.id, "reauthentication");
      valid =
        !!challenge?.challenge &&
        (await this.#webauthn.verify({
          response: input.response,
          expectedChallenge: challenge.challenge,
          accountId: account.id,
          requireUserVerification: false,
        })) !== null;
    }

    if (!valid) {
      await this.#database.transaction(async (tx) => {
        const lockouts = await this.#throttle.recordFailure(subjects, tx);
        await this.#audit.record(tx, {
          name: "auth.reauthenticationFailed",
          actor: accountPrincipal(account.id),
          targetId: account.id,
          fields: { sessionId: session.id, method: input.method },
        });
        for (const lockout of lockouts) {
          await this.#audit.record(tx, {
            name: "auth.lockedOut",
            actor: ANONYMOUS,
            targetId: lockout.subject === "account" ? account.id : null,
            fields: {
              subject: lockout.subject,
              failures: lockout.failures,
              lockedUntil: lockout.lockedUntil.toISOString(),
            },
          });
        }
      });
      throw new InvalidCredentialsError();
    }
    return this.#database.transaction(async (tx) => {
      const token = await this.#sessions.rotate(tx, session.id, { reauthenticated: true });
      await this.#audit.record(tx, {
        name: "auth.reauthenticated",
        actor: accountPrincipal(account.id),
        targetId: account.id,
        fields: { sessionId: session.id, method: input.method },
      });
      return token;
    });
  }
}
