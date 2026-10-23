import { idSchema } from "@lunedo/shared";
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";
import { z } from "zod";
import { instanceInfoQuery, sessionQuery } from "./api/queries.js";
import { NotFoundScreen, RouteErrorScreen, ScreenErrorScreen } from "./errors/route-error.js";
import { printRouteSearch } from "./exports/print-search.js";
import { reviewSearch } from "./knowledge-bases/reviews/review-search.js";
import { statisticsSearch } from "./knowledge-bases/statistics/statistics-search.js";
import { RootLayout } from "./root-layout.js";
import { searchPageSearch } from "./search/search-params.js";
import { leavesApp, safeRedirect } from "./session/redirect.js";

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
  component: RootLayout,
  notFoundComponent: NotFoundScreen,
  errorComponent: RouteErrorScreen,
});

async function requireSetupComplete(queryClient: QueryClient) {
  const info = await queryClient.ensureQueryData(instanceInfoQuery);
  if (!info.setupComplete) throw redirect({ to: "/setup" });
}

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  beforeLoad: async ({ context }) => {
    const info = await context.queryClient.ensureQueryData(instanceInfoQuery);
    if (info.setupComplete) throw redirect({ to: "/sign-in" });
  },
  component: lazyRouteComponent(() => import("./screens/setup/setup-screen.js"), "SetupScreen"),
});

const linkLandingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/s/$token",
  beforeLoad: ({ context }) => requireSetupComplete(context.queryClient),
  component: lazyRouteComponent(() => import("./sharing/link-landing.js"), "LinkLandingScreen"),
});

const publicRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "public",
  beforeLoad: ({ context }) => requireSetupComplete(context.queryClient),
  component: lazyRouteComponent(() => import("./screens/auth/auth-layout.js"), "AuthLayout"),
});

const signInRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/sign-in",
  validateSearch: redirectSearch.extend({
    reason: z.enum(["sessionEnded", "signedOut"]).optional(),
    error: z.string().max(100).optional(),
  }),
  beforeLoad: async ({ context, search }) => {
    const session = await context.queryClient.fetchQuery(sessionQuery);
    const target = safeRedirect(search.redirect);
    if (session?.sessionKind === "full") throw redirect({ href: target, reloadDocument: leavesApp(target) });
  },
  component: lazyRouteComponent(() => import("./screens/auth/sign-in-screen.js"), "SignInScreen"),
});

const verifyRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/sign-in/verify",
  validateSearch: redirectSearch.extend({
    factors: z.array(z.enum(["totp", "passkey", "recoveryCode"])).catch(["totp", "recoveryCode"]),
  }),
  component: lazyRouteComponent(() => import("./screens/auth/second-factor-screen.js"), "SecondFactorScreen"),
});

const linkAccountRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/sign-in/link",
  component: lazyRouteComponent(() => import("./screens/auth/link-account-screen.js"), "LinkAccountScreen"),
});

const signInRefusedRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/sign-in/refused",
  validateSearch: z.object({
    reference: z.string().max(100).optional(),
    reason: z.string().max(100).optional(),
    provider: idSchema.optional().catch(undefined),
  }),
  component: lazyRouteComponent(
    () => import("./screens/auth/sign-in-refused-screen.js"),
    "SignInRefusedScreen",
  ),
});

const resetPasswordRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/reset-password",
  component: lazyRouteComponent(
    () => import("./screens/auth/reset-password-screen.js"),
    "ResetPasswordScreen",
  ),
});

const confirmEmailRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/confirm-email",
  component: lazyRouteComponent(() => import("./screens/auth/confirm-email-screen.js"), "ConfirmEmailScreen"),
});

const acceptInvitationRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/accept-invitation",
  component: lazyRouteComponent(
    () => import("./screens/auth/accept-invitation-screen.js"),
    "AcceptInvitationScreen",
  ),
});

const registerRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/register",
  component: lazyRouteComponent(() => import("./screens/auth/register-screen.js"), "RegisterScreen"),
});

const completeRegistrationRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/complete-registration",
  component: lazyRouteComponent(
    () => import("./screens/auth/complete-registration-screen.js"),
    "CompleteRegistrationScreen",
  ),
});

const secondFactorSetupRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/second-factor-setup",
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.fetchQuery(sessionQuery);
    if (!session) throw redirect({ to: "/sign-in", search: { redirect: location.href } });
    if (session.sessionKind === "full") throw redirect({ to: "/" });
  },
  component: lazyRouteComponent(
    () => import("./screens/auth/second-factor-setup-screen.js"),
    "SecondFactorSetupScreen",
  ),
});

const unsubscribeRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/unsubscribe/$token",
  component: lazyRouteComponent(() => import("./notifications/unsubscribe-screen.js"), "UnsubscribeScreen"),
});

async function requireSession(queryClient: QueryClient, href: string) {
  await requireSetupComplete(queryClient);
  const session = await queryClient.fetchQuery(sessionQuery);
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
  component: lazyRouteComponent(() => import("./shell/app-shell.js"), "AppShell"),
});

const printRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/print",
  validateSearch: printRouteSearch,
  beforeLoad: async ({ context, location }) => ({
    session: await requireSession(context.queryClient, location.href),
  }),
  component: lazyRouteComponent(() => import("./exports/print-screen.js"), "PrintScreen"),
});

const homeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: lazyRouteComponent(() => import("./collaboration/landing.js"), "Landing"),
});

const forYouRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/home",
  component: lazyRouteComponent(() => import("./collaboration/home-screen.js"), "HomeScreen"),
});

const openNotificationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/notifications/$notificationId",
  params: { parse: (params) => ({ notificationId: idSchema.parse(params.notificationId) }) },
  component: lazyRouteComponent(
    () => import("./notifications/open-notification-screen.js"),
    "OpenNotificationScreen",
  ),
});

const searchRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/search",
  validateSearch: searchPageSearch,
  component: lazyRouteComponent(() => import("./search/search-screen.js"), "SearchScreen"),
});

const myTasksRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/tasks",
  validateSearch: z.object({ filter: z.enum(["open", "overdue", "done"]).optional().catch(undefined) }),
  component: lazyRouteComponent(() => import("./collaboration/my-tasks-screen.js"), "MyTasksScreen"),
});

const blogRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/blog",
  validateSearch: z.object({
    space: idSchema.optional().catch(undefined),
    label: z.string().max(100).optional().catch(undefined),
  }),
  component: lazyRouteComponent(
    () => import("./collaboration/blog/organization-blog-screen.js"),
    "OrganizationBlogScreen",
  ),
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
  component: lazyRouteComponent(() => import("./spaces/spaces-screen.js"), "SpacesScreen"),
});

const personalSpaceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/personal-space",
  component: lazyRouteComponent(() => import("./spaces/personal-space-screen.js"), "PersonalSpaceScreen"),
});

const myAccessRequestsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/access-requests",
  component: lazyRouteComponent(() => import("./sharing/access-requests.js"), "MyAccessRequestsScreen"),
});

const confluenceLinkRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/confluence/$",
  component: lazyRouteComponent(() => import("./imports/confluence-link.js"), "ConfluenceRedirectScreen"),
});

const accessRequestRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/access-requests/$requestId",
  params: { parse: (params) => ({ ...params, requestId: z.uuid().parse(params.requestId) }) },
  component: lazyRouteComponent(() => import("./sharing/access-requests.js"), "AccessRequestScreen"),
});

const sharedPageRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/shared/$itemId/{-$slug}",
  params: { parse: (params) => ({ ...params, itemId: z.uuid().parse(params.itemId) }) },
  validateSearch: z.object({
    attachment: z.uuid().optional().catch(undefined),
    edit: z.boolean().optional().catch(undefined),
  }),
  component: lazyRouteComponent(() => import("./sharing/shared-page-screen.js"), "SharedPageScreen"),
});

const spaceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/spaces/$spaceKey",
  component: lazyRouteComponent(() => import("./spaces/space-layout.js"), "SpaceLayout"),
});

const spaceIndexRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/",
  component: lazyRouteComponent(() => import("./spaces/space-layout.js"), "SpaceOverviewRedirect"),
});

const itemSearch = z.object({
  attachment: z.uuid().optional().catch(undefined),
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
  component: lazyRouteComponent(() => import("./spaces/page-screen.js"), "PageScreen"),
});

const spaceBlogRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/blog",
  component: lazyRouteComponent(() => import("./collaboration/blog/space-blog-screen.js"), "SpaceBlogScreen"),
});

const blogPostRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/blog/$itemId/{-$slug}",
  params: { parse: (params) => ({ ...params, itemId: z.uuid().parse(params.itemId) }) },
  validateSearch: itemSearch,
  component: lazyRouteComponent(() => import("./collaboration/blog/blog-post-screen.js"), "BlogPostScreen"),
});

const whiteboardRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/whiteboards/$itemId/{-$slug}",
  params: { parse: (params) => ({ ...params, itemId: z.uuid().parse(params.itemId) }) },
  component: lazyRouteComponent(() => import("./whiteboards/whiteboard-screen.js"), "WhiteboardScreen"),
});

const whiteboardHistoryRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/whiteboards/$itemId/history",
  params: { parse: (params) => ({ ...params, itemId: z.uuid().parse(params.itemId) }) },
  validateSearch: z.object({ version: z.coerce.number().int().min(1).optional().catch(undefined) }),
  component: lazyRouteComponent(
    () => import("./whiteboards/whiteboard-history-screen.js"),
    "WhiteboardHistoryScreen",
  ),
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
  component: lazyRouteComponent(() => import("./spaces/versions/versions-screen.js"), "VersionsScreen"),
});

const trashRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/trash",
  component: lazyRouteComponent(() => import("./spaces/trash/trash-screen.js"), "TrashScreen"),
});

const reviewsRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/reviews",
  validateSearch: reviewSearch,
  component: lazyRouteComponent(() => import("./knowledge-bases/reviews/review-screen.js"), "ReviewScreen"),
});

const statisticsRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/statistics",
  validateSearch: statisticsSearch,
  component: lazyRouteComponent(
    () => import("./knowledge-bases/statistics/statistics-screen.js"),
    "StatisticsScreen",
  ),
});

const folderRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/folders/$itemId/{-$slug}",
  params: { parse: (params) => ({ ...params, itemId: z.uuid().parse(params.itemId) }) },
  component: lazyRouteComponent(() => import("./spaces/folder-screen.js"), "FolderScreen"),
});

const meetingsRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/meetings",
  component: lazyRouteComponent(() => import("./meetings/series-list-screen.js"), "SeriesListScreen"),
});

const seriesRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/meetings/$seriesId",
  params: { parse: (params) => ({ ...params, seriesId: z.uuid().parse(params.seriesId) }) },
  component: lazyRouteComponent(() => import("./meetings/series-screen.js"), "SeriesScreen"),
});

const topicRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/topics/$topicId",
  params: { parse: (params) => ({ ...params, topicId: z.uuid().parse(params.topicId) }) },
  component: lazyRouteComponent(() => import("./meetings/topic-screen.js"), "TopicScreen"),
});

const labelRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/labels/$label",
  component: lazyRouteComponent(() => import("./spaces/label-screen.js"), "LabelScreen"),
});

const spaceSettingsRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/settings",
  component: lazyRouteComponent(
    () => import("./spaces/settings/space-settings-layout.js"),
    "SpaceSettingsLayout",
  ),
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
  component: lazyRouteComponent(
    () => import("./spaces/settings/space-general-screen.js"),
    "SpaceGeneralScreen",
  ),
});

const spacePermissionsRoute = createRoute({
  getParentRoute: () => spaceSettingsRoute,
  path: "/permissions",
  component: lazyRouteComponent(
    () => import("./spaces/settings/space-permissions-screen.js"),
    "SpacePermissionsScreen",
  ),
});

const spaceAccessRoute = createRoute({
  getParentRoute: () => spaceSettingsRoute,
  path: "/access",
  component: lazyRouteComponent(
    () => import("./spaces/settings/space-access-screen.js"),
    "SpaceAccessScreen",
  ),
});

const spaceContentRoute = createRoute({
  getParentRoute: () => spaceSettingsRoute,
  path: "/content",
  component: lazyRouteComponent(
    () => import("./spaces/settings/space-content-screen.js"),
    "SpaceContentScreen",
  ),
});

const spaceStatusRoute = createRoute({
  getParentRoute: () => spaceSettingsRoute,
  path: "/status",
  component: lazyRouteComponent(
    () => import("./spaces/settings/space-status-screen.js"),
    "SpaceStatusScreen",
  ),
});

