import { uuidv7 } from "@pagehall/shared";
import { AccountService } from "./accounts/accounts.js";
import { AccountAdministrationService } from "./accounts/administration.js";
import { InstanceAddressService } from "./accounts/instance-address.js";
import { AccountLifecycleService } from "./accounts/lifecycle.js";
import { AccountOverviewService } from "./accounts/overview.js";
import { AuditLog } from "./audit/audit-log.js";
import { AuditReader } from "./audit/reader.js";
import { AUDIT_RETENTION_SCHEDULE, applyAuditRetention, auditRetentionJob } from "./audit/retention.js";
import { AccountSecurityService, passwordResetRequestJob } from "./auth/account-security.js";
import { ChallengeStore } from "./auth/challenges.js";
import { AUTH_CLEANUP_SCHEDULE, authCleanupJob } from "./auth/cleanup.js";
import { EmergencyRecipientsService } from "./auth/emergency-recipients.js";
import { PasswordHasher } from "./auth/passwords.js";
import { SessionService } from "./auth/sessions.js";
import { SignInService } from "./auth/sign-in.js";
import { RateLimiter, SignInThrottle } from "./auth/throttle.js";
import { RecoveryCodeService, TotpService } from "./auth/two-factor.js";
import { WebAuthnService } from "./auth/webauthn.js";
import { AuthorizationRegistry } from "./authorization/registry.js";
import { resourceTypes } from "./authorization/resources.js";
import { AuthorizationService } from "./authorization/service.js";
import { BlogService } from "./collaboration/blog.js";
import { CommentService } from "./collaboration/comments.js";
import { ContentActivity } from "./collaboration/content.js";
import { HomeService } from "./collaboration/home.js";
import {
  COLLABORATION_CLEANUP_SCHEDULE,
  collaborationCleanupJob,
  SCHEDULED_BLOG_POSTS_SCHEDULE,
  scheduledBlogPostsJob,
} from "./collaboration/jobs.js";
import { collaborationNotificationTypes } from "./collaboration/notifications.js";
import { ReactionService } from "./collaboration/reactions.js";
import { TaskService } from "./collaboration/tasks.js";
import type { Encryption } from "./crypto/envelope.js";
import type { KeyRing } from "./crypto/key-ring.js";
import type { KeyRingHolder } from "./crypto/key-ring-holder.js";
import type { Database } from "./database/database.js";
import type { DatabasePool } from "./database/pool.js";
import { AttachmentService } from "./files/attachments.js";
import { FileService } from "./files/files.js";
import { FILE_CLEANUP_SCHEDULE, fileCleanupJob } from "./files/jobs.js";
import { type FileStore, LocalFileStore } from "./files/store.js";
import { GroupMappingService } from "./identity/groups.js";
import { LdapAdapter } from "./identity/ldap.js";
import type { DirectoryConnector } from "./identity/ldap-connection.js";
import { MappingRuleService } from "./identity/mapping.js";
import { OidcAdapter } from "./identity/oidc.js";
import {
  IdentityProviderService,
  PROVIDER_CREDENTIAL_REMINDER_SCHEDULE,
  providerCredentialReminderJob,
  SAML_METADATA_REFRESH_SCHEDULE,
  samlMetadataRefreshJob,
} from "./identity/providers.js";
import { SamlAdapter } from "./identity/saml.js";
import { ScimService } from "./identity/scim.js";
import { ScimTokenService } from "./identity/scim-tokens.js";
import { ProviderSignInService } from "./identity/sign-in.js";
import {
  PROVIDER_SYNC_RETENTION_SCHEDULE,
  PROVIDER_SYNC_SCHEDULE,
  ProviderSyncService,
  providerSyncJob,
  providerSyncRetentionJob,
  providerSyncScheduleJob,
} from "./identity/sync.js";
import { AtlassianDirectory } from "./imports/atlassian.js";
import { ConfluenceCsvReader } from "./imports/confluence/csv-reader.js";
import { ConfluenceXmlReader } from "./imports/confluence/xml-reader.js";
import { ImportService } from "./imports/imports.js";
import {
  IMPORT_CLEANUP_SCHEDULE,
  IMPORT_WATCHDOG_SCHEDULE,
  importCleanupJob,
  importWatchdogJob,
  importWorkJob,
} from "./imports/jobs.js";
import { importNotificationTypes } from "./imports/notifications.js";
import { ImportPipeline } from "./imports/pipeline.js";
import { ImportReaderRegistry } from "./imports/source.js";
import { UploadService } from "./imports/uploads.js";
import { ImportWorker } from "./imports/worker.js";
import type { JobQueue } from "./jobs/job-queue.js";
import type { Logger } from "./logging/logger.js";
import {
  DISPATCH_PENDING_MAIL_SCHEDULE,
  deliverMailJob,
  dispatchPendingMailJob,
  MAIL_CREDENTIAL_REMINDER_SCHEDULE,
  MailService,
  mailCredentialReminderJob,
} from "./mail/mail-service.js";
import type { MailTransport, SmtpOptions } from "./mail/transport.js";
import { DecisionService } from "./meetings/decisions.js";
import { MeetingService } from "./meetings/meetings.js";
import { meetingNotificationTypes } from "./meetings/notifications.js";
import { OneOnOneService } from "./meetings/one-on-ones.js";
import { PrivateNotesService } from "./meetings/private-notes.js";
import { TopicService } from "./meetings/topics.js";
import { NotificationRegistry } from "./notifications/registry.js";
import { NOTIFICATION_RETENTION_SCHEDULE, notificationRetentionJob } from "./notifications/retention.js";
import { NotificationService } from "./notifications/service.js";
import { builtinNotificationTypes } from "./notifications/types.js";
import { BreakGlassService } from "./organizations/break-glass.js";
import { GroupService } from "./organizations/groups.js";
import { HomeOrganizationService } from "./organizations/home.js";
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
import { AccessExplanationService } from "./sharing/explain.js";
import { GiveAccessDraftService } from "./sharing/give-access-drafts.js";
import { GuestShareService } from "./sharing/guests.js";
import { ShareLinkService } from "./sharing/links.js";
import { sharingNotificationTypes } from "./sharing/notifications.js";
import { PageAccessService } from "./sharing/page-access.js";
import { AccessRequestService } from "./sharing/requests.js";
import { ValueSigner } from "./sharing/signer.js";
import { ArchiveService } from "./spaces/archive.js";
import { ConfidentialSpaceService } from "./spaces/confidential.js";
import { PageDocumentService } from "./spaces/documents.js";
import { TreeService } from "./spaces/items.js";
import {
  LIVE_VERSIONS_SCHEDULE,
  liveVersionsJob,
  TRASH_RETENTION_SCHEDULE,
  trashRetentionJob,
} from "./spaces/jobs.js";
import { PeopleService } from "./spaces/people.js";
import { SpaceHolders, SpacePermissionService } from "./spaces/permissions.js";
import { PersonalSpaceService } from "./spaces/personal.js";
import { ReportService } from "./spaces/reports.js";
import { SpaceService } from "./spaces/spaces.js";
import { TrashService } from "./spaces/trash.js";
import { VersionService } from "./spaces/versions.js";
import { TemplateService } from "./templates/templates.js";
import { API_TOKEN_EXPIRY_SCHEDULE, ApiTokenService, apiTokenExpiryJob } from "./tokens/api-tokens.js";
import { ServiceAccountService } from "./tokens/service-accounts.js";

