import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { type AccountService, emailSchema, withUniqueEmail } from "../accounts/accounts.js";
import { instanceNameSetting, instanceUrlSetting } from "../accounts/instance-settings.js";
import { ANONYMOUS, accountPrincipal } from "../accounts/principal.js";
import { accounts } from "../accounts/schema.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { Database, Transaction } from "../database/database.js";
import { managedStateOf, refreshManagedAccounts, refuseManaged } from "../identity/managed.js";
import { defineJob, type JobContext, type JobQueue } from "../jobs/job-queue.js";
import type { MailService } from "../mail/mail-service.js";
import type { SettingsService } from "../settings/service.js";
import type { ChallengeStore } from "./challenges.js";
import {
  ChallengeExpiredError,
  InvalidSecondFactorError,
  InvalidTokenError,
  LastFactorError,
  NoSecondFactorError,
  RateLimitedError,
  SameEmailError,
  SecondFactorExistsError,
} from "./errors.js";
import { accountTokens, authChallenges } from "./schema.js";
import type { Session, SessionService } from "./sessions.js";
import type { SignInService } from "./sign-in.js";
import type { RateLimiter, SignInThrottle } from "./throttle.js";
import { accountSubject, clientSubject } from "./throttle.js";
import { generateToken, hashToken, isWellFormedToken } from "./tokens.js";
import {
  hasSecondFactor,
  type RecoveryCodeService,
  secondFactorsOf,
  type TotpService,
} from "./two-factor.js";
import type { Passkey, RegistrationResponseJSON, WebAuthnService } from "./webauthn.js";

const PASSWORD_RESET_MINUTES = 30;
const EMAIL_CHANGE_HOURS = 24;
const HOUR_SECONDS = 60 * 60;

const PASSWORD_RESETS_PER_ADDRESS = 3;
const PASSWORD_RESETS_PER_CLIENT = 20;
const TOKEN_REDEMPTIONS_PER_CLIENT = 30;
const EMAIL_CHANGES_PER_ACCOUNT = 5;
const EMAIL_CHANGES_PER_ADDRESS = 3;

export const passwordResetRequestJob = defineJob({
  name: "auth.password-reset-request",
  duringMaintenance: "run",
  payload: z.object({ email: z.string().max(254) }),
  retryLimit: 3,
});

export interface RotatedSession {
  token: string;
}

export interface FactorAdded {
  token: string | null;
  recoveryCodes: string[] | null;
}

export class AccountSecurityService {
  readonly #database: Database;
  readonly #accounts: AccountService;
  readonly #sessions: SessionService;
  readonly #signIn: SignInService;
  readonly #challenges: ChallengeStore;
  readonly #totp: TotpService;
  readonly #recoveryCodes: RecoveryCodeService;
  readonly #webauthn: WebAuthnService;
  readonly #audit: AuditLog;
  readonly #mail: MailService;
  readonly #settings: SettingsService;
  readonly #throttle: SignInThrottle;
  readonly #rateLimiter: RateLimiter;
  readonly #jobs: JobQueue | undefined;

  constructor(options: {
    database: Database;
    accounts: AccountService;
    sessions: SessionService;
    signIn: SignInService;
    challenges: ChallengeStore;
    totp: TotpService;
    recoveryCodes: RecoveryCodeService;
    webauthn: WebAuthnService;
    audit: AuditLog;
    mail: MailService;
    settings: SettingsService;
    throttle: SignInThrottle;
    rateLimiter: RateLimiter;
    jobs: JobQueue | undefined;
  }) {
    this.#database = options.database;
    this.#accounts = options.accounts;
    this.#sessions = options.sessions;
    this.#signIn = options.signIn;
    this.#challenges = options.challenges;
    this.#totp = options.totp;
    this.#recoveryCodes = options.recoveryCodes;
    this.#webauthn = options.webauthn;
    this.#audit = options.audit;
    this.#mail = options.mail;
    this.#settings = options.settings;
    this.#throttle = options.throttle;
    this.#rateLimiter = options.rateLimiter;
    this.#jobs = options.jobs;
  }

