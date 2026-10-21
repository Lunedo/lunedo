import { uuidv7 } from "@pagehall/shared";
import { AccountService } from "./accounts/accounts.js";
import { AccountAdministrationService } from "./accounts/administration.js";
import { InstanceAddressService } from "./accounts/instance-address.js";
import { AccountLifecycleService } from "./accounts/lifecycle.js";
import { AccountOverviewService } from "./accounts/overview.js";
import { accountPrincipal } from "./accounts/principal.js";
import {
  ANNOUNCEMENT_STARTS_SCHEDULE,
  AnnouncementService,
  announcementStartsJob,
} from "./announcements/announcements.js";
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
import { AccessReductions } from "./authorization/access-reductions.js";
import { AuthorizationRegistry } from "./authorization/registry.js";
import { resourceTypes } from "./authorization/resources.js";
import { AuthorizationService } from "./authorization/service.js";
import { ChatChannelService } from "./chat/channels.js";
import { chatNotificationTypes } from "./chat/notifications.js";
import { organizationAdministrators } from "./chat/recipients.js";
import { BlogService } from "./collaboration/blog.js";
import { BlogSubscriptionService } from "./collaboration/blog-subscriptions.js";
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
import { CopyService } from "./copies/copies.js";
import { COPY_WATCHDOG_SCHEDULE, copyItemsJob, copyWatchdogJob } from "./copies/jobs.js";
import { copyNotificationTypes } from "./copies/notifications.js";
import type { Encryption } from "./crypto/envelope.js";
import type { KeyRing } from "./crypto/key-ring.js";
import type { KeyRingHolder } from "./crypto/key-ring-holder.js";
import type { KeyRotation } from "./crypto/rotation.js";
import type { Database } from "./database/database.js";
import type { DatabasePool } from "./database/pool.js";
import { DiagramService } from "./diagrams/diagrams.js";
import { EmbedServices } from "./embeds/embeds.js";
import { ExportService } from "./exports/exports.js";
import {
  EXPORT_CLEANUP_SCHEDULE,
  EXPORT_WATCHDOG_SCHEDULE,
  exportBuildJob,
  exportCleanupJob,
  exportWatchdogJob,
} from "./exports/jobs.js";
import { exportNotificationTypes } from "./exports/notifications.js";
import { type RenderConnection, RenderService } from "./exports/rendering.js";
import { AttachmentService } from "./files/attachments.js";
import { DisplayVersionService } from "./files/display-versions.js";
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
import { type ConfluenceTransport, guardedTransport } from "./imports/confluence/api-client.js";
import { ConfluenceApiReader } from "./imports/confluence/api-reader.js";
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
import { MarkdownReader } from "./imports/markdown/reader.js";
import { importNotificationTypes } from "./imports/notifications.js";
import { ImportPipeline } from "./imports/pipeline.js";
import { ImportReaderRegistry } from "./imports/source.js";
import { UploadService } from "./imports/uploads.js";
import { WordReader } from "./imports/word/reader.js";
import { ImportWorker } from "./imports/worker.js";
import type { JobQueue } from "./jobs/job-queue.js";
import { ArticleApiService } from "./knowledge-bases/article-api.js";
import { knowledgeBaseNotificationTypes } from "./knowledge-bases/notifications.js";
import { PortalAccountService } from "./knowledge-bases/portal-accounts.js";
import { ReviewService } from "./knowledge-bases/reviews.js";
import { KnowledgeBaseService } from "./knowledge-bases/service.js";
import { KnowledgeBaseStatisticsService } from "./knowledge-bases/statistics.js";
import { ArticleTranslationService } from "./knowledge-bases/translations.js";
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
import { MEETING_REMINDERS_SCHEDULE, MeetingReminders, meetingRemindersJob } from "./meetings/reminders.js";
import { TopicService } from "./meetings/topics.js";
import {
  NOTIFICATION_EMAIL_SCHEDULE,
  NotificationMailer,
  notificationEmailJob,
} from "./notifications/email.js";
import { NotificationRegistry } from "./notifications/registry.js";
import { NOTIFICATION_RETENTION_SCHEDULE, notificationRetentionJob } from "./notifications/retention.js";
import { NotificationService } from "./notifications/service.js";
import { builtinNotificationTypes } from "./notifications/types.js";
import { UnsubscribeService } from "./notifications/unsubscribe.js";
import { WatchService } from "./notifications/watches.js";
import { type BackupStatusSource, commandOnlyBackups } from "./operations/backup-status.js";
import { removeOldErrorEvents } from "./operations/error-events.js";
import { REMOVE_OLD_ERROR_EVENTS_SCHEDULE, removeOldErrorEventsJob } from "./operations/jobs.js";
import { MaintenanceService, SignInBlockedError } from "./operations/maintenance.js";
import { type CollaborationProbe, OperationsStatusService } from "./operations/status.js";
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
import { type OutboundPolicy, outboundPolicy } from "./outbound/guarded-request.js";
import { ArticleRenderer, renderArticleJob } from "./portal/articles.js";
import { PortalService } from "./portal/portals.js";
import { PortalReader } from "./portal/reader.js";
import { PortalSessionService } from "./portal/sessions.js";
import { StaticSiteBuilder } from "./portal/site/static-site.js";
import {
  FEEDBACK_SWEEP_SCHEDULE,
  feedbackDeletionJob,
  feedbackRetentionJob,
  PortalStatistics,
  SEARCH_AGGREGATION_SCHEDULE,
  searchAggregationJob,
} from "./portal/statistics.js";
import { PushService } from "./push/push-service.js";
import { SearchIndexer } from "./search/indexer.js";
import { PostgresSearchAdapter } from "./search/postgres-adapter.js";
import { SavedSearchService } from "./search/saved-searches.js";
import { SearchService } from "./search/service.js";
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
import { IncludeService } from "./spaces/includes.js";
import { TreeService } from "./spaces/items.js";
import {
  applyTrashRetention,
  LIVE_VERSIONS_SCHEDULE,
  liveVersionsJob,
  TRASH_RETENTION_SCHEDULE,
  trashRetentionJob,
} from "./spaces/jobs.js";
import { spaceNotificationTypes } from "./spaces/notifications.js";
import { OwnershipService } from "./spaces/ownership.js";
import { PeopleService } from "./spaces/people.js";
import { SpaceHolders, SpacePermissionService } from "./spaces/permissions.js";
import { PersonalSpaceService } from "./spaces/personal.js";
import { ReportService } from "./spaces/reports.js";
import { ShortcutService } from "./spaces/shortcuts.js";
import { SpaceService } from "./spaces/spaces.js";
import { PageStatusService } from "./spaces/status.js";
import { TrashService } from "./spaces/trash.js";
import { VersionService } from "./spaces/versions.js";
import {
  STORAGE_CHECK_SCHEDULE,
  STORAGE_RECONCILE_SCHEDULE,
  storageCheckJob,
  storageReconcileJob,
} from "./storage/jobs.js";
import { storageNotificationTypes } from "./storage/notifications.js";
import { StorageService } from "./storage/storage.js";
import { StorageUsage } from "./storage/usage.js";
import { TemplateFileService } from "./templates/files.js";
import { adoptTemplateFilesJob } from "./templates/jobs.js";
import { TemplateService } from "./templates/templates.js";
import { TemplateTransferService } from "./templates/transfer.js";
import { API_TOKEN_EXPIRY_SCHEDULE, ApiTokenService, apiTokenExpiryJob } from "./tokens/api-tokens.js";
import { ServiceAccountService } from "./tokens/service-accounts.js";
import { DrawingService } from "./whiteboards/drawings.js";
import { WhiteboardService } from "./whiteboards/whiteboards.js";