export interface AccountServices {
  audit: AuditLog;
  instanceAddress: InstanceAddressService;
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
  homeOrganizations: HomeOrganizationService;
  administration: AccountAdministrationService;
  accountLifecycle: AccountLifecycleService;
  overview: AccountOverviewService;
  roles: RoleService;
  groups: GroupService;
  invitations: InvitationService;
  breakGlass: BreakGlassService;
  emergencyRecipients: EmergencyRecipientsService;
  lifecycle: OrganizationLifecycle;
  auditReader: AuditReader;
  serviceAccounts: ServiceAccountService;
  apiTokens: ApiTokenService;
  notifications: NotificationService;
  identityProviders: IdentityProviderService;
  providerSignIn: ProviderSignInService;
  groupMapping: GroupMappingService;
  mappingRules: MappingRuleService;
  providerSync: ProviderSyncService;
  scim: ScimService;
  scimTokens: ScimTokenService;
  people: PeopleService;
  spaces: SpaceService;
  spacePermissions: SpacePermissionService;
  personalSpaces: PersonalSpaceService;
  tree: TreeService;
  documents: PageDocumentService;
  versions: VersionService;
  trash: TrashService;
  archive: ArchiveService;
  templates: TemplateService;
  activity: ContentActivity;
  comments: CommentService;
  reactions: ReactionService;
  tasks: TaskService;
  blog: BlogService;
  home: HomeService;
  signer: ValueSigner;
  pageAccess: PageAccessService;
  shareLinks: ShareLinkService;
  accessRequests: AccessRequestService;
  accessExplanations: AccessExplanationService;
  giveAccessDrafts: GiveAccessDraftService;
  files: FileService;
  attachments: AttachmentService;
  guestShares: GuestShareService;
  confidentialSpaces: ConfidentialSpaceService;
  meetings: MeetingService;
  topics: TopicService;
  decisions: DecisionService;
  reports: ReportService;
  privateNotes: PrivateNotesService;
  oneOnOnes: OneOnOneService;
  importUploads: UploadService;
  imports: ImportService;
  importWorker: ImportWorker;
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
  importDir?: string;
  fileStore?: FileStore;
  configuredInstanceUrl?: string | undefined;
  passwordHashConcurrency: number;
  insecureIdentityProviders?: boolean;
  directoryConnector?: DirectoryConnector;
  mailTransport?: (options: SmtpOptions) => MailTransport;
  mailFetch?: typeof fetch;
  atlassianFetch?: typeof fetch;
  nodeId?: string;
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
  const instanceAddress = new InstanceAddressService({
    database,
    settings,
    audit,
    configuredUrl: options.configuredInstanceUrl,
  });
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
    allowInsecure: options.insecureIdentityProviders ?? false,
    ...(options.mailTransport ? { transport: options.mailTransport } : {}),
    ...(options.mailFetch ? { fetch: options.mailFetch } : {}),
  });
  const authorization = new AuthorizationService({
    database,
    registry: new AuthorizationRegistry().register(...resourceTypes(settings)),
    audit,
  });
  const organizations = new OrganizationService({ database, settings, audit });
  const memberships = new MembershipService({ database, audit, authorization });
  const overview = new AccountOverviewService({ database, accounts });
  const roles = new RoleService({ database, audit, authorization });
  const groups = new GroupService({ database, audit, authorization });
  const notifications = new NotificationService({
    database,
    settings,
    mail,
    authorization,
    registry: new NotificationRegistry().register(
      ...builtinNotificationTypes,
      ...collaborationNotificationTypes,
      ...sharingNotificationTypes,
      ...meetingNotificationTypes,
      ...importNotificationTypes,
    ),
  });
  mail.useNotifications(notifications);
  const homeOrganizations = new HomeOrganizationService({ database, audit, authorization, notifications });
  const groupMapping = new GroupMappingService({
    roles,
    memberships,
    audit,
    notifications,
    home: homeOrganizations,
  });
  const identityProviders = new IdentityProviderService({
    database,
    audit,
    encryption,
    notifications,
    settings,
    mapping: groupMapping,
    allowInsecure: options.insecureIdentityProviders ?? false,
  });
  const administration = new AccountAdministrationService({
    database,
    authorization,
    audit,
    mail,
    providers: identityProviders,
    mapping: groupMapping,
    settings,
    memberships,
  });
  const accountLifecycle = new AccountLifecycleService({
    database,
    audit,
    authorization,
    memberships,
    encryption,
  });
  const breakGlass = new BreakGlassService({ database, audit, notifications, settings });
  const emergencyRecipients = new EmergencyRecipientsService({ database, settings, authorization });
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
    onIdentityLinked: (tx, link) => groupMapping.applyAtSignIn(tx, link),
  });
  const allowInsecure = options.insecureIdentityProviders ?? false;
  const providerAdapters = [
    new OidcAdapter({ allowInsecure }),
    new SamlAdapter({ allowInsecure }),
    new LdapAdapter({
      allowInsecure,
      ...(options.directoryConnector ? { connector: options.directoryConnector } : {}),
    }),
  ];
  const mappingRules = new MappingRuleService({
    database,
    providers: identityProviders,
    adapters: providerAdapters,
    roles,
    authorization,
    audit,
    mapping: groupMapping,
  });
  const providerSync = new ProviderSyncService({
    database,
    providers: identityProviders,
    adapters: providerAdapters,
    mapping: groupMapping,
    memberships,
    administration,
    audit,
    settings,
    jobs,
    notifications,
  });
  const providerSignIn = new ProviderSignInService({
    database,
    providers: identityProviders,
    adapters: providerAdapters,
    mapping: groupMapping,
    accounts,
    signIn,
    sessions,
    challenges,
    audit,
    notifications,
    settings,
    rateLimiter,
    throttle,
    lifecycle: accountLifecycle,
  });
  const scim = new ScimService({
    database,
    providers: identityProviders,
    accounts,
    organizations,
    mapping: groupMapping,
    memberships,
    administration,
    lifecycle: accountLifecycle,
    audit,
    rateLimiter,
  });
  const scimTokens = new ScimTokenService({ database, audit });
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
  const people = new PeopleService({ database, authorization });
  const spaces = new SpaceService({ database, audit, authorization, settings, people });
  const spacePermissions = new SpacePermissionService({
    database,
    audit,
    spaces,
    holders: new SpaceHolders(people),
    people,
  });
  const personalSpaces = new PersonalSpaceService({ database, audit, authorization, spaces });
  const activity = new ContentActivity({ database, notifications, authorization });
  const documents = new PageDocumentService({
    database,
    authorization,
    people,
    activity,
    origin: options.nodeId ?? uuidv7(),
  });
  const versions = new VersionService({ database, audit, documents, people, settings, activity });
  const trash = new TrashService({ database, audit, settings, people, activity, authorization });
  const archive = new ArchiveService({ database, audit, authorization, activity });
  const signer = new ValueSigner({ database, encryption });
  const tree = new TreeService({
    database,
    authorization,
    documents,
    people,
    versions,
    settings,
    activity,
    signer,
  });
  const templates = new TemplateService({ database, audit, settings, people, tree, documents });
  const reactions = new ReactionService({ database, settings, people });
  const comments = new CommentService({
    database,
    authorization,
    documents,
    people,
    activity,
    reactions,
    audit,
  });
  const tasks = new TaskService({ database, authorization, settings, people });
  const blog = new BlogService({ database, authorization, versions, audit, people, notifications });
  const home = new HomeService({ database, authorization, settings, tasks, blog, people });
  const pageAccess = new PageAccessService({ database, authorization, audit, people, notifications });
  const shareLinks = new ShareLinkService({
    database,
    authorization,
    audit,
    settings,
    hasher,
    rateLimiter,
    people,
    signer,
    encryption,
  });
  const accessRequests = new AccessRequestService({
    database,
    authorization,
    audit,
    people,
    notifications,
    pageAccess,
    spacePermissions,
  });
  const accessExplanations = new AccessExplanationService({ database, authorization, people, audit });
  const giveAccessDrafts = new GiveAccessDraftService({ database });
  const files = new FileService({
    database,
    store: options.fileStore ?? new LocalFileStore(options.filesDir),
    keyRing: options.keyRing,
    logger,
    signer,
  });
  const attachments = new AttachmentService({ database, files, settings, people, audit });
  const guestShares = new GuestShareService({
    database,
    authorization,
    audit,
    settings,
    invitations,
    pageAccess,
    requests: accessRequests,
    notifications,
  });
  pageAccess.onAccessChange((tx, spaceId) => accessRequests.closeSatisfied(tx, spaceId));
  spacePermissions.onAccessChange((tx, spaceId) => accessRequests.closeSatisfied(tx, spaceId));
  memberships.onDeactivated((tx, accountId) => pageAccess.markOrphanedRestrictions(tx, accountId));
  const confidentialSpaces = new ConfidentialSpaceService({ database, audit, notifications });
  memberships.onDeactivated((tx, accountId) => confidentialSpaces.afterDeactivation(tx, accountId));
  memberships.onMembershipEnded((tx, organizationId, accountId) =>
    pageAccess.afterMembershipEnded(tx, organizationId, accountId),
  );
  memberships.onMembershipEnded((tx, organizationId, accountId) =>
    confidentialSpaces.afterMembershipEnded(tx, organizationId, accountId),
  );
  const meetings = new MeetingService({
    database,
    authorization,
    documents,
    templates,
    people,
    notifications,
    activity,
  });
  const topics = new TopicService({ database, authorization, people, documents, meetings });
  const decisions = new DecisionService({ database, authorization });
  const reports = new ReportService({ database, authorization, people });
  const privateNotes = new PrivateNotesService({ database, authorization });
  const oneOnOnes = new OneOnOneService({
    database,
    spaces,
    permissions: spacePermissions,
    holders: spacePermissions.holders,
    meetings,
    people,
    notifications,
  });
  const importUploads = new UploadService({ database, files, settings, authorization });
  const atlassian = new AtlassianDirectory(options.atlassianFetch ? { fetch: options.atlassianFetch } : {});
  const importReaders = new ImportReaderRegistry().register(
    new ConfluenceXmlReader(),
    new ConfluenceCsvReader(),
  );
  const importPipeline = new ImportPipeline({ database, files, settings, audit, versions, trash });
  const imports = new ImportService({
    database,
    authorization,
    audit,
    settings,
    encryption,
    atlassian,
    groups,
    uploads: importUploads,
    jobs,
    importDir: options.importDir ?? "/data/import",
    holders: spacePermissions.holders,
    spacePermissions,
    pageAccess,
    versions,
    pipeline: importPipeline,
    readers: importReaders,
  });
  const importWorker = new ImportWorker({
    database,
    pool: options.pool,
    audit,
    authorization,
    notifications,
    encryption,
    atlassian,
    uploads: importUploads,
    readers: importReaders,
    pipeline: importPipeline,
    folder: imports.folder,
    jobs,
    logger,
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
      configuredInstanceUrl: options.configuredInstanceUrl,
    }),
  );
  return {
    audit,
    instanceAddress,
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
    homeOrganizations,
    administration,
    accountLifecycle,
    overview,
    roles,
    groups,
    invitations,
    breakGlass,
    emergencyRecipients,
    lifecycle,
    auditReader,
    serviceAccounts,
    apiTokens,
    notifications,
    identityProviders,
    providerSignIn,
    groupMapping,
    mappingRules,
    providerSync,
    scim,
    scimTokens,
    people,
    spaces,
    spacePermissions,
    personalSpaces,
    tree,
    documents,
    versions,
    trash,
    archive,
    templates,
    activity,
    comments,
    reactions,
    tasks,
    blog,
    home,
    signer,
    pageAccess,
    shareLinks,
    accessRequests,
    accessExplanations,
    giveAccessDrafts,
    files,
    attachments,
    guestShares,
    confidentialSpaces,
    meetings,
    topics,
    decisions,
    reports,
    privateNotes,
    oneOnOnes,
    importUploads,
    imports,
    importWorker,
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
    const unused = await services.apiTokens.notifyUnused();
    if (expired + reminded + unused > 0) {
      job.logger.info({ expired, reminded, unused }, "API token expiry processed");
    }
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
      providerFlows: await services.providerSignIn.cleanup(),
    };
    job.logger.debug(removed, "Authentication data cleaned up");
  });
  await jobs.work(providerCredentialReminderJob, async (job) => {
    const sent = await services.identityProviders.sendCredentialReminders();
    if (sent > 0) job.logger.info({ sent }, "Provider credential reminders sent");
  });
  await jobs.work(mailCredentialReminderJob, async (job) => {
    const sent = await services.mail.sendCredentialReminders();
    if (sent > 0) job.logger.info({ sent }, "Mail credential reminders sent");
  });
  await jobs.work(samlMetadataRefreshJob, async (job) => {
    const refreshed = await services.identityProviders.refreshDueMetadata();
    if (refreshed > 0) job.logger.info({ refreshed }, "SAML metadata refreshed");
  });
  await jobs.work(providerSyncJob, async (job) => {
    const { providerId, trigger, actorId, confirmedRunId } = job.payload;
    const run = await services.providerSync.run(
      providerId,
      trigger,
      actorId ? { type: "account", id: actorId } : undefined,
      job.signal,
      confirmedRunId,
    );
    if (run) job.logger.info({ providerId, status: run.status }, "Identity provider synchronized");
  });
  await jobs.work(providerSyncScheduleJob, async () => {
    await services.providerSync.scheduleDue();
  });
  await jobs.work(providerSyncRetentionJob, async (job) => {
    const removed = await services.providerSync.applyRetention();
    if (removed > 0) job.logger.info({ removed }, "Old sync runs removed");
  });
  await jobs.work(notificationRetentionJob, async (job) => {
    const removed = await services.notifications.applyRetention();
    if (removed > 0) job.logger.info({ removed }, "Old notifications removed");
  });
  await jobs.work(auditRetentionJob, async (job) => {
    const removed = await applyAuditRetention({ audit: services.audit, settings });
    if (removed > 0) job.logger.info({ removed }, "Old audit events removed");
  });
  await jobs.work(trashRetentionJob, async (job) => {
    const result = await services.trash.applyRetention({ signal: job.signal });
    const drafts = await services.versions.removeExpiredDrafts();
    const files = result.purged > 0 ? await services.files.deleteOrphaned() : 0;
    if (result.moved + result.purged + drafts > 0) {
      job.logger.info({ ...result, drafts, files }, "Trash retention applied");
    }
  });
  await jobs.work(importWorkJob, services.importWorker.work, { concurrency: 2 });
  await jobs.work(importWatchdogJob, async () => {
    await services.importWorker.watchdog();
  });
  await jobs.work(importCleanupJob, async (job) => {
    while ((await services.importUploads.removeExpired()) > 0) job.signal.throwIfAborted();
  });
  await jobs.work(fileCleanupJob, async (job) => {
    let removed = 0;
    for (;;) {
      job.signal.throwIfAborted();
      const batch = await services.files.deleteOrphaned();
      removed += batch;
      if (batch === 0) break;
    }
    if (removed > 0) job.logger.info({ removed }, "Files without attachments removed");
  });
  await jobs.work(liveVersionsJob, async (job) => {
    const created = await services.versions.versionIdlePages();
    if (created > 0) job.logger.info({ created }, "Versions of live pages created");
  });
  await jobs.work(scheduledBlogPostsJob, async (job) => {
    const published = await services.blog.publishDue();
    if (published > 0) job.logger.info({ published }, "Scheduled blog posts published");
  });
  await jobs.work(collaborationCleanupJob, async (job) => {
    const removed = {
      views: await services.home.removeOldViews(),
      commentBodies: await services.comments.removeDeletedBodies(),
    };
    job.logger.debug(removed, "Collaboration data cleaned up");
  });
  await jobs.schedule(scheduledBlogPostsJob, SCHEDULED_BLOG_POSTS_SCHEDULE, {}, { key: "minutely" });
  await jobs.schedule(collaborationCleanupJob, COLLABORATION_CLEANUP_SCHEDULE, {}, { key: "hourly" });
  await jobs.schedule(dispatchPendingMailJob, DISPATCH_PENDING_MAIL_SCHEDULE, {}, { key: "minutely" });
  await jobs.schedule(trashRetentionJob, TRASH_RETENTION_SCHEDULE, {}, { key: "hourly" });
  await jobs.schedule(fileCleanupJob, FILE_CLEANUP_SCHEDULE, {}, { key: "hourly" });
  await jobs.schedule(importWatchdogJob, IMPORT_WATCHDOG_SCHEDULE, {}, { key: "regular" });
  await jobs.schedule(importCleanupJob, IMPORT_CLEANUP_SCHEDULE, {}, { key: "hourly" });
  await jobs.schedule(liveVersionsJob, LIVE_VERSIONS_SCHEDULE, {}, { key: "minutely" });
  await jobs.schedule(authCleanupJob, AUTH_CLEANUP_SCHEDULE, {}, { key: "regular" });
  await jobs.schedule(auditRetentionJob, AUDIT_RETENTION_SCHEDULE, {}, { key: "daily" });
  await jobs.schedule(notificationRetentionJob, NOTIFICATION_RETENTION_SCHEDULE, {}, { key: "daily" });
  await jobs.schedule(organizationExpiryJob, ORGANIZATION_EXPIRY_SCHEDULE, {}, { key: "minutely" });
  await jobs.schedule(apiTokenExpiryJob, API_TOKEN_EXPIRY_SCHEDULE, {}, { key: "regular" });
  await jobs.schedule(organizationRemindersJob, ORGANIZATION_REMINDERS_SCHEDULE, {}, { key: "hourly" });
  await jobs.schedule(providerSyncScheduleJob, PROVIDER_SYNC_SCHEDULE, {}, { key: "regular" });
  await jobs.schedule(providerSyncRetentionJob, PROVIDER_SYNC_RETENTION_SCHEDULE, {}, { key: "daily" });
  await jobs.schedule(samlMetadataRefreshJob, SAML_METADATA_REFRESH_SCHEDULE, {}, { key: "hourly" });
  await jobs.schedule(mailCredentialReminderJob, MAIL_CREDENTIAL_REMINDER_SCHEDULE, {}, { key: "hourly" });
  await jobs.schedule(
    providerCredentialReminderJob,
    PROVIDER_CREDENTIAL_REMINDER_SCHEDULE,
    {},
    { key: "hourly" },
  );
}