const spaceShortcutsRoute = createRoute({
  getParentRoute: () => spaceSettingsRoute,
  path: "/shortcuts",
  component: lazyRouteComponent(
    () => import("./spaces/settings/space-shortcuts-screen.js"),
    "SpaceShortcutsScreen",
  ),
});

const spaceChatRoute = createRoute({
  getParentRoute: () => spaceSettingsRoute,
  path: "/chat",
  component: lazyRouteComponent(() => import("./spaces/settings/space-chat-screen.js"), "SpaceChatScreen"),
});

const spaceExportRoute = createRoute({
  getParentRoute: () => spaceSettingsRoute,
  path: "/export",
  component: lazyRouteComponent(
    () => import("./spaces/settings/space-export-screen.js"),
    "SpaceExportScreen",
  ),
});

const spaceTemplatesRoute = createRoute({
  getParentRoute: () => spaceSettingsRoute,
  path: "/templates",
  component: lazyRouteComponent(
    () => import("./spaces/templates/space-templates-screen.js"),
    "SpaceTemplatesScreen",
  ),
});

const spaceVisibilityRoute = createRoute({
  getParentRoute: () => spaceSettingsRoute,
  path: "/visibility",
  component: lazyRouteComponent(
    () => import("./knowledge-bases/settings/visibility-screen.js"),
    "KnowledgeBaseVisibilityScreen",
  ),
});

const spaceAddressRoute = createRoute({
  getParentRoute: () => spaceSettingsRoute,
  path: "/address",
  component: lazyRouteComponent(
    () => import("./knowledge-bases/settings/address-screen.js"),
    "PortalAddressScreen",
  ),
});

const spaceAppearanceRoute = createRoute({
  getParentRoute: () => spaceSettingsRoute,
  path: "/appearance",
  component: lazyRouteComponent(
    () => import("./knowledge-bases/settings/appearance-screen.js"),
    "PortalAppearanceScreen",
  ),
});

const spaceCategoriesRoute = createRoute({
  getParentRoute: () => spaceSettingsRoute,
  path: "/categories",
  component: lazyRouteComponent(
    () => import("./knowledge-bases/settings/categories-screen.js"),
    "CategoriesScreen",
  ),
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
  component: lazyRouteComponent(
    () => import("./knowledge-bases/settings/portal-accounts-screen.js"),
    "PortalAccountsScreen",
  ),
});

const spaceLanguagesRoute = createRoute({
  getParentRoute: () => spaceSettingsRoute,
  path: "/languages",
  component: lazyRouteComponent(
    () => import("./knowledge-bases/settings/languages-screen.js"),
    "LanguagesScreen",
  ),
});

const spaceReviewSettingsRoute = createRoute({
  getParentRoute: () => spaceSettingsRoute,
  path: "/reviews",
  component: lazyRouteComponent(
    () => import("./knowledge-bases/reviews/review-settings-screen.js"),
    "ReviewSettingsScreen",
  ),
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings",
  component: lazyRouteComponent(() => import("./screens/settings/settings-layout.js"), "SettingsLayout"),
});

const settingsIndexRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/settings/preferences" });
  },
});

const preferencesRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/preferences",
  component: lazyRouteComponent(() => import("./screens/account/preferences-screen.js"), "PreferencesScreen"),
});

const securityRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/security",
  component: lazyRouteComponent(() => import("./screens/account/security-screen.js"), "SecurityScreen"),
});

const exportsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/exports",
  component: lazyRouteComponent(() => import("./exports/exports-screen.js"), "ExportsScreen"),
});

const watchedItemsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/notifications/watching",
  component: lazyRouteComponent(
    () => import("./screens/account/watched-items-screen.js"),
    "WatchedItemsScreen",
  ),
});

const notificationSettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/notifications",
  component: lazyRouteComponent(
    () => import("./screens/account/notification-preferences-screen.js"),
    "NotificationPreferencesScreen",
  ),
});

const organizationRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/organizations/$organizationId",
  params: { parse: (params) => ({ organizationId: z.uuid().parse(params.organizationId) }) },
});

const organizationIndexRoute = createRoute({
  getParentRoute: () => organizationRoute,
  path: "/",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/settings/organizations/$organizationId/general", params });
  },
});

