import { idSchema } from "@lunedo/shared";
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  type RouteComponent,
  redirect,
} from "@tanstack/react-router";
import { z } from "zod";
import { securityQuery, sessionsQuery } from "./api/account-queries.js";
import {
  breakGlassQuery,
  instanceOrganizationsQuery,
  instanceRolesQuery,
  instanceSettingsQuery,
  mailQuery,
  operationsStatusQuery,
  renderingQuery,
  storageQuery,
} from "./api/instance-queries.js";
import {
  domainsQuery,
  membersQuery,
  organizationQuery,
  organizationSettingsQuery,
  organizationTokensQuery,
  rolesQuery,
  serviceAccountsQuery,
} from "./api/organization-queries.js";
import { instanceInfoQuery, sessionQuery } from "./api/queries.js";
import { openForUpdate } from "./app-update/app-update.js";
import { BlogPostScreen } from "./collaboration/blog/blog-post-screen.js";
import { OrganizationBlogScreen } from "./collaboration/blog/organization-blog-screen.js";
import { SpaceBlogScreen } from "./collaboration/blog/space-blog-screen.js";
import { HomeScreen } from "./collaboration/home-screen.js";
import { Landing } from "./collaboration/landing.js";
import { MyTasksScreen, myTasksQuery } from "./collaboration/my-tasks-screen.js";
import { blogPostQuery, homeQuery, taskStatusesQuery, tasksQuery } from "./collaboration/queries.js";
import {
  AppNotFoundScreen,
  NotFoundScreen,
  RouteErrorScreen,
  ScreenErrorScreen,
} from "./errors/route-error.js";
import { ExportsScreen } from "./exports/exports-screen.js";
import { PrintScreen } from "./exports/print-screen.js";
import { printRouteSearch } from "./exports/print-search.js";
import { ConfluenceRedirectScreen } from "./imports/confluence-link.js";
import { ImportsScreen } from "./imports/imports-screen.js";
import { isKnowledgeBase } from "./knowledge-bases/queries.js";
import { ReviewScreen } from "./knowledge-bases/reviews/review-screen.js";
import { reviewSearch } from "./knowledge-bases/reviews/review-search.js";
import { ReviewSettingsScreen } from "./knowledge-bases/reviews/review-settings-screen.js";
import { PortalAddressScreen } from "./knowledge-bases/settings/address-screen.js";
import { PortalAppearanceScreen } from "./knowledge-bases/settings/appearance-screen.js";
import { CategoriesScreen } from "./knowledge-bases/settings/categories-screen.js";
import { LanguagesScreen } from "./knowledge-bases/settings/languages-screen.js";
import { PortalAccountsScreen } from "./knowledge-bases/settings/portal-accounts-screen.js";
import { KnowledgeBaseVisibilityScreen } from "./knowledge-bases/settings/visibility-screen.js";
import { StatisticsScreen } from "./knowledge-bases/statistics/statistics-screen.js";
import { statisticsSearch } from "./knowledge-bases/statistics/statistics-search.js";
import { seriesQuery, spaceSeriesQuery, topicQuery } from "./meetings/queries.js";
import { SeriesListScreen } from "./meetings/series-list-screen.js";
import { SeriesScreen } from "./meetings/series-screen.js";
import { TopicScreen } from "./meetings/topic-screen.js";
import { NotificationsScreen } from "./notifications/notification-panel.js";
import { notificationListQuery } from "./notifications/notifications-api.js";
import { OpenNotificationScreen } from "./notifications/open-notification-screen.js";
import { UnsubscribeScreen } from "./notifications/unsubscribe-screen.js";
import { RootLayout } from "./root-layout.js";
import { loadShell, settle } from "./route-data.js";
import { NotificationPreferencesScreen } from "./screens/account/notification-preferences-screen.js";
import { PreferencesScreen } from "./screens/account/preferences-screen.js";
import { ProfileScreen } from "./screens/account/profile-screen.js";
import { SecurityScreen } from "./screens/account/security-screen.js";
import { WatchedItemsScreen } from "./screens/account/watched-items-screen.js";
import { AcceptInvitationScreen } from "./screens/auth/accept-invitation-screen.js";
import { AuthLayout } from "./screens/auth/auth-layout.js";
import { CompleteRegistrationScreen } from "./screens/auth/complete-registration-screen.js";
import { ConfirmEmailScreen } from "./screens/auth/confirm-email-screen.js";
import { LinkAccountScreen } from "./screens/auth/link-account-screen.js";
import { RegisterScreen } from "./screens/auth/register-screen.js";
import { ResetPasswordScreen } from "./screens/auth/reset-password-screen.js";
import { SecondFactorScreen } from "./screens/auth/second-factor-screen.js";
import { SecondFactorSetupScreen } from "./screens/auth/second-factor-setup-screen.js";
import { SignInRefusedScreen } from "./screens/auth/sign-in-refused-screen.js";
import { SignInScreen } from "./screens/auth/sign-in-screen.js";
import { InstanceProviderScreen } from "./screens/identity/provider-screen.js";
import { InstanceProviderWizardScreen } from "./screens/identity/provider-wizard-screen.js";
import { InstanceProvidersScreen } from "./screens/identity/providers-screen.js";
import { InstanceAccountScreen, InstanceAccountsScreen } from "./screens/instance/accounts-screen.js";
import { InstanceAnnouncementsScreen } from "./screens/instance/announcements-screen.js";
import { InstanceAuditScreen } from "./screens/instance/audit-screen.js";
import { InstanceBackupsScreen } from "./screens/instance/backups-screen.js";
import { BreakGlassScreen } from "./screens/instance/break-glass-screen.js";
import { InstanceEmbedsScreen } from "./screens/instance/embeds-screen.js";
import { InstanceGeneralScreen } from "./screens/instance/general-screen.js";
import { InstanceMailScreen } from "./screens/instance/mail-screen.js";
import { InstanceMaintenanceScreen } from "./screens/instance/maintenance-screen.js";
import { InstanceOrganizationsScreen } from "./screens/instance/organizations-screen.js";
import { InstancePortalsScreen } from "./screens/instance/portals-screen.js";
import { InstanceRenderingScreen } from "./screens/instance/rendering-screen.js";
import { InstanceRolesScreen } from "./screens/instance/roles-screen.js";
import { InstanceSecurityScreen } from "./screens/instance/security-screen.js";
import { InstanceStatusScreen } from "./screens/instance/status-screen.js";
import { InstanceStorageScreen } from "./screens/instance/storage-screen.js";
import { InstanceUpdatesScreen, updatesQuery } from "./screens/instance/updates-screen.js";
import { AccessOverviewScreen } from "./screens/organization/access-overview-screen.js";
import { OrganizationAnnouncementsScreen } from "./screens/organization/announcements-screen.js";
import { OrganizationTokensScreen } from "./screens/organization/api-tokens-screen.js";
import { OrganizationAuditScreen } from "./screens/organization/audit-screen.js";
import { DomainsScreen } from "./screens/organization/domains-screen.js";
import { OrganizationGeneralScreen } from "./screens/organization/general-screen.js";
import { GroupScreen } from "./screens/organization/group-screen.js";
import { GroupsScreen } from "./screens/organization/groups-screen.js";
import { MemberScreen } from "./screens/organization/member-screen.js";
import { MembersScreen } from "./screens/organization/members-screen.js";
import { OrganizationNotificationDefaultsScreen } from "./screens/organization/notification-defaults-screen.js";
import { OrganizationRolesScreen } from "./screens/organization/roles-screen.js";
import { OrganizationSecurityScreen } from "./screens/organization/security-screen.js";
import { ServiceAccountScreen } from "./screens/organization/service-account-screen.js";
import { ServiceAccountsScreen } from "./screens/organization/service-accounts-screen.js";
import { SettingsLayout } from "./screens/settings/settings-layout.js";
import { SettingsPending } from "./screens/settings/settings-pending.js";
import { searchResultsQuery } from "./search/search-api.js";
import { activeFilterCount, fromSearchParams, searchPageSearch } from "./search/search-params.js";
import { SearchScreen } from "./search/search-screen.js";
import { leavesApp, safeRedirect } from "./session/redirect.js";
import { AccessRequestScreen, MyAccessRequestsScreen } from "./sharing/access-requests.js";
import { LinkLandingScreen } from "./sharing/link-landing.js";
import { SharedPageScreen } from "./sharing/shared-page-screen.js";
import { sharedWithMeQuery } from "./sharing/sharing-api.js";
import { AppShell, ShellPending } from "./shell/app-shell.js";
import { ContentPending, PagePending, PENDING_MIN_MS, PENDING_MS } from "./shell/navigation-pending.js";
import { currentOrganizationId } from "./shell/shell-context.js";
import { FolderScreen } from "./spaces/folder-screen.js";
import { itemHref } from "./spaces/item-paths.js";
import { LabelScreen } from "./spaces/label-screen.js";
import { PageScreen } from "./spaces/page-screen.js";
import { PersonalSpaceScreen } from "./spaces/personal-space-screen.js";
import { OrganizationContentScreen } from "./spaces/settings/organization-content-screen.js";
import { OrganizationSpacesScreen } from "./spaces/settings/organization-spaces-screen.js";
import { SpaceAccessScreen } from "./spaces/settings/space-access-screen.js";
import { SpaceChatScreen } from "./spaces/settings/space-chat-screen.js";
import { SpaceContentScreen } from "./spaces/settings/space-content-screen.js";
import { SpaceExportScreen } from "./spaces/settings/space-export-screen.js";
import { SpaceGeneralScreen } from "./spaces/settings/space-general-screen.js";
import { SpacePermissionsScreen } from "./spaces/settings/space-permissions-screen.js";
import { SpaceSettingsLayout } from "./spaces/settings/space-settings-layout.js";
import { SpaceShortcutsScreen } from "./spaces/settings/space-shortcuts-screen.js";
import { SpaceStatusScreen } from "./spaces/settings/space-status-screen.js";
import { SpaceLayout, SpaceLoading, SpaceOverviewRedirect } from "./spaces/space-layout.js";
import { contentQuery, itemQuery, spaceByKeyQuery } from "./spaces/space-queries.js";
import { SpacesScreen, spaceListFilter, spaceListQuery } from "./spaces/spaces-screen.js";
import { InstanceTemplatesScreen } from "./spaces/templates/instance-templates-screen.js";
import { OrganizationTemplatesScreen } from "./spaces/templates/organization-templates-screen.js";
import { SpaceTemplatesScreen } from "./spaces/templates/space-templates-screen.js";
import { TrashScreen } from "./spaces/trash/trash-screen.js";
import { VersionsScreen } from "./spaces/versions/versions-screen.js";
import { WhiteboardHistoryScreen } from "./whiteboards/whiteboard-history-screen.js";
import { WhiteboardScreen } from "./whiteboards/whiteboard-screen.js";