export interface AccountServices {
  push: PushService;
  chatChannels: ChatChannelService;
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
  notificationMailer: NotificationMailer;
  unsubscribe: UnsubscribeService;
  watches: WatchService;
  identityProviders: IdentityProviderService;
  providerSignIn: ProviderSignInService;
  groupMapping: GroupMappingService;
  mappingRules: MappingRuleService;
  providerSync: ProviderSyncService;
  scim: ScimService;
  scimTokens: ScimTokenService;
  people: PeopleService;
  search: SearchService;
  savedSearches: SavedSearchService;
  spaces: SpaceService;
  spacePermissions: SpacePermissionService;
  personalSpaces: PersonalSpaceService;
  tree: TreeService;
  ownership: OwnershipService;
  pageStatus: PageStatusService;
  shortcuts: ShortcutService;
  announcements: AnnouncementService;
  documents: PageDocumentService;
  versions: VersionService;
  whiteboards: WhiteboardService;
  drawings: DrawingService;
  diagrams: DiagramService;
  trash: TrashService;
  archive: ArchiveService;
  templates: TemplateService;
  knowledgeBases: KnowledgeBaseService;
  translations: ArticleTranslationService;
  articleApi: ArticleApiService;
  portalAccounts: PortalAccountService;
  reviews: ReviewService;
  knowledgeBaseStatistics: KnowledgeBaseStatisticsService;
  portals: PortalService;
  portalSessions: PortalSessionService;
  portalReader: PortalReader;
  portalStatistics: PortalStatistics;
  articleRenderer: ArticleRenderer;
  templateTransfers: TemplateTransferService;
  activity: ContentActivity;
  comments: CommentService;
  reactions: ReactionService;
  tasks: TaskService;
  blog: BlogService;
  blogSubscriptions: BlogSubscriptionService;
  home: HomeService;
  signer: ValueSigner;
  pageAccess: PageAccessService;
  shareLinks: ShareLinkService;
  accessRequests: AccessRequestService;
  accessExplanations: AccessExplanationService;
  giveAccessDrafts: GiveAccessDraftService;
  files: FileService;
  displayVersions: DisplayVersionService;
  storage: StorageService;
  attachments: AttachmentService;
  guestShares: GuestShareService;
  confidentialSpaces: ConfidentialSpaceService;
  meetings: MeetingService;
  meetingReminders: MeetingReminders;
  topics: TopicService;
  decisions: DecisionService;
  reports: ReportService;
  includes: IncludeService;
  embeds: EmbedServices;
  privateNotes: PrivateNotesService;
  oneOnOnes: OneOnOneService;
  importUploads: UploadService;
  imports: ImportService;
  importWorker: ImportWorker;
  exports: ExportService;
  copies: CopyService;
  rendering: RenderService;
  operations: OperationsStatusService;
  maintenance: MaintenanceService;
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
  confluenceTransport?: ConfluenceTransport;
  outboundAllowedNetworks?: readonly string[];
  render?: RenderConnection;
  renderFetch?: typeof fetch;
  chatPolicy?: OutboundPolicy;
  pushPolicy?: OutboundPolicy;
  nodeId?: string;
  keyRotation?: KeyRotation | undefined;
  keyProvider?: "env" | "file";
  backups?: BackupStatusSource;
  collaborationProbe?: CollaborationProbe;
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
  const accessReductions = new AccessReductions();
  const roles = new RoleService({ database, audit, authorization, reductions: accessReductions });
  const groups = new GroupService({ database, audit, authorization, reductions: accessReductions });
  const signer = new ValueSigner({ database, encryption });
  const unsubscribe = new UnsubscribeService({ database, settings, signer });
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
      ...spaceNotificationTypes,
      ...exportNotificationTypes,
      ...copyNotificationTypes,
      ...chatNotificationTypes,
      ...storageNotificationTypes,
      ...knowledgeBaseNotificationTypes,
    ),
    unsubscribe,
  });
  mail.useNotifications(notifications);
  const homeOrganizations = new HomeOrganizationService({ database, audit, authorization, notifications });
  const groupMapping = new GroupMappingService({
    roles,
    memberships,
    audit,
    notifications,
    home: homeOrganizations,
    reductions: accessReductions,
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
    reductions: accessReductions,
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
  const maintenance = new MaintenanceService({ database, audit });
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
    beforeSession: async (executor, accountId) => {
      const status = await maintenance.status();
      if (!status.blockSignIn) return;
      const administrator = await authorization.authorize(
        accountPrincipal(accountId),
        "instance.operations.manage",
        { type: "instance" },
        { executor },
      );
      if (!administrator) throw new SignInBlockedError(status);
    },
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
  const savedSearches = new SavedSearchService({ database });
  const spaces = new SpaceService({ database, audit, authorization, settings, people });
  const spacePermissions = new SpacePermissionService({
    database,
    audit,
    spaces,
    holders: new SpaceHolders(people),
    people,
  });
  const personalSpaces = new PersonalSpaceService({ database, audit, authorization, spaces });
  const watches = new WatchService({ database, authorization, settings });
  const activity = new ContentActivity({ database, notifications, authorization, watches });
  const documents = new PageDocumentService({
    database,
    authorization,
    people,
    activity,
    origin: options.nodeId ?? uuidv7(),
  });
  const versions = new VersionService({ database, audit, documents, people, settings, activity });
  const trash = new TrashService({ database, audit, settings, people, activity, authorization, logger });
  const archive = new ArchiveService({ database, audit, authorization, activity, trash });
  const notificationMailer = new NotificationMailer({
    database,
    settings,
    mail,
    notifications,
    authorization,
    unsubscribe,
  });
  const ownership = new OwnershipService({
    database,
    authorization,
    people,
    audit,
    notifications,
    activity,
    administrators: (executor, spaceId) => pageAccess.spaceAdministrators(executor, spaceId),
  });
  const pageStatus = new PageStatusService({ database, authorization, settings, people, audit, activity });
  const shortcuts = new ShortcutService({ database, authorization, audit });
  const announcements = new AnnouncementService({ database, authorization, audit, people });
  const tree = new TreeService({
    database,
    authorization,
    documents,
    people,
    versions,
    settings,
    activity,
    signer,
    ownership,
  });
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
  const blog = new BlogService({ database, authorization, versions, audit, people, notifications, activity });
  const blogSubscriptions = new BlogSubscriptionService({ database, authorization, notifications });
  const home = new HomeService({ database, authorization, settings, tasks, blog, people });
  const pageAccess = new PageAccessService({ database, authorization, audit, people, notifications });
  const chatChannels = new ChatChannelService({
    database,
    encryption,
    settings,
    notifications,
    audit,
    logger,
    policy: options.chatPolicy ?? outboundPolicy(options.outboundAllowedNetworks ?? []),
    recipients: {
      space: (executor, spaceId) => pageAccess.spaceAdministrators(executor, spaceId),
      organization: (executor, organizationId) => organizationAdministrators(executor, organizationId),
    },
  });
  activity.useChat(chatChannels);
  announcements.useChat(chatChannels);
  const push = new PushService({
    database,
    encryption,
    settings,
    notifications,
    mail,
    sessions,
    logger,
    policy: options.pushPolicy ?? outboundPolicy([]),
  });
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
  const storageUsage = new StorageUsage({ database });
  const files = new FileService({
    database,
    store: options.fileStore ?? new LocalFileStore(options.filesDir),
    keyRing: options.keyRing,
    logger,
    signer,
    usage: storageUsage,
  });
  const displayVersions = new DisplayVersionService({ database, files, logger });
  const storage = new StorageService({
    database,
    store: files.store,
    usage: storageUsage,
    settings,
    notifications,
    mail,
    chat: chatChannels,
    encryption,
    audit,
    jobs,
    logger,
  });
  const attachments = new AttachmentService({ database, files, settings, people, audit, storage });
  const templates = new TemplateService({
    database,
    audit,
    settings,
    people,
    tree,
    documents,
    files: new TemplateFileService({ database, files, storage }),
    authorization,
    storage,
  });
  const reviews = new ReviewService({
    database,
    authorization,
    audit,
    people,
    notifications,
    administrators: (executor, spaceId) => pageAccess.spaceAdministrators(executor, spaceId),
  });
  activity.useReviews(reviews);
  versions.useReviews(reviews);
  const knowledgeBases = new KnowledgeBaseService({
    database,
    audit,
    authorization,
    spaces,
    permissions: spacePermissions,
    people,
    templates,
  });
  const translations = new ArticleTranslationService({ database, authorization, audit, spaces, tree });
  const portalAccounts = new PortalAccountService({ database, audit, spaces, invitations, memberships });
  const whiteboards = new WhiteboardService({
    database,
    files,
    storage,
    people,
    settings,
    activity,
    audit,
    origin: documents.origin,
  });
  const drawings = new DrawingService({ database, attachments });
  const diagrams = new DiagramService({ database, attachments });
  const searchAdapter = new PostgresSearchAdapter();
  const search = new SearchService({
    database,
    authorization,
    people,
    adapter: searchAdapter,
    indexer: new SearchIndexer({ database, adapter: searchAdapter, files }),
  });
  const portals = new PortalService({ database, audit, settings });
  const portalSessions = new PortalSessionService({ database, sessions, audit });
  const embeds = new EmbedServices({ settings });
  const articleRenderer = new ArticleRenderer({ database, authorization, jobs, embeds });
  const articleApi = new ArticleApiService({
    database,
    authorization,
    knowledgeBases,
    tree,
    documents,
    versions,
    attachments,
    renderer: articleRenderer,
    portals,
  });
  const portalStatistics = new PortalStatistics({ database, jobs });
  const knowledgeBaseStatistics = new KnowledgeBaseStatisticsService({
    database,
    authorization,
    audit,
    statistics: portalStatistics,
  });
  const portalReader = new PortalReader({
    database,
    authorization,
    search,
    renderer: articleRenderer,
    statistics: portalStatistics,
  });
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
  memberships.onDeactivated((tx, accountId) => ownership.afterDeactivation(tx, accountId));
  memberships.onMembershipEnded((tx, organizationId, accountId) =>
    ownership.afterMembershipEnded(tx, organizationId, accountId),
  );
  memberships.onMembershipEnded((tx, organizationId, accountId) =>
    pageAccess.afterMembershipEnded(tx, organizationId, accountId),
  );
  memberships.onMembershipEnded((tx, organizationId, accountId) =>
    confidentialSpaces.afterMembershipEnded(tx, organizationId, accountId),
  );
  memberships.onMembershipEnded((tx, organizationId, accountId) =>
    savedSearches.afterMembershipEnded(tx, organizationId, accountId),
  );
  memberships.onMembershipEnded((tx, organizationId, accountId) =>
    portalAccounts.afterMembershipEnded(tx, organizationId, accountId),
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
  const meetingReminders = new MeetingReminders({ database, authorization, notifications });
  const topics = new TopicService({ database, authorization, people, documents, meetings, activity });
  const decisions = new DecisionService({ database, authorization });
  const reports = new ReportService({ database, authorization, people, documents });
  const includes = new IncludeService({ database, authorization, documents });
  const templateTransfers = new TemplateTransferService({
    database,
    templates,
    storage,
    embeds,
    audit,
    instanceUrl: async () => (await instanceAddress.get()).url,
  });
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
  const importUploads = new UploadService({ database, files, settings, authorization, storage });
  const atlassian = new AtlassianDirectory(options.atlassianFetch ? { fetch: options.atlassianFetch } : {});
  const confluenceTransport =
    options.confluenceTransport ?? guardedTransport(outboundPolicy(options.outboundAllowedNetworks ?? []));
  const importReaders = new ImportReaderRegistry().register(
    new ConfluenceXmlReader(),
    new ConfluenceCsvReader(),
    new ConfluenceApiReader("confluence-cloud", { database, encryption, transport: confluenceTransport }),
    new ConfluenceApiReader("confluence-dc", { database, encryption, transport: confluenceTransport }),
    new MarkdownReader(),
    new WordReader(),
  );
  const importPipeline = new ImportPipeline({
    database,
    files,
    settings,
    audit,
    versions,
    trash,
    templateFiles: templates.files,
  });
  const imports = new ImportService({
    database,
    authorization,
    audit,
    settings,
    encryption,
    atlassian,
    groups,
    uploads: importUploads,
    storage,
    jobs,
    importDir: options.importDir ?? "/data/import",
    holders: spacePermissions.holders,
    spacePermissions,
    pageAccess,
    versions,
    pipeline: importPipeline,
    readers: importReaders,
  });
  accessReductions.on((tx, reduction) => imports.afterAccessReduced(tx, reduction));
  memberships.onMembershipEnded((tx, organizationId, accountId) =>
    accessReductions.reduced(tx, { organizationId, accountId }),
  );
  memberships.onDeactivated((tx, accountId) =>
    accessReductions.reduced(tx, { organizationId: null, accountId }),
  );
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
  const render = new RenderService({
    connection: options.render,
    logger,
    ...(options.renderFetch ? { fetch: options.renderFetch } : {}),
  });
  const exports = new ExportService({
    database,
    pool: options.pool,
    authorization,
    audit,
    notifications,
    settings,
    mail,
    files,
    displayVersions,
    storage,
    documents,
    attachments,
    reports,
    includes,
    tasks,
    people,
    address: instanceAddress,
    comments,
    render,
    jobs,
    logger,
    site: new StaticSiteBuilder({
      database,
      portals,
      reader: portalReader,
      renderer: articleRenderer,
      attachments,
      displayVersions,
      files,
      organizations,
    }),
  });
  const copies = new CopyService({
    database,
    authorization,
    people,
    activity,
    signer,
    storage,
    files,
    audit,
    notifications,
    language: (accountId) => mail.languageOf(accountId),
    jobs,
  });
  memberships.onDeactivated((tx, accountId) => exports.afterDeactivation(tx, accountId));
  memberships.onMembershipEnded((tx, organizationId, accountId) =>
    exports.afterMembershipEnded(tx, organizationId, accountId),
  );
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
  const operations = new OperationsStatusService({
    database,
    pool: options.pool,
    settings,
    storage,
    mail,
    indexer: search.indexer,
    keyRing: options.keyRing,
    keyRotation: options.keyRotation,
    jobs,
    backups: options.backups ?? commandOnlyBackups,
    maintenance,
    collaboration: options.collaborationProbe,
    filesDir: options.filesDir,
    fileStore: files.store.kind,
    keyProvider: options.keyProvider ?? "file",
    configuredInstanceUrl: options.configuredInstanceUrl,
  });
  return {
    operations,
    maintenance,
    push,
    chatChannels,
    watches,
    notificationMailer,
    unsubscribe,
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
    search,
    savedSearches,
    spaces,
    spacePermissions,
    personalSpaces,
    tree,
    ownership,
    pageStatus,
    shortcuts,
    announcements,
    documents,
    versions,
    trash,
    archive,
    templates,
    knowledgeBases,
    translations,
    articleApi,
    portalAccounts,
    reviews,
    knowledgeBaseStatistics,
    portals,
    portalSessions,
    portalReader,
    portalStatistics,
    articleRenderer,
    templateTransfers,
    activity,
    comments,
    reactions,
    tasks,
    blog,
    blogSubscriptions,
    home,
    signer,
    pageAccess,
    shareLinks,
    accessRequests,
    accessExplanations,
    giveAccessDrafts,
    files,
    displayVersions,
    storage,
    attachments,
    whiteboards,
    drawings,
    diagrams,
    guestShares,
    confidentialSpaces,
    meetings,
    meetingReminders,
    topics,
    decisions,
    reports,
    includes,
    embeds,
    privateNotes,
    oneOnOnes,
    importUploads,
    imports,
    importWorker,
    exports,
    copies,
    rendering: render,
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
      portalHandoffs: await services.portalSessions.cleanup(),
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
  await jobs.work(trashRetentionJob, (job) => applyTrashRetention(services, job));
  await jobs.work(importWorkJob, services.importWorker.work, { concurrency: 2 });
  await jobs.work(importWatchdogJob, async () => {
    await services.importWorker.watchdog();
  });
  await jobs.work(importCleanupJob, async (job) => {
    while ((await services.importUploads.removeExpired()) > 0) job.signal.throwIfAborted();
    while ((await services.imports.removeAbandonedCredentials()) > 0) job.signal.throwIfAborted();
  });
  await jobs.work(exportBuildJob, services.exports.work, { concurrency: 2 });
  await jobs.work(copyItemsJob, services.copies.work, { concurrency: 2 });
  await jobs.work(adoptTemplateFilesJob, (job) => services.templates.adoptPendingFiles(job.logger));
  if (await services.templates.hasPendingFiles()) {
    await jobs.enqueue(adoptTemplateFilesJob, {}, { idempotencyKey: "pending" });
  }
  await jobs.work(copyWatchdogJob, async () => {
    await services.copies.watchdog();
  });
  await jobs.work(exportWatchdogJob, async () => {
    await services.exports.watchdog();
  });
  await jobs.work(exportCleanupJob, async (job) => {
    let removed = 0;
    for (;;) {
      job.signal.throwIfAborted();
      const batch = await services.exports.removeExpired();
      removed += batch;
      if (batch === 0) break;
    }
    if (removed > 0) job.logger.info({ removed }, "Expired exports removed");
  });
  await jobs.work(removeOldErrorEventsJob, async (job) => {
    job.logger.debug(
      { removed: await removeOldErrorEvents(services.operations.database) },
      "Old error counts removed",
    );
  });
  await jobs.work(storageCheckJob, async () => {
    await services.storage.check();
  });
  await jobs.work(storageReconcileJob, async () => {
    await services.storage.reconcile();
  });
  await jobs.work(fileCleanupJob, async (job) => {
    await services.templateTransfers.cleanup();
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
    const boards = await services.whiteboards.versionIdleBoards();
    if (boards > 0) job.logger.info({ created: boards }, "Versions of whiteboards created");
  });
  await jobs.work(scheduledBlogPostsJob, async (job) => {
    const published = await services.blog.publishDue();
    if (published > 0) job.logger.info({ published }, "Scheduled blog posts published");
  });
  await jobs.work(announcementStartsJob, async () => {
    await services.announcements.signalStarted();
  });
  await jobs.work(meetingRemindersJob, async (job) => {
    const sent = await services.meetingReminders.sendDue();
    if (sent > 0) job.logger.info({ sent }, "Meeting reminders sent");
  });
  await jobs.work(notificationEmailJob, async (job) => {
    const sent = await services.notificationMailer.sendDue();
    if (sent.immediate + sent.digests > 0) job.logger.info(sent, "Notification e-mails queued");
  });
  await jobs.work(collaborationCleanupJob, async (job) => {
    const removed = {
      views: await services.home.removeOldViews(),
      commentBodies: await services.comments.removeDeletedBodies(),
      chatDeliveries: await services.chatChannels.removeOldDeliveries(),
    };
    job.logger.debug(removed, "Collaboration data cleaned up");
  });
  await jobs.work(renderArticleJob, async (job) => {
    await services.articleRenderer.renderPublished(job.payload.itemId);
  });
  await jobs.work(feedbackDeletionJob, async (job) => {
    const outcome = await services.portalStatistics.deleteFeedbackWhenDue(job.payload.feedbackId);
    job.logger.debug({ outcome }, "Reader feedback retention checked");
  });
  await jobs.work(feedbackRetentionJob, async (job) => {
    const removed = await services.portalStatistics.applyRetention(job.payload.spaceId);
    if (removed > 0) job.logger.info({ removed }, "Reader feedback past its retention deleted");
  });
  await jobs.work(searchAggregationJob, async (job) => {
    const moved = await services.portalStatistics.aggregateSearches(job.payload.spaceId);
    if (moved > 0) job.logger.info({ moved }, "Portal searches older than a year counted per month");
  });
  await jobs.schedule(feedbackRetentionJob, FEEDBACK_SWEEP_SCHEDULE, {}, { key: "daily" });
  await jobs.schedule(searchAggregationJob, SEARCH_AGGREGATION_SCHEDULE, {}, { key: "daily" });
  await jobs.schedule(scheduledBlogPostsJob, SCHEDULED_BLOG_POSTS_SCHEDULE, {}, { key: "minutely" });
  await jobs.schedule(meetingRemindersJob, MEETING_REMINDERS_SCHEDULE, {}, { key: "minutely" });
  await jobs.schedule(announcementStartsJob, ANNOUNCEMENT_STARTS_SCHEDULE, {}, { key: "minutely" });
  await jobs.schedule(notificationEmailJob, NOTIFICATION_EMAIL_SCHEDULE, {}, { key: "minutely" });
  await jobs.schedule(collaborationCleanupJob, COLLABORATION_CLEANUP_SCHEDULE, {}, { key: "hourly" });
  await jobs.schedule(dispatchPendingMailJob, DISPATCH_PENDING_MAIL_SCHEDULE, {}, { key: "minutely" });
  await jobs.schedule(trashRetentionJob, TRASH_RETENTION_SCHEDULE, {}, { key: "hourly" });
  await jobs.schedule(fileCleanupJob, FILE_CLEANUP_SCHEDULE, {}, { key: "hourly" });
  await jobs.schedule(removeOldErrorEventsJob, REMOVE_OLD_ERROR_EVENTS_SCHEDULE, {}, { key: "daily" });
  await jobs.schedule(storageCheckJob, STORAGE_CHECK_SCHEDULE, {}, { key: "minutely" });
  await jobs.schedule(storageReconcileJob, STORAGE_RECONCILE_SCHEDULE, {}, { key: "daily" });
  await jobs.schedule(importWatchdogJob, IMPORT_WATCHDOG_SCHEDULE, {}, { key: "regular" });
  await jobs.schedule(importCleanupJob, IMPORT_CLEANUP_SCHEDULE, {}, { key: "hourly" });
  await jobs.schedule(exportWatchdogJob, EXPORT_WATCHDOG_SCHEDULE, {}, { key: "regular" });
  await jobs.schedule(copyWatchdogJob, COPY_WATCHDOG_SCHEDULE, {}, { key: "regular" });
  await jobs.schedule(exportCleanupJob, EXPORT_CLEANUP_SCHEDULE, {}, { key: "hourly" });
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