function organizationScreen<TPath extends string>(
  path: TPath,
  load: () => Promise<Record<string, unknown>>,
  name: string,
) {
  return createRoute({
    getParentRoute: () => organizationRoute,
    path,
    component: lazyRouteComponent(load as never, name as never),
  });
}

const organizationGeneralRoute = organizationScreen(
  "/general",
  () => import("./screens/organization/general-screen.js"),
  "OrganizationGeneralScreen",
);
const membersRoute = organizationScreen(
  "/members",
  () => import("./screens/organization/members-screen.js"),
  "MembersScreen",
);
const groupsRoute = organizationScreen(
  "/groups",
  () => import("./screens/organization/groups-screen.js"),
  "GroupsScreen",
);
const groupRoute = organizationScreen(
  "/groups/$groupId",
  () => import("./screens/organization/group-screen.js"),
  "GroupScreen",
);
const rolesRoute = organizationScreen(
  "/roles",
  () => import("./screens/organization/roles-screen.js"),
  "OrganizationRolesScreen",
);
const serviceAccountsRoute = organizationScreen(
  "/service-accounts",
  () => import("./screens/organization/service-accounts-screen.js"),
  "ServiceAccountsScreen",
);
const serviceAccountRoute = organizationScreen(
  "/service-accounts/$serviceAccountId",
  () => import("./screens/organization/service-account-screen.js"),
  "ServiceAccountScreen",
);
const organizationTokensRoute = organizationScreen(
  "/api-tokens",
  () => import("./screens/organization/api-tokens-screen.js"),
  "OrganizationTokensScreen",
);
const organizationSecurityRoute = organizationScreen(
  "/security",
  () => import("./screens/organization/security-screen.js"),
  "OrganizationSecurityScreen",
);
const domainsRoute = organizationScreen(
  "/domains-and-guests",
  () => import("./screens/organization/domains-screen.js"),
  "DomainsScreen",
);
const organizationNotificationsRoute = organizationScreen(
  "/notifications",
  () => import("./screens/organization/notification-defaults-screen.js"),
  "OrganizationNotificationDefaultsScreen",
);
const organizationAnnouncementsRoute = organizationScreen(
  "/announcements",
  () => import("./screens/organization/announcements-screen.js"),
  "OrganizationAnnouncementsScreen",
);
const organizationSpacesRoute = organizationScreen(
  "/spaces",
  () => import("./spaces/settings/organization-spaces-screen.js"),
  "OrganizationSpacesScreen",
);
const organizationContentRoute = organizationScreen(
  "/content",
  () => import("./spaces/settings/organization-content-screen.js"),
  "OrganizationContentScreen",
);
const organizationTemplatesRoute = organizationScreen(
  "/templates",
  () => import("./spaces/templates/organization-templates-screen.js"),
  "OrganizationTemplatesScreen",
);
const organizationAccessRoute = organizationScreen(
  "/access",
  () => import("./screens/organization/access-overview-screen.js"),
  "AccessOverviewScreen",
);

const importsRoute = organizationScreen(
  "/imports",
  () => import("./imports/imports-screen.js"),
  "ImportsScreen",
);
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

const organizationAuditRoute = organizationScreen(
  "/audit-log",
  () => import("./screens/organization/audit-screen.js"),
  "OrganizationAuditScreen",
);

const instanceRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/instance",
});

function instanceScreen<TPath extends string>(
  path: TPath,
  load: () => Promise<Record<string, unknown>>,
  name: string,
) {
  return createRoute({
    getParentRoute: () => instanceRoute,
    path,
    component: lazyRouteComponent(load as never, name as never),
  });
}

