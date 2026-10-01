import type { Account, AccountService } from "../accounts/accounts.js";
import { ANONYMOUS, accountPrincipal } from "../accounts/principal.js";
import { accountScopeChain } from "../accounts/scope.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { SignInMethod } from "../audit/catalog.js";
import type { Database, Transaction } from "../database/database.js";
import type { MailService } from "../mail/mail-service.js";
import type { SettingsService } from "../settings/service.js";
import type { ChallengeStore } from "./challenges.js";
import {
  ChallengeExpiredError,
  InvalidCredentialsError,
  InvalidSecondFactorError,
  LockedError,
  RateLimitedError,
  SetupIncompleteError,
} from "./errors.js";
import type { PasswordHasher } from "./passwords.js";
import type { ClientInfo, Session, SessionKind, SessionService } from "./sessions.js";
import { twoFactorRequiredSetting } from "./settings.js";
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
  readonly #settings: SettingsService;
  readonly #setupComplete: () => Promise<boolean>;

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
    settings: SettingsService;
    setupComplete: () => Promise<boolean>;
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
    this.#settings = options.settings;
    this.#setupComplete = options.setupComplete;
  }

  async secondFactorRequired(accountId: string): Promise<boolean> {
    if ((await this.#accounts.ownerId()) === accountId) return true;
    return this.#settings.get(twoFactorRequiredSetting, accountScopeChain(accountId));
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

  async #createSession(
    tx: Transaction,
    account: Account,
    methods: SignInMethod[],
    kind: SessionKind,
    client: ClientInfo,
  ): Promise<SignedIn> {
    const { session, token } = await this.#sessions.create(tx, {
      accountId: account.id,
      kind,
      methods,
      client,
    });
    await this.#audit.record(tx, {
      name: "auth.signedIn",
      actor: accountPrincipal(account.id),
      targetId: account.id,
      fields: { sessionId: session.id, methods },
    });
    return { status: "signedIn", session, token };
  }

  async signInWithPassword(input: {
    email: string;
    password: string;
    client: ClientInfo;
  }): Promise<SignedIn | SecondFactorRequired> {
    const subjects = { email: input.email, clientIp: input.client.ip };
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

    const factors = await secondFactorsOf(this.#database, account.id);
    if (hasSecondFactor(factors)) {
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
    return this.#database.transaction((tx) =>
      this.#createSession(tx, account, ["password"], kind, input.client),
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
    return this.#database.transaction((tx) =>
      this.#createSession(tx, account, ["passkey"], "full", input.client),
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