export interface RouterContext {
  queryClient: QueryClient;
}

const redirectSearch = z.object({ redirect: z.string().optional() });

const wizardSearch = z.object({
  providerId: z.uuid().optional(),
  draftId: z.uuid().optional(),
  step: z.coerce.number().int().min(0).max(5).optional(),
  providerTest: z.string().max(100).optional(),
});

const providerSearch = z.object({
  tab: z.string().max(50).optional(),
  providerTest: z.string().max(100).optional(),
});

const rootRoute = createRootRouteWithContext<RouterContext>()({
  beforeLoad: ({ location }) => {
    if (openForUpdate(location.href)) return new Promise<never>(() => {});
  },
  component: RootLayout,
  notFoundComponent: () => <NotFoundScreen />,
  errorComponent: RouteErrorScreen,
});

async function requireSetupComplete(queryClient: QueryClient) {
  const info = await queryClient.ensureQueryData(instanceInfoQuery);
  if (!info.setupComplete) throw redirect({ to: "/setup" });
}

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  validateSearch: z.object({
    step: z
      .enum(["welcome", "instance", "systemCheck", "owner", "keyBackup", "organization", "summary"])
      .optional()
      .catch(undefined),
    restore: z.enum(["upload", "s3", "server", "keys", "progress"]).optional().catch(undefined),
  }),
  beforeLoad: async ({ context }) => {
    const info = await context.queryClient.ensureQueryData(instanceInfoQuery);
    if (info.setupComplete) throw redirect({ to: "/sign-in" });
  },
  pendingComponent: PagePending,
  component: lazyRouteComponent(() => import("./screens/setup/setup-screen.js"), "SetupScreen"),
});

const linkLandingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/s/$token",
  beforeLoad: ({ context }) => requireSetupComplete(context.queryClient),
  pendingComponent: PagePending,
  component: LinkLandingScreen,
});

const publicRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "public",
  beforeLoad: ({ context }) => requireSetupComplete(context.queryClient),
  pendingComponent: PagePending,
  component: AuthLayout,
});

const signInRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/sign-in",
  validateSearch: redirectSearch.extend({
    reason: z.enum(["sessionEnded", "signedOut"]).optional(),
    error: z.string().max(100).optional(),
    emergency: z.boolean().optional().catch(undefined),
  }),
  beforeLoad: async ({ context, search }) => {
    const session = await context.queryClient.fetchQuery(sessionQuery);
    const target = safeRedirect(search.redirect);
    if (session?.sessionKind === "full") throw redirect({ href: target, reloadDocument: leavesApp(target) });
  },
  component: SignInScreen,
});

const verifyRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/sign-in/verify",
  validateSearch: redirectSearch.extend({
    factors: z.array(z.enum(["totp", "passkey", "recoveryCode"])).catch(["totp", "recoveryCode"]),
  }),
  component: SecondFactorScreen,
});

const linkAccountRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/sign-in/link",
  component: LinkAccountScreen,
});

const signInRefusedRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/sign-in/refused",
  validateSearch: z.object({
    reference: z.string().max(100).optional(),
    reason: z.string().max(100).optional(),
    provider: idSchema.optional().catch(undefined),
  }),
  component: SignInRefusedScreen,
});

const resetPasswordRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/reset-password",
  component: ResetPasswordScreen,
});

const confirmEmailRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/confirm-email",
  component: ConfirmEmailScreen,
});

const acceptInvitationRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/accept-invitation",
  component: AcceptInvitationScreen,
});

const registerRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/register",
  component: RegisterScreen,
});

const completeRegistrationRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/complete-registration",
  component: CompleteRegistrationScreen,
});

const secondFactorSetupRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/second-factor-setup",
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.fetchQuery(sessionQuery);
    if (!session) throw redirect({ to: "/sign-in", search: { redirect: location.href } });
    if (session.sessionKind === "full") throw redirect({ to: "/" });
  },
  component: SecondFactorSetupScreen,
});

const unsubscribeRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/unsubscribe/$token",
  component: UnsubscribeScreen,
});

async function requireSession(queryClient: QueryClient, href: string) {
  await requireSetupComplete(queryClient);
  const session = await queryClient.ensureQueryData({ ...sessionQuery, revalidateIfStale: true });
  if (!session) throw redirect({ to: "/sign-in", search: { redirect: href } });
  if (session.sessionKind === "secondFactorSetup") throw redirect({ to: "/second-factor-setup" });
  return session;
}

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: async ({ context, location }) => ({
    session: await requireSession(context.queryClient, location.href),
  }),
  loader: ({ context, params }) =>
    loadShell(context.queryClient, context.session, (params as { organizationId?: string }).organizationId),
  pendingComponent: ShellPending,
  component: AppShell,
});

const appNotFoundRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "$",
  component: AppNotFoundScreen,
});

const printRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/print",
  validateSearch: printRouteSearch,
  beforeLoad: async ({ context, location }) => ({
    session: await requireSession(context.queryClient, location.href),
  }),
  pendingComponent: PagePending,
  component: PrintScreen,
});

const homeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: Landing,
});

const forYouRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/home",
  loader: ({ context: { queryClient } }) => {
    void settle(queryClient.ensureQueryData(homeQuery()), queryClient.ensureQueryData(sharedWithMeQuery()));
  },
  component: HomeScreen,
});

const openNotificationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/notifications/$notificationId",
  params: { parse: (params) => ({ notificationId: idSchema.parse(params.notificationId) }) },
  component: OpenNotificationScreen,
});

const searchRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/search",
  validateSearch: searchPageSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ context: { queryClient, session }, deps }) => {
    const { query, filters } = fromSearchParams(deps);
    if (query.trim().length === 0 && activeFilterCount(filters) === 0) return;
    const organizationId = await currentOrganizationId(queryClient, session, undefined);
    if (organizationId)
      await settle(queryClient.ensureInfiniteQueryData(searchResultsQuery(organizationId, query, filters)));
  },
  component: SearchScreen,
});

const myTasksRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/tasks",
  validateSearch: z.object({
    view: z.enum(["open", "done", "created"]).optional().catch(undefined),
    space: idSchema.optional().catch(undefined),
    due: z.enum(["any", "overdue", "next7Days", "next30Days", "none"]).optional().catch(undefined),
    by: idSchema.optional().catch(undefined),
    group: z.enum(["due", "space", "none"]).optional().catch(undefined),
    sort: z.enum(["due", "text", "item", "assignedBy"]).optional().catch(undefined),
    dir: z.enum(["asc", "desc"]).optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ context: { queryClient }, deps }) =>
    settle(queryClient.ensureQueryData(tasksQuery(myTasksQuery(deps, null)))),
  component: MyTasksScreen,
});

const blogRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/blog",
  validateSearch: z.object({
    space: idSchema.optional().catch(undefined),
    label: z.string().max(100).optional().catch(undefined),
  }),
  component: OrganizationBlogScreen,
});

const spacesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/spaces",
  validateSearch: z.object({
    q: z.string().max(200).optional().catch(undefined),
    organization: idSchema.optional().catch(undefined),
    archived: z.boolean().optional().catch(undefined),
    oneOnOnes: z.boolean().optional().catch(undefined),
    deleted: z.boolean().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ context: { queryClient }, deps }) =>
    deps.deleted
      ? undefined
      : settle(queryClient.ensureInfiniteQueryData(spaceListQuery(spaceListFilter(deps)))),
  component: SpacesScreen,
});

const personalSpaceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/personal-space",
  component: PersonalSpaceScreen,
});

const notificationsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/notifications",
  loader: ({ context: { queryClient } }) =>
    settle(queryClient.ensureInfiniteQueryData(notificationListQuery({ unreadOnly: false }))),
  component: NotificationsScreen,
});

const myAccessRequestsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/access-requests",
  component: MyAccessRequestsScreen,
});

const confluenceLinkRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/confluence/$",
  component: ConfluenceRedirectScreen,
});

const accessRequestRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/access-requests/$requestId",
  params: { parse: (params) => ({ ...params, requestId: z.uuid().parse(params.requestId) }) },
  component: AccessRequestScreen,
});

const sharedPageRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/shared/$itemId/{-$slug}",
  params: { parse: (params) => ({ ...params, itemId: z.uuid().parse(params.itemId) }) },
  validateSearch: z.object({
    attachment: z.uuid().optional().catch(undefined),
    edit: z.boolean().optional().catch(undefined),
  }),
  component: SharedPageScreen,
});

const spaceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/spaces/$spaceKey",
  loader: ({ context: { queryClient }, params }) =>
    settle(queryClient.ensureQueryData(spaceByKeyQuery(params.spaceKey))),
  pendingComponent: SpaceLoading,
  component: SpaceLayout,
});

const spaceIndexRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/",
  loader: async ({ context: { queryClient }, params }) => {
    const resolved = await queryClient.ensureQueryData(spaceByKeyQuery(params.spaceKey)).catch(() => null);
    const space = resolved?.space;
    if (!space?.overviewItemId || isKnowledgeBase(space)) return;
    const overview = await queryClient.ensureQueryData(itemQuery(space.overviewItemId)).catch(() => null);
    if (!overview) return;
    const href = itemHref({ ...overview, link: null }, space.key);
    if (href) throw redirect({ href, replace: true });
  },
  component: SpaceOverviewRedirect,
});

const itemSearch = z.object({
  attachment: z.uuid().optional().catch(undefined),
  comment: z.uuid().optional().catch(undefined),
  edit: z.boolean().optional().catch(undefined),
  notes: z.boolean().optional().catch(undefined),
  reports: z
    .record(z.string().regex(/^[0-9a-z]{1,8}$/), z.number().int().min(2).max(100_000))
    .optional()
    .catch(undefined),
});

const pageRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/pages/$itemId/{-$slug}",
  params: { parse: (params) => ({ ...params, itemId: z.uuid().parse(params.itemId) }) },
  validateSearch: itemSearch,
  loader: ({ context: { queryClient }, params }) =>
    settle(
      queryClient.ensureQueryData(itemQuery(params.itemId)),
      queryClient.ensureQueryData(contentQuery(params.itemId)),
      queryClient.ensureQueryData(taskStatusesQuery(params.itemId)),
    ),
  component: PageScreen,
});

const spaceBlogRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/blog",
  component: SpaceBlogScreen,
});

const blogPostRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/blog/$itemId/{-$slug}",
  params: { parse: (params) => ({ ...params, itemId: z.uuid().parse(params.itemId) }) },
  validateSearch: itemSearch,
  loader: ({ context: { queryClient }, params }) =>
    settle(
      queryClient.ensureQueryData(itemQuery(params.itemId)),
      queryClient.ensureQueryData(blogPostQuery(params.itemId)),
      queryClient.ensureQueryData(taskStatusesQuery(params.itemId)),
    ),
  component: BlogPostScreen,
});

const whiteboardRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/whiteboards/$itemId/{-$slug}",
  params: { parse: (params) => ({ ...params, itemId: z.uuid().parse(params.itemId) }) },
  loader: ({ context: { queryClient }, params }) =>
    settle(queryClient.ensureQueryData(itemQuery(params.itemId))),
  component: WhiteboardScreen,
});

const whiteboardHistoryRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/whiteboards/$itemId/history",
  params: { parse: (params) => ({ ...params, itemId: z.uuid().parse(params.itemId) }) },
  validateSearch: z.object({ version: z.coerce.number().int().min(1).optional().catch(undefined) }),
  component: WhiteboardHistoryScreen,
});

const historyRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/pages/$itemId/history",
  params: { parse: (params) => ({ ...params, itemId: z.uuid().parse(params.itemId) }) },
  validateSearch: z.object({
    from: z
      .union([z.string().max(20), z.number().int()])
      .transform(String)
      .optional()
      .catch(undefined),
    to: z
      .union([z.string().max(20), z.number().int()])
      .transform(String)
      .optional()
      .catch(undefined),
    view: z.enum(["inline", "sideBySide"]).optional().catch(undefined),
  }),
  loader: ({ context: { queryClient }, params }) =>
    settle(queryClient.ensureQueryData(itemQuery(params.itemId))),
  component: VersionsScreen,
});

const trashRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/trash",
  component: TrashScreen,
});

const reviewsRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/reviews",
  validateSearch: reviewSearch,
  component: ReviewScreen,
});

const statisticsRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/statistics",
  validateSearch: statisticsSearch,
  component: StatisticsScreen,
});

const folderRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/folders/$itemId/{-$slug}",
  params: { parse: (params) => ({ ...params, itemId: z.uuid().parse(params.itemId) }) },
  loader: ({ context: { queryClient }, params }) =>
    settle(queryClient.ensureQueryData(itemQuery(params.itemId))),
  component: FolderScreen,
});

const meetingsRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/meetings",
  loader: async ({ context: { queryClient }, params }) => {
    const space = await queryClient.ensureQueryData(spaceByKeyQuery(params.spaceKey)).catch(() => null);
    if (space) await settle(queryClient.ensureQueryData(spaceSeriesQuery(space.space.id)));
  },
  component: SeriesListScreen,
});

const seriesRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/meetings/$seriesId",
  params: { parse: (params) => ({ ...params, seriesId: z.uuid().parse(params.seriesId) }) },
  validateSearch: z.object({
    tab: z.enum(["overview", "topics", "tasks", "decisions", "meetings"]).optional().catch(undefined),
    status: z.enum(["open", "closed", "all"]).optional().catch(undefined),
  }),
  loader: ({ context: { queryClient }, params }) =>
    settle(queryClient.ensureQueryData(seriesQuery(params.seriesId))),
  component: SeriesScreen,
});

const topicRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/topics/$topicId",
  params: { parse: (params) => ({ ...params, topicId: z.uuid().parse(params.topicId) }) },
  loader: ({ context: { queryClient }, params }) =>
    settle(queryClient.ensureQueryData(topicQuery(params.topicId))),
  component: TopicScreen,
});

const labelRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/labels/$label",
  component: LabelScreen,
});

const spaceSettingsRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/settings",
  component: SpaceSettingsLayout,
  pendingComponent: SettingsPending,
});

const spaceSettingsIndexRoute = createRoute({
  getParentRoute: () => spaceSettingsRoute,
  path: "/",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/spaces/$spaceKey/settings/general", params });
  },
});

const spaceGeneralRoute = createRoute({
  getParentRoute: () => spaceSettingsRoute,
  path: "/general",
  component: SpaceGeneralScreen,
});

const spacePermissionsRoute = createRoute({
  getParentRoute: () => spaceSettingsRoute,
  path: "/permissions",
  component: SpacePermissionsScreen,
});

const spaceAccessRoute = createRoute({
  getParentRoute: () => spaceSettingsRoute,
  path: "/access",
  component: SpaceAccessScreen,
});

const spaceContentRoute = createRoute({
  getParentRoute: () => spaceSettingsRoute,
  path: "/content",
  component: SpaceContentScreen,
});

const spaceStatusRoute = createRoute({
  getParentRoute: () => spaceSettingsRoute,
  path: "/status",
  component: SpaceStatusScreen,
});

const spaceShortcutsRoute = createRoute({
  getParentRoute: () => spaceSettingsRoute,
  path: "/shortcuts",
  component: SpaceShortcutsScreen,
});

const spaceChatRoute = createRoute({
  getParentRoute: () => spaceSettingsRoute,
  path: "/chat",
  component: SpaceChatScreen,
});

const spaceExportRoute = createRoute({
  getParentRoute: () => spaceSettingsRoute,
  path: "/export",
  component: SpaceExportScreen,
});

const spaceTemplatesRoute = createRoute({
  getParentRoute: () => spaceSettingsRoute,
  path: "/templates",
  component: SpaceTemplatesScreen,
});

const spaceVisibilityRoute = createRoute({
  getParentRoute: () => spaceSettingsRoute,
  path: "/visibility",
  component: KnowledgeBaseVisibilityScreen,
});

const spaceAddressRoute = createRoute({
  getParentRoute: () => spaceSettingsRoute,
  path: "/address",
  component: PortalAddressScreen,
});