  async #account(accountId: string) {
    const account = await this.#accounts.get(accountId);
    if (!account?.email) throw new ChallengeExpiredError();
    return { ...account, email: account.email };
  }

  async #link(path: string, token: string): Promise<string> {
    const base = await this.#settings.get(instanceUrlSetting, {});
    return `${base}${path}#token=${token}`;
  }

  async overview(accountId: string) {
    const factors = await secondFactorsOf(this.#database, accountId);
    return {
      totp: factors.totp,
      passkeys: await this.#webauthn.list(accountId),
      recoveryCodes: factors.recoveryCodes,
      ...(await this.#requirement(accountId)),
    };
  }

  async #requirement(accountId: string) {
    const requiredBy = await this.#signIn.secondFactorRequirement(accountId);
    return { secondFactorRequired: requiredBy !== null, secondFactorRequiredBy: requiredBy };
  }

  async #factorAdded(tx: Transaction, session: Session): Promise<FactorAdded> {
    await tx.update(accounts).set({ secondFactorResetAt: null }).where(eq(accounts.id, session.accountId));
    let recoveryCodes: string[] | null = null;
    if ((await this.#recoveryCodes.remaining(tx, session.accountId)) === 0) {
      recoveryCodes = await this.#recoveryCodes.generate(tx, session.accountId);
      await this.#audit.record(tx, {
        name: "twoFactor.recoveryCodesGenerated",
        actor: accountPrincipal(session.accountId),
        targetId: session.accountId,
        fields: { count: recoveryCodes.length },
      });
    }
    const token =
      session.kind === "secondFactorSetup"
        ? await this.#sessions.rotate(tx, session.id, { kind: "full" })
        : null;
    return { token, recoveryCodes };
  }

  async beginTotp(session: Session) {
    await refuseManaged(this.#database, session.accountId, "providerOnly");
    const account = await this.#account(session.accountId);
    const issuer = await this.#settings.get(instanceNameSetting, {});
    const setup = await this.#totp.begin(account.id, { issuer, account: account.email });
    if (!setup) throw new SecondFactorExistsError();
    return setup;
  }

  async confirmTotp(session: Session, code: string): Promise<FactorAdded> {
    return this.#database.transaction(async (tx) => {
      await this.#accounts.lock(tx, session.accountId);
      await refuseManaged(tx, session.accountId, "providerOnly");
      if (!(await this.#totp.verify(tx, session.accountId, code, { confirming: true }))) {
        throw new InvalidSecondFactorError();
      }
      const added = await this.#factorAdded(tx, session);
      await this.#audit.record(tx, {
        name: "twoFactor.totpAdded",
        actor: accountPrincipal(session.accountId),
        targetId: session.accountId,
        fields: {},
      });
      return added;
    });
  }

  async passkeyRegistrationOptions(session: Session) {
    await refuseManaged(this.#database, session.accountId, "providerOnly");
    const account = await this.#account(session.accountId);
    const options = await this.#webauthn.registrationOptions(account);
    await this.#challenges.replaceForSession(
      session.id,
      account.id,
      "passkeyRegistration",
      options.challenge,
    );
    return options;
  }

  async registerPasskey(
    session: Session,
    response: RegistrationResponseJSON,
    name: string,
  ): Promise<FactorAdded & { passkey: Passkey }> {
    const challenge = await this.#challenges.consumeForSession(session.id, "passkeyRegistration");
    if (!challenge?.challenge) throw new ChallengeExpiredError();
    const expectedChallenge = challenge.challenge;
    return this.#database.transaction(async (tx) => {
      await this.#accounts.lock(tx, session.accountId);
      await refuseManaged(tx, session.accountId, "providerOnly");
      const passkey = await this.#webauthn.register(tx, {
        accountId: session.accountId,
        response,
        expectedChallenge,
        name,
      });
      if (!passkey) throw new InvalidSecondFactorError();
      const added = await this.#factorAdded(tx, session);
      await this.#audit.record(tx, {
        name: "twoFactor.passkeyAdded",
        actor: accountPrincipal(session.accountId),
        targetId: session.accountId,
        fields: { credentialId: passkey.id, name: passkey.name },
      });
      return { ...added, passkey };
    });
  }

  async #assertFactorRemains(tx: Transaction, accountId: string): Promise<void> {
    if (hasSecondFactor(await secondFactorsOf(tx, accountId))) return;
    if (await this.#signIn.secondFactorRequired(accountId)) throw new LastFactorError();
  }

  async removeTotp(session: Session): Promise<boolean> {
    return this.#database.transaction(async (tx) => {
      await this.#accounts.lock(tx, session.accountId);
      const removed = await this.#totp.remove(tx, session.accountId);
      if (!removed) return false;
      await this.#assertFactorRemains(tx, session.accountId);
      await this.#audit.record(tx, {
        name: "twoFactor.totpRemoved",
        actor: accountPrincipal(session.accountId),
        targetId: session.accountId,
        fields: {},
      });
      return true;
    });
  }

  async removePasskey(session: Session, passkeyId: string): Promise<boolean> {
    return this.#database.transaction(async (tx) => {
      await this.#accounts.lock(tx, session.accountId);
      const name = await this.#webauthn.remove(tx, session.accountId, passkeyId);
      if (name === null) return false;
      await this.#assertFactorRemains(tx, session.accountId);
      await this.#audit.record(tx, {
        name: "twoFactor.passkeyRemoved",
        actor: accountPrincipal(session.accountId),
        targetId: session.accountId,
        fields: { credentialId: passkeyId, name },
      });
      return true;
    });
  }

  async generateRecoveryCodes(session: Session): Promise<string[]> {
    return this.#database.transaction(async (tx) => {
      await this.#accounts.lock(tx, session.accountId);
      await refuseManaged(tx, session.accountId, "providerOnly");
      if (!hasSecondFactor(await secondFactorsOf(tx, session.accountId))) throw new NoSecondFactorError();
      const codes = await this.#recoveryCodes.generate(tx, session.accountId);
      await this.#audit.record(tx, {
        name: "twoFactor.recoveryCodesGenerated",
        actor: accountPrincipal(session.accountId),
        targetId: session.accountId,
        fields: { count: codes.length },
      });
      return codes;
    });
  }

  async changePassword(session: Session, newPassword: string): Promise<RotatedSession> {
    const passwordHash = await this.#accounts.hashPassword(newPassword, session.accountId);
    return this.#database.transaction(async (tx) => {
      await this.#accounts.lock(tx, session.accountId);
      await refuseManaged(tx, session.accountId, "any");
      await this.#accounts.setPasswordHash(tx, session.accountId, passwordHash);
      const ended = await this.#sessions.endAll(tx, session.accountId, { keep: session.id });
      await tx.delete(authChallenges).where(eq(authChallenges.accountId, session.accountId));
      await tx
        .delete(accountTokens)
        .where(
          and(eq(accountTokens.accountId, session.accountId), eq(accountTokens.purpose, "passwordReset")),
        );
      const token = await this.#sessions.rotate(tx, session.id);
      await this.#audit.record(tx, {
        name: "account.passwordChanged",
        actor: accountPrincipal(session.accountId),
        targetId: session.accountId,
        fields: { endedSessions: ended.length },
      });
      return { token };
    });
  }

  async requestPasswordReset(email: string, clientIp: string | undefined): Promise<void> {
    if (clientIp) {
      const perClient = await this.#rateLimiter.consume(
        `passwordReset:client:${clientSubject(clientIp)}`,
        PASSWORD_RESETS_PER_CLIENT,
        HOUR_SECONDS,
      );
      if (!perClient.allowed) throw new RateLimitedError(perClient.retryAfterSeconds);
    }
    const perAddress = await this.#rateLimiter.consume(
      `passwordReset:account:${accountSubject(email)}`,
      PASSWORD_RESETS_PER_ADDRESS,
      HOUR_SECONDS,
    );
    if (!perAddress.allowed || !this.#jobs) return;
    await this.#jobs.enqueue(passwordResetRequestJob, { email: email.trim() });
  }

  async localPasswordLink(tx: Transaction, accountId: string, providerName: string): Promise<string | null> {
    const account = await this.#accounts.get(accountId, tx);
    if (!account?.email) return null;
    const token = generateToken();
    await tx
      .delete(accountTokens)
      .where(and(eq(accountTokens.accountId, account.id), eq(accountTokens.purpose, "passwordReset")));
    await tx.insert(accountTokens).values({
      accountId: account.id,
      purpose: "passwordReset",
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + PASSWORD_RESET_MINUTES * 60_000),
    });
    return this.#mail.queue(tx, {
      to: account.email,
      template: "accountMadeLocal",
      security: true,
      language: await this.#mail.languageOf(account.id),
      params: {
        providerName,
        link: await this.#link("/reset-password", token),
        minutes: PASSWORD_RESET_MINUTES,
      },
    });
  }

  handlePasswordResetRequest = async (job: JobContext<{ email: string }>): Promise<void> => {
    const account = await this.#accounts.findByEmail(job.payload.email);
    if (!account?.email || account.state !== "active") return;
    if (!account.passwordHash && account.type !== "standard" && account.type !== "guest") return;
    if (await managedStateOf(this.#database, account.id)) return;
    const email = account.email;
    const token = generateToken();
    const link = await this.#link("/reset-password", token);
    const mailId = await this.#database.transaction(async (tx) => {
      await tx
        .delete(accountTokens)
        .where(and(eq(accountTokens.accountId, account.id), eq(accountTokens.purpose, "passwordReset")));
      await tx.insert(accountTokens).values({
        accountId: account.id,
        purpose: "passwordReset",
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_MINUTES * 60_000),
      });
      const id = await this.#mail.queue(tx, {
        to: email,
        template: "passwordReset",
        language: await this.#mail.languageOf(account.id),
        params: { link, minutes: PASSWORD_RESET_MINUTES },
      });
      await this.#audit.record(tx, {
        name: "account.passwordResetRequested",
        actor: ANONYMOUS,
        targetId: account.id,
        fields: {},
      });
      return id;
    });
    await this.#mail.dispatch([mailId]);
  };

  async #redeemToken(
    tx: Transaction,
    token: string,
    purpose: "passwordReset" | "emailChange",
  ): Promise<{ accountId: string; newEmail: string | null }> {
    if (!isWellFormedToken(token)) throw new InvalidTokenError();
    const [row] = await tx
      .update(accountTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(accountTokens.tokenHash, hashToken(token)),
          eq(accountTokens.purpose, purpose),
          isNull(accountTokens.usedAt),
          gt(accountTokens.expiresAt, new Date()),
        ),
      )
      .returning({ accountId: accountTokens.accountId, newEmail: accountTokens.newEmail });
    if (!row) throw new InvalidTokenError();
    return row;
  }

  async #limitRedemptions(clientIp: string | undefined): Promise<void> {
    if (!clientIp) return;
    const result = await this.#rateLimiter.consume(
      `tokenRedemption:client:${clientSubject(clientIp)}`,
      TOKEN_REDEMPTIONS_PER_CLIENT,
      HOUR_SECONDS,
    );
    if (!result.allowed) throw new RateLimitedError(result.retryAfterSeconds);
  }

  async completePasswordReset(
    token: string,
    newPassword: string,
    clientIp: string | undefined,
  ): Promise<void> {
    await this.#limitRedemptions(clientIp);
    await this.#database.transaction(async (tx) => {
      const { accountId } = await this.#redeemToken(tx, token, "passwordReset");
      const account = await this.#accounts.lock(tx, accountId);
      if (!account?.email || account.state !== "active") throw new InvalidTokenError();
      if (await managedStateOf(tx, accountId)) throw new InvalidTokenError();
      await this.#accounts.setPasswordHash(
        tx,
        accountId,
        await this.#accounts.hashPassword(newPassword, accountId),
      );
      const ended = await this.#sessions.endAll(tx, accountId);
      await tx.delete(authChallenges).where(eq(authChallenges.accountId, accountId));
      await this.#throttle.recordSuccess(account.email, tx);
      await this.#audit.record(tx, {
        name: "account.passwordReset",
        actor: ANONYMOUS,
        targetId: accountId,
        fields: { endedSessions: ended.length },
      });
    });
  }

  async requestEmailChange(session: Session, newEmail: string): Promise<void> {
    const email = emailSchema.parse(newEmail.trim());
    const account = await this.#account(session.accountId);
    await refuseManaged(this.#database, account.id, "any");
    if (email.toLowerCase() === account.email.toLowerCase()) throw new SameEmailError();
    for (const [key, limit] of [
      [`emailChange:account:${account.id}`, EMAIL_CHANGES_PER_ACCOUNT],
      [`emailChange:address:${accountSubject(email)}`, EMAIL_CHANGES_PER_ADDRESS],
    ] as const) {
      const result = await this.#rateLimiter.consume(key, limit, HOUR_SECONDS);
      if (!result.allowed) throw new RateLimitedError(result.retryAfterSeconds);
    }
    const taken = await this.#accounts.findByEmail(email);
    const language = await this.#mail.languageOf(account.id);
    const token = generateToken();
    const link = await this.#link("/confirm-email", token);
    const mailId = await this.#database.transaction(async (tx) => {
      await tx
        .delete(accountTokens)
        .where(and(eq(accountTokens.accountId, account.id), eq(accountTokens.purpose, "emailChange")));
      let id: string;
      if (taken) {
        id = await this.#mail.queue(tx, {
          to: email,
          template: "emailChangeAddressInUse",
          security: true,
          language,
          params: {},
        });
      } else {
        await tx.insert(accountTokens).values({
          accountId: account.id,
          purpose: "emailChange",
          tokenHash: hashToken(token),
          newEmail: email,
          expiresAt: new Date(Date.now() + EMAIL_CHANGE_HOURS * HOUR_SECONDS * 1000),
        });
        id = await this.#mail.queue(tx, {
          to: email,
          template: "emailChangeConfirmation",
          language,
          params: { link, hours: EMAIL_CHANGE_HOURS },
        });
      }
      await this.#audit.record(tx, {
        name: "account.emailChangeRequested",
        actor: accountPrincipal(account.id),
        targetId: account.id,
        fields: { newEmail: email },
      });
      return id;
    });
    await this.#mail.dispatch([mailId]);
  }

  async confirmEmailChange(token: string, clientIp: string | undefined): Promise<void> {
    await this.#limitRedemptions(clientIp);
    const mailId = await this.#database.transaction(async (tx) => {
      const { accountId, newEmail } = await this.#redeemToken(tx, token, "emailChange");
      const account = await this.#accounts.lock(tx, accountId);
      if (!newEmail || !account?.email || account.state !== "active") throw new InvalidTokenError();
      if (await managedStateOf(tx, accountId)) throw new InvalidTokenError();
      const previousEmail = account.email;
      await withUniqueEmail(() =>
        tx.update(accounts).set({ email: newEmail, updatedAt: new Date() }).where(eq(accounts.id, accountId)),
      );
      const id = await this.#mail.queue(tx, {
        to: previousEmail,
        template: "emailChangeNotice",
        security: true,
        language: await this.#mail.languageOf(accountId),
        params: { newEmail },
      });
      await this.#audit.record(tx, {
        name: "account.emailChanged",
        actor: accountPrincipal(accountId),
        targetId: accountId,
        fields: { previousEmail, newEmail },
      });
      await refreshManagedAccounts(tx, this.#audit, { accountIds: [accountId] }, accountPrincipal(accountId));
      return id;
    });
    await this.#mail.dispatch([mailId]);
  }

  async cleanup(): Promise<number> {
    const deleted = await this.#database
      .delete(accountTokens)
      .where(or(sql`${accountTokens.usedAt} is not null`, lt(accountTokens.expiresAt, new Date())));
    return deleted.rowCount ?? 0;
  }
}
