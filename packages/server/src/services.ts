import { AccountService } from "./accounts/accounts.js";
import { AuditLog } from "./audit/audit-log.js";
import { AuditReader } from "./audit/reader.js";
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
import { AuthorizationRegistry } from "./authorization/registry.js";
import { resourceTypes } from "./authorization/resources.js";
import { AuthorizationService } from "./authorization/service.js";
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
import { NotificationRegistry } from "./notifications/registry.js";
import { NOTIFICATION_RETENTION_SCHEDULE, notificationRetentionJob } from "./notifications/retention.js";
import { NotificationService } from "./notifications/service.js";
import { builtinNotificationTypes } from "./notifications/types.js";
import { BreakGlassService } from "./organizations/break-glass.js";
import { GroupService } from "./organizations/groups.js";
import { InvitationService, registrationRequestJob } from "./organizations/invitations.js";
import {
  ORGANIZATION_EXPIRY_SCHEDULE,
  ORGANIZATION_REMINDERS_SCHEDULE,
  OrganizationLifecycle,
  organizationExpiryJob,
  organizationRemindersJob,
} from "./organizations/lifecycle.js";
import { MembershipService } from "./organizations/memberships.js";
import { OrganizationService } from "./organizations/organizations.js";
import { RoleService } from "./organizations/roles.js";
import type { SettingsService } from "./settings/service.js";
import { SetupRegistry } from "./setup/framework.js";
import { SetupService } from "./setup/setup-service.js";
import { builtinSetupSteps } from "./setup/steps.js";
import { API_TOKEN_EXPIRY_SCHEDULE, ApiTokenService, apiTokenExpiryJob } from "./tokens/api-tokens.js";
import { ServiceAccountService } from "./tokens/service-accounts.js";

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
  authorization: AuthorizationService;
  organizations: OrganizationService;
  memberships: MembershipService;
  roles: RoleService;
  groups: GroupService;
  invitations: InvitationService;
  breakGlass: BreakGlassService;
  lifecycle: OrganizationLifecycle;
  auditReader: AuditReader;
  serviceAccounts: ServiceAccountService;
  apiTokens: ApiTokenService;
  notifications: NotificationService;
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
  const authorization = new AuthorizationService({
    database,
    registry: new AuthorizationRegistry().register(...resourceTypes(settings)),
    audit,
  });
  const organizations = new OrganizationService({ database, settings, audit });
  const memberships = new MembershipService({ database, audit, authorization });
  const roles = new RoleService({ database, audit, authorization });
  const groups = new GroupService({ database, audit, authorization });
  const notifications = new NotificationService({
    database,
    settings,
    mail,
    authorization,
    registry: new NotificationRegistry().register(...builtinNotificationTypes),
  });
  const breakGlass = new BreakGlassService({ database, audit, notifications, settings });
  const lifecycle = new OrganizationLifecycle({
    database,
    audit,
    memberships,
    breakGlass,
    notifications,
    settings,
  });
  const invitations = new InvitationService({
    database,
    audit,
    accounts,
    memberships,
    roles,
    organizations,
    mail,
    settings,
    rateLimiter,
    jobs,
  });
  const auditReader = new AuditReader({ database, authorization, audit });
  const serviceAccounts = new ServiceAccountService({ database, audit, notifications, authorization });
  const apiTokens = new ApiTokenService({
    database,
    audit,
    settings,
    rateLimiter,
    notifications,
    authorization,
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
    notifications,
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
      organizations,
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
    authorization,
    organizations,
    memberships,
    roles,
    groups,
    invitations,
    breakGlass,
    lifecycle,
    auditReader,
    serviceAccounts,
    apiTokens,
    notifications,
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
  await jobs.work(registrationRequestJob, services.invitations.handleRegistrationRequest);
  await jobs.work(organizationExpiryJob, async (job) => {
    const processed = await services.lifecycle.processExpiry();
    if (processed > 0) job.logger.info({ processed }, "Expired access removed");
    const notified = await services.serviceAccounts.notifyUnattended();
    if (notified > 0)
      job.logger.info({ notified }, "Owners told about service accounts without responsible people");
  });
  await jobs.work(organizationRemindersJob, async (job) => {
    const sent = await services.lifecycle.sendReminders();
    if (sent > 0) job.logger.info({ sent }, "Expiry reminders sent");
  });
  await jobs.work(apiTokenExpiryJob, async (job) => {
    const expired = await services.apiTokens.recordExpired();
    const reminded = await services.apiTokens.sendReminders();
    if (expired + reminded > 0) job.logger.info({ expired, reminded }, "API token expiry processed");
  });
  await jobs.work(authCleanupJob, async (job) => {
    const removed = {
      sessions: await services.sessions.cleanup(),
      challenges: await services.challenges.cleanup(),
      tokens: await services.security.cleanup(),
      rateLimits: await services.rateLimiter.cleanup(),
      signInFailures: await services.throttle.cleanup(),
      setupSessions: await services.setup.cleanup(),
      failedMails: await services.mail.cleanup(),
      invitations: await services.invitations.cleanup(),
    };
    job.logger.debug(removed, "Authentication data cleaned up");
  });
  await jobs.work(notificationRetentionJob, async (job) => {
    const removed = await services.notifications.applyRetention();
    if (removed > 0) job.logger.info({ removed }, "Old notifications removed");
  });
  await jobs.work(auditRetentionJob, async (job) => {
    const removed = await applyAuditRetention({ audit: services.audit, settings });
    if (removed > 0) job.logger.info({ removed }, "Old audit events removed");
  });
  await jobs.schedule(dispatchPendingMailJob, DISPATCH_PENDING_MAIL_SCHEDULE, {}, { key: "minutely" });
  await jobs.schedule(authCleanupJob, AUTH_CLEANUP_SCHEDULE, {}, { key: "regular" });
  await jobs.schedule(auditRetentionJob, AUDIT_RETENTION_SCHEDULE, {}, { key: "daily" });
  await jobs.schedule(notificationRetentionJob, NOTIFICATION_RETENTION_SCHEDULE, {}, { key: "daily" });
  await jobs.schedule(organizationExpiryJob, ORGANIZATION_EXPIRY_SCHEDULE, {}, { key: "minutely" });
  await jobs.schedule(apiTokenExpiryJob, API_TOKEN_EXPIRY_SCHEDULE, {}, { key: "regular" });
  await jobs.schedule(organizationRemindersJob, ORGANIZATION_REMINDERS_SCHEDULE, {}, { key: "hourly" });
}