const instanceIndexRoute = createRoute({
  getParentRoute: () => instanceRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/settings/instance/general" });
  },
});
const instanceStatusRoute = instanceScreen(
  "/status",
  () => import("./screens/instance/status-screen.js"),
  "InstanceStatusScreen",
);
const instanceUpdatesRoute = instanceScreen(
  "/updates",
  () => import("./screens/instance/updates-screen.js"),
  "InstanceUpdatesScreen",
);
const instanceMaintenanceRoute = instanceScreen(
  "/maintenance",
  () => import("./screens/instance/maintenance-screen.js"),
  "InstanceMaintenanceScreen",
);
const instanceGeneralRoute = instanceScreen(
  "/general",
  () => import("./screens/instance/general-screen.js"),
  "InstanceGeneralScreen",
);
const instanceOrganizationsRoute = instanceScreen(
  "/organizations",
  () => import("./screens/instance/organizations-screen.js"),
  "InstanceOrganizationsScreen",
);
const instanceAccountsRoute = instanceScreen(
  "/accounts",
  () => import("./screens/instance/accounts-screen.js"),
  "InstanceAccountsScreen",
);
const instanceRolesRoute = instanceScreen(
  "/roles",
  () => import("./screens/instance/roles-screen.js"),
  "InstanceRolesScreen",
);
const instanceSecurityRoute = instanceScreen(
  "/security",
  () => import("./screens/instance/security-screen.js"),
  "InstanceSecurityScreen",
);
const instanceProvidersRoute = instanceScreen(
  "/sign-in-providers",
  () => import("./screens/identity/providers-screen.js"),
  "InstanceProvidersScreen",
);
const instanceNewProviderRoute = createRoute({
  getParentRoute: () => instanceRoute,
  path: "/sign-in-providers/new",
  validateSearch: wizardSearch,
  component: lazyRouteComponent(
    () => import("./screens/identity/provider-wizard-screen.js"),
    "InstanceProviderWizardScreen",
  ),
});
const instanceProviderRoute = createRoute({
  getParentRoute: () => instanceRoute,
  path: "/sign-in-providers/$providerId",
  validateSearch: providerSearch,
  component: lazyRouteComponent(
    () => import("./screens/identity/provider-screen.js"),
    "InstanceProviderScreen",
  ),
});
const instanceEmbedsRoute = instanceScreen(
  "/embeds",
  () => import("./screens/instance/embeds-screen.js"),
  "InstanceEmbedsScreen",
);
const instancePortalsRoute = instanceScreen(
  "/portals",
  () => import("./screens/instance/portals-screen.js"),
  "InstancePortalsScreen",
);
const instanceRenderingRoute = instanceScreen(
  "/rendering",
  () => import("./screens/instance/rendering-screen.js"),
  "InstanceRenderingScreen",
);
const instanceMailRoute = instanceScreen(
  "/mail",
  () => import("./screens/instance/mail-screen.js"),
  "InstanceMailScreen",
);
const instanceStorageRoute = instanceScreen(
  "/storage",
  () => import("./screens/instance/storage-screen.js"),
  "InstanceStorageScreen",
);
const instanceBackupsRoute = instanceScreen(
  "/backups",
  () => import("./screens/instance/backups-screen.js"),
  "InstanceBackupsScreen",
);
const breakGlassRoute = instanceScreen(
  "/break-glass",
  () => import("./screens/instance/break-glass-screen.js"),
  "BreakGlassScreen",
);
const instanceNotificationsRoute = instanceScreen(
  "/notifications",
  () => import("./screens/instance/notification-defaults-screen.js"),
  "InstanceNotificationDefaultsScreen",
);
const instanceAnnouncementsRoute = instanceScreen(
  "/announcements",
  () => import("./screens/instance/announcements-screen.js"),
  "InstanceAnnouncementsScreen",
);
const instancePersonalSpacesRoute = instanceScreen(
  "/personal-spaces",
  () => import("./spaces/settings/instance-personal-spaces-screen.js"),
  "InstancePersonalSpacesScreen",
);
const instanceContentRoute = instanceScreen(
  "/content",
  () => import("./spaces/settings/instance-content-screen.js"),
  "InstanceContentScreen",
);
const instanceTemplatesRoute = instanceScreen(
  "/templates",
  () => import("./spaces/templates/instance-templates-screen.js"),
  "InstanceTemplatesScreen",
);
const instanceAuditRoute = instanceScreen(
  "/audit-log",
  () => import("./screens/instance/audit-screen.js"),
  "InstanceAuditScreen",
);

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
    homeRoute,
    forYouRoute,
    openNotificationRoute,
    searchRoute,
    myTasksRoute,
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
      preferencesRoute,
      securityRoute,
      notificationSettingsRoute,
      watchedItemsRoute,
      exportsRoute,
      organizationRoute.addChildren([
        organizationIndexRoute,
        organizationGeneralRoute,
        membersRoute,
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