const spaceAppearanceRoute = createRoute({
  getParentRoute: () => spaceSettingsRoute,
  path: "/appearance",
  component: PortalAppearanceScreen,
});

const spaceCategoriesRoute = createRoute({
  getParentRoute: () => spaceSettingsRoute,
  path: "/categories",
  component: CategoriesScreen,
});

const spaceArticleTemplatesRoute = createRoute({
  getParentRoute: () => spaceSettingsRoute,
  path: "/article-templates",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/spaces/$spaceKey/settings/templates", params });
  },
});

const spacePortalAccountsRoute = createRoute({
  getParentRoute: () => spaceSettingsRoute,
  path: "/portal-accounts",
  component: PortalAccountsScreen,
});

const spaceLanguagesRoute = createRoute({
  getParentRoute: () => spaceSettingsRoute,
  path: "/languages",
  component: LanguagesScreen,
});

const spaceReviewSettingsRoute = createRoute({
  getParentRoute: () => spaceSettingsRoute,
  path: "/reviews",
  component: ReviewSettingsScreen,
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings",
  component: SettingsLayout,
  pendingComponent: SettingsPending,
});

const settingsIndexRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/settings/profile" });
  },
});

const profileRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/profile",
  component: ProfileScreen,
});

const preferencesRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/preferences",
  component: PreferencesScreen,
});

const securityRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/security",
  loader: ({ context: { queryClient } }) =>
    settle(queryClient.ensureQueryData(securityQuery), queryClient.ensureQueryData(sessionsQuery)),
  component: SecurityScreen,
});

const exportsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/exports",
  component: ExportsScreen,
});

const watchedItemsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/notifications/watching",
  component: WatchedItemsScreen,
});

const notificationSettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/notifications",
  component: NotificationPreferencesScreen,
});

const organizationRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/organizations/$organizationId",
  params: { parse: (params) => ({ organizationId: z.uuid().parse(params.organizationId) }) },
  beforeLoad: ({ params }) => ({ organizationId: params.organizationId }),
  loader: ({ context: { queryClient }, params }) =>
    settle(queryClient.ensureQueryData(organizationQuery(params.organizationId))),
});

const organizationIndexRoute = createRoute({
  getParentRoute: () => organizationRoute,
  path: "/",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/settings/organizations/$organizationId/general", params });
  },
});

type OrganizationLoad = (queryClient: QueryClient, organizationId: string) => readonly Promise<unknown>[];
type OrganizationLoader = (match: { context: RouterContext & { organizationId: string } }) => Promise<void>;

function organizationLoader(load: OrganizationLoad | undefined): OrganizationLoader {
  return ({ context }) => settle(...(load?.(context.queryClient, context.organizationId) ?? []));
}

function organizationScreen<TPath extends string>(
  path: TPath,
  component: RouteComponent,
  load?: OrganizationLoad,
) {
  return createRoute({
    getParentRoute: () => organizationRoute,
    path,
    loader: organizationLoader(load),
    component,
  });
}

const withOrganizationSettings: OrganizationLoad = (queryClient, organizationId) => [
  queryClient.ensureQueryData(organizationSettingsQuery(organizationId)),
];

const organizationGeneralRoute = organizationScreen(
  "/general",
  OrganizationGeneralScreen,
  withOrganizationSettings,
);
const membersRoute = organizationScreen("/members", MembersScreen, (queryClient, organizationId) => [
  queryClient.ensureQueryData(membersQuery(organizationId)),
]);
const memberRoute = organizationScreen("/members/$accountId", MemberScreen);
const groupsRoute = organizationScreen("/groups", GroupsScreen);
const groupRoute = organizationScreen("/groups/$groupId", GroupScreen);
const rolesRoute = organizationScreen("/roles", OrganizationRolesScreen, (queryClient, organizationId) => [
  queryClient.ensureQueryData(rolesQuery(organizationId)),
  queryClient.ensureQueryData(membersQuery(organizationId)),
]);
const serviceAccountsRoute = organizationScreen(
  "/service-accounts",
  ServiceAccountsScreen,
  (queryClient, organizationId) => [
    queryClient.ensureQueryData(serviceAccountsQuery(organizationId)),
    queryClient.ensureQueryData(membersQuery(organizationId)),
  ],
);
const serviceAccountRoute = organizationScreen("/service-accounts/$serviceAccountId", ServiceAccountScreen);
const organizationTokensRoute = organizationScreen(
  "/api-tokens",
  OrganizationTokensScreen,
  (queryClient, organizationId) => [
    queryClient.ensureQueryData(organizationTokensQuery(organizationId)),
    queryClient.ensureQueryData(membersQuery(organizationId)),
  ],
);
const organizationSecurityRoute = organizationScreen(
  "/security",
  OrganizationSecurityScreen,
  withOrganizationSettings,
);
const domainsRoute = organizationScreen(
  "/domains-and-guests",
  DomainsScreen,
  (queryClient, organizationId) => [
    ...withOrganizationSettings(queryClient, organizationId),
    queryClient.ensureQueryData(domainsQuery(organizationId)),
  ],
);
const organizationNotificationsRoute = organizationScreen(
  "/notifications",
  OrganizationNotificationDefaultsScreen,
  withOrganizationSettings,
);
const organizationAnnouncementsRoute = organizationScreen("/announcements", OrganizationAnnouncementsScreen);
const organizationSpacesRoute = organizationScreen(
  "/spaces",
  OrganizationSpacesScreen,
  withOrganizationSettings,
);
const organizationContentRoute = organizationScreen(
  "/content",
  OrganizationContentScreen,
  withOrganizationSettings,
);
const organizationTemplatesRoute = organizationScreen("/templates", OrganizationTemplatesScreen);
const organizationAccessRoute = organizationScreen("/access", AccessOverviewScreen);

