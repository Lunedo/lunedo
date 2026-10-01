import { AccountService } from "./accounts/accounts.js";
import { AuditLog } from "./audit/audit-log.js";
import { AUDIT_RETENTION_SCHEDULE, applyAuditRetention, auditRetentionJob } from "./audit/retention.js";
import { AccountSecurityService, passwordResetRequestJob } from "./auth/account-security.js";
import { ChallengeStore } from "./auth/challenges.js";
import { AUTH_CLEANUP_SCHEDULE, authCleanupJob } from "./auth/cleanup.js";
import { PasswordHasher } from "./auth/passwords.js";
import { SessionService } from "./auth/sessions.js";
import { SignInService } from "./auth/sign-in.js";
import { RateLimiter, SignInThrottle } from "./auth/throttle.js";
import { RecoveryCodeService, TotpService } from "./auth/two-factor.js";
import { WebAuthnService } from "./auth/webauthn.js";
import type { Encryption } from "./crypto/envelope.js";
import type { KeyRing } from "./crypto/key-ring.js";
import type { KeyRingHolder } from "./crypto/key-ring-holder.js";
import type { Database } from "./database/database.js";
import type { DatabasePool } from "./database/pool.js";
import type { JobQueue } from "./jobs/job-queue.js";
import type { Logger } from "./logging/logger.js";
import {
  DISPATCH_PENDING_MAIL_SCHEDULE,
  deliverMailJob,
  dispatchPendingMailJob,
  MailService,
} from "./mail/mail-service.js";
import type { MailTransport, SmtpOptions } from "./mail/transport.js";
import type { SettingsService } from "./settings/service.js";
import { SetupRegistry } from "./setup/framework.js";
import { SetupService } from "./setup/setup-service.js";
import { builtinSetupSteps } from "./setup/steps.js";

export interface AccountServices {
  audit: AuditLog;
  accounts: AccountService;
  hasher: PasswordHasher;
  rateLimiter: RateLimiter;
  throttle: SignInThrottle;
  sessions: SessionService;
  challenges: ChallengeStore;
  totp: TotpService;
  recoveryCodes: RecoveryCodeService;
  webauthn: WebAuthnService;
  mail: MailService;
  signIn: SignInService;
  security: AccountSecurityService;
  setup: SetupService;
  setupRegistry: SetupRegistry;
}

export function createAccountServices(options: {
  database: Database;
  pool: DatabasePool;
  settings: SettingsService;
  audit: AuditLog;
  encryption: Encryption;
  keyRing: KeyRingHolder;
  backupKeys: KeyRing;
  jobs: JobQueue | undefined;
  logger: Logger;
  filesDir: string;
  passwordHashConcurrency: number;
  mailTransport?: (options: SmtpOptions) => MailTransport;
}): AccountServices {
  const { database, settings, audit, encryption, jobs, logger } = options;
  const hasher = new PasswordHasher({
    concurrency: options.passwordHashConcurrency,
    maxQueued: options.passwordHashConcurrency * 25,
  });
  const accounts = new AccountService({ database, settings, audit, hasher });
  const rateLimiter = new RateLimiter({ database });
  const throttle = new SignInThrottle({ database, settings, rateLimiter });
  const sessions = new SessionService({ database, settings, audit });
  const challenges = new ChallengeStore({ database });
  const totp = new TotpService({ database, encryption });
  const recoveryCodes = new RecoveryCodeService();
  const webauthn = new WebAuthnService({ database, settings });
  const mail = new MailService({
    database,
    encryption,
    settings,
    audit,
    jobs,
    logger,
    ...(options.mailTransport ? { transport: options.mailTransport } : {}),
  });
  const setupRegistry = new SetupRegistry();
  const setup = new SetupService({ database, registry: setupRegistry, audit, rateLimiter });
  const signIn = new SignInService({
    database,
    accounts,
    hasher,
    throttle,
    rateLimiter,
    sessions,
    challenges,
    totp,
    recoveryCodes,
    webauthn,
    audit,
    mail,
    settings,
    setupComplete: () => setup.isComplete(),
  });
  const security = new AccountSecurityService({
    database,
    accounts,
    sessions,
    signIn,
    challenges,
    totp,
    recoveryCodes,
    webauthn,
    audit,
    mail,
    settings,
    throttle,
    rateLimiter,
    jobs,
  });
  setupRegistry.register(
    ...builtinSetupSteps({
      database,
      pool: options.pool,
      settings,
      accounts,
      totp,
      recoveryCodes,
      mail,
      audit,
      keyRing: options.keyRing,
      backupKeys: options.backupKeys,
      filesDir: options.filesDir,
    }),
  );
  return {
    audit,
    accounts,
    hasher,
    rateLimiter,
    throttle,
    sessions,
    challenges,
    totp,
    recoveryCodes,
    webauthn,
    mail,
    signIn,
    security,
    setup,
    setupRegistry,
  };
}

export async function workAccountJobs(
  jobs: JobQueue,
  services: AccountServices,
  settings: SettingsService,
): Promise<void> {
  await jobs.work(deliverMailJob, services.mail.deliver, { concurrency: 4 });
  await jobs.work(dispatchPendingMailJob, async () => {
    await services.mail.dispatchPending();
  });
  await jobs.work(passwordResetRequestJob, services.security.handlePasswordResetRequest);
  await jobs.work(authCleanupJob, async (job) => {
    const removed = {
      sessions: await services.sessions.cleanup(),
      challenges: await services.challenges.cleanup(),
      tokens: await services.security.cleanup(),
      rateLimits: await services.rateLimiter.cleanup(),
      signInFailures: await services.throttle.cleanup(),
      setupSessions: await services.setup.cleanup(),
      failedMails: await services.mail.cleanup(),
    };
    job.logger.debug(removed, "Authentication data cleaned up");
  });
  await jobs.work(auditRetentionJob, async (job) => {
    const removed = await applyAuditRetention({ audit: services.audit, settings });
    if (removed > 0) job.logger.info({ removed }, "Old audit events removed");
  });
  await jobs.schedule(dispatchPendingMailJob, DISPATCH_PENDING_MAIL_SCHEDULE, {}, { key: "minutely" });
  await jobs.schedule(authCleanupJob, AUTH_CLEANUP_SCHEDULE, {}, { key: "regular" });
  await jobs.schedule(auditRetentionJob, AUDIT_RETENTION_SCHEDULE, {}, { key: "daily" });
}