const importsRoute = organizationScreen("/imports", ImportsScreen);
const importWizardRoute = createRoute({
  getParentRoute: () => organizationRoute,
  path: "/imports/$importId/setup",
  params: { parse: (params) => ({ importId: z.uuid().parse(params.importId) }) },
  validateSearch: z.object({ step: z.coerce.number().int().min(0).max(9).optional() }),
  component: lazyRouteComponent(() => import("./imports/import-wizard-screen.js"), "ImportWizardScreen"),
});
const importRoute = createRoute({
  getParentRoute: () => organizationRoute,
  path: "/imports/$importId",
  params: { parse: (params) => ({ importId: z.uuid().parse(params.importId) }) },
  validateSearch: z.object({
    tab: z
      .enum([
        "summary",
        "macros",
        "people",
        "comments",
        "attachments",
        "permissions",
        "conflicts",
        "updates",
        "deleted",
        "moved",
      ])
      .optional()
      .catch(undefined),
  }),
  component: lazyRouteComponent(() => import("./imports/import-screen.js"), "ImportScreen"),
});

const reimportComparisonRoute = createRoute({
  getParentRoute: () => organizationRoute,
  path: "/imports/$importId/changes/$changeId/compare",
  params: {
    parse: (params) => ({
      importId: z.uuid().parse(params.importId),
      changeId: z.uuid().parse(params.changeId),
    }),
  },
  validateSearch: z.object({ view: z.enum(["inline", "sideBySide"]).optional().catch(undefined) }),
  component: lazyRouteComponent(() => import("./imports/reimport-comparison.js"), "ReimportComparisonScreen"),
});

const organizationAuditRoute = organizationScreen("/audit-log", OrganizationAuditScreen);

const instanceRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/instance",
});

type InstanceLoad = (queryClient: QueryClient) => readonly Promise<unknown>[];
type InstanceLoader = (match: { context: RouterContext }) => Promise<void>;

function instanceLoader(load: InstanceLoad | undefined): InstanceLoader {
  return ({ context }) => settle(...(load?.(context.queryClient) ?? []));
}

function instanceScreen<TPath extends string>(path: TPath, component: RouteComponent, load?: InstanceLoad) {
  return createRoute({
    getParentRoute: () => instanceRoute,
    path,
    loader: instanceLoader(load),
    component,
  });
}

const withInstanceSettings: InstanceLoad = (queryClient) => [
  queryClient.ensureQueryData(instanceSettingsQuery),
];

const instanceIndexRoute = createRoute({
  getParentRoute: () => instanceRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/settings/instance/general" });
  },
});
const instanceStatusRoute = instanceScreen("/status", InstanceStatusScreen, (queryClient) => [
  queryClient.ensureQueryData(operationsStatusQuery),
]);
const instanceUpdatesRoute = instanceScreen("/updates", InstanceUpdatesScreen, (queryClient) => [
  ...withInstanceSettings(queryClient),
  queryClient.ensureQueryData(updatesQuery),
]);
const instanceMaintenanceRoute = instanceScreen("/maintenance", InstanceMaintenanceScreen);
const instanceGeneralRoute = instanceScreen("/general", InstanceGeneralScreen, withInstanceSettings);
const instanceOrganizationsRoute = instanceScreen("/organizations", InstanceOrganizationsScreen);
const instanceAccountsRoute = instanceScreen("/accounts", InstanceAccountsScreen);
const instanceAccountRoute = instanceScreen("/accounts/$accountId", InstanceAccountScreen);
const instanceRolesRoute = instanceScreen("/roles", InstanceRolesScreen, (queryClient) => [
  queryClient.ensureQueryData(instanceRolesQuery),
]);
const instanceSecurityRoute = instanceScreen("/security", InstanceSecurityScreen, withInstanceSettings);
const instanceProvidersRoute = instanceScreen("/sign-in-providers", InstanceProvidersScreen);
const instanceNewProviderRoute = createRoute({
  getParentRoute: () => instanceRoute,
  path: "/sign-in-providers/new",
  validateSearch: wizardSearch,
  component: InstanceProviderWizardScreen,
});
const instanceProviderRoute = createRoute({
  getParentRoute: () => instanceRoute,
  path: "/sign-in-providers/$providerId",
  validateSearch: providerSearch,
  component: InstanceProviderScreen,
});
const instanceEmbedsRoute = instanceScreen("/embeds", InstanceEmbedsScreen, withInstanceSettings);
const instancePortalsRoute = instanceScreen("/portals", InstancePortalsScreen, withInstanceSettings);
const instanceRenderingRoute = instanceScreen("/rendering", InstanceRenderingScreen, (queryClient) => [
  queryClient.ensureQueryData(renderingQuery),
]);
const instanceMailRoute = instanceScreen("/mail", InstanceMailScreen, (queryClient) => [
  queryClient.ensureQueryData(mailQuery),
]);
const instanceStorageRoute = instanceScreen("/storage", InstanceStorageScreen, (queryClient) => [
  ...withInstanceSettings(queryClient),
  queryClient.ensureQueryData(storageQuery),
]);
const instanceBackupsRoute = instanceScreen("/backups", InstanceBackupsScreen);
const breakGlassRoute = instanceScreen("/break-glass", BreakGlassScreen, (queryClient) => [
  queryClient.ensureQueryData(breakGlassQuery),
  queryClient.ensureQueryData(instanceOrganizationsQuery),
]);
function movedInstanceScreen(path: string, to: string) {
  return createRoute({
    getParentRoute: () => instanceRoute,
    path,
    beforeLoad: () => {
      throw redirect({ to: to as never });
    },
  });
}

const instanceNotificationsRoute = movedInstanceScreen("/notifications", "/settings/instance/mail");
const instanceAnnouncementsRoute = instanceScreen("/announcements", InstanceAnnouncementsScreen);
const instancePersonalSpacesRoute = movedInstanceScreen("/personal-spaces", "/settings/instance/accounts");
const instanceContentRoute = movedInstanceScreen("/content", "/settings/instance/security");
const instanceTemplatesRoute = instanceScreen("/templates", InstanceTemplatesScreen);
const instanceAuditRoute = instanceScreen("/audit-log", InstanceAuditScreen);

const devRoutes =
  import.meta.env.DEV || import.meta.env.MODE === "e2e"
    ? [
        createRoute({
          getParentRoute: () => rootRoute,
          path: "/dev/components",
          component: lazyRouteComponent(() => import("./dev/components-page.js")),
        }),
      ]
    : [];

const routeTree = rootRoute.addChildren([
  setupRoute,
  linkLandingRoute,
  publicRoute.addChildren([
    signInRoute,
    verifyRoute,
    linkAccountRoute,
    signInRefusedRoute,
    resetPasswordRoute,
    confirmEmailRoute,
    acceptInvitationRoute,
    registerRoute,
    completeRegistrationRoute,
    secondFactorSetupRoute,
    unsubscribeRoute,
  ]),
  printRoute,
  appRoute.addChildren([
    appNotFoundRoute,
    homeRoute,
    forYouRoute,
    openNotificationRoute,
    searchRoute,
    myTasksRoute,
    notificationsRoute,
    blogRoute,
    spacesRoute,
    personalSpaceRoute,
    sharedPageRoute,
    myAccessRequestsRoute,
    accessRequestRoute,
    confluenceLinkRoute,
    spaceRoute.addChildren([
      spaceIndexRoute,
      spaceBlogRoute,
      blogPostRoute,
      historyRoute,
      pageRoute,
      whiteboardHistoryRoute,
      whiteboardRoute,
      folderRoute,
      meetingsRoute,
      seriesRoute,
      topicRoute,
      labelRoute,
      trashRoute,
      reviewsRoute,
      statisticsRoute,
      spaceSettingsRoute.addChildren([
        spaceSettingsIndexRoute,
        spaceGeneralRoute,
        spacePermissionsRoute,
        spaceAccessRoute,
        spaceContentRoute,
        spaceStatusRoute,
        spaceShortcutsRoute,
        spaceChatRoute,
        spaceTemplatesRoute,
        spaceVisibilityRoute,
        spaceAddressRoute,
        spaceAppearanceRoute,
        spaceCategoriesRoute,
        spaceArticleTemplatesRoute,
        spaceReviewSettingsRoute,
        spaceLanguagesRoute,
        spacePortalAccountsRoute,
        spaceExportRoute,
      ]),
    ]),
    settingsRoute.addChildren([
      settingsIndexRoute,
      profileRoute,
      preferencesRoute,
      securityRoute,
      notificationSettingsRoute,
      watchedItemsRoute,
      exportsRoute,
      organizationRoute.addChildren([
        organizationIndexRoute,
        organizationGeneralRoute,
        membersRoute,
        memberRoute,
        groupsRoute,
        groupRoute,
        rolesRoute,
        serviceAccountsRoute,
        serviceAccountRoute,
        organizationTokensRoute,
        organizationSecurityRoute,
        domainsRoute,
        organizationNotificationsRoute,
        organizationAnnouncementsRoute,
        organizationSpacesRoute,
        organizationContentRoute,
        organizationTemplatesRoute,
        organizationAccessRoute,
        importsRoute,
        reimportComparisonRoute,
        importWizardRoute,
        importRoute,
        organizationAuditRoute,
      ]),
      instanceRoute.addChildren([
        instanceIndexRoute,
        instanceStatusRoute,
        instanceUpdatesRoute,
        instanceMaintenanceRoute,
        instanceGeneralRoute,
        instanceOrganizationsRoute,
        instanceAccountsRoute,
        instanceAccountRoute,
        instanceRolesRoute,
        instanceSecurityRoute,
        instanceProvidersRoute,
        instanceNewProviderRoute,
        instanceProviderRoute,
        instanceMailRoute,
        instanceStorageRoute,
        instanceBackupsRoute,
        instanceRenderingRoute,
        instanceEmbedsRoute,
        instancePortalsRoute,
        breakGlassRoute,
        instanceNotificationsRoute,
        instanceAnnouncementsRoute,
        instancePersonalSpacesRoute,
        instanceContentRoute,
        instanceTemplatesRoute,
        instanceAuditRoute,
      ]),
    ]),
  ]),
  ...devRoutes,
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    defaultPendingComponent: ContentPending,
    defaultPendingMs: PENDING_MS,
    defaultPendingMinMs: PENDING_MIN_MS,
    defaultErrorComponent: ScreenErrorScreen,
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
