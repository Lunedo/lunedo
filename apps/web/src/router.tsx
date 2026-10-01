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
import { RootLayout } from "./root-layout.js";
import { safeRedirect } from "./session/redirect.js";

export interface RouterContext {
  queryClient: QueryClient;
}

const redirectSearch = z.object({ redirect: z.string().optional() });

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

const publicRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "public",
  beforeLoad: ({ context }) => requireSetupComplete(context.queryClient),
  component: lazyRouteComponent(() => import("./screens/auth/auth-layout.js"), "AuthLayout"),
});

const signInRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/sign-in",
  validateSearch: redirectSearch.extend({ reason: z.enum(["sessionEnded", "signedOut"]).optional() }),
  beforeLoad: async ({ context, search }) => {
    const session = await context.queryClient.fetchQuery(sessionQuery);
    if (session?.sessionKind === "full") throw redirect({ href: safeRedirect(search.redirect) });
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

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: async ({ context, location }) => {
    await requireSetupComplete(context.queryClient);
    const session = await context.queryClient.fetchQuery(sessionQuery);
    if (!session) throw redirect({ to: "/sign-in", search: { redirect: location.href } });
    if (session.sessionKind === "secondFactorSetup") throw redirect({ to: "/second-factor-setup" });
    return { session };
  },
  component: lazyRouteComponent(() => import("./shell/app-shell.js"), "AppShell"),
});

const homeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/settings/preferences" });
  },
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
const instanceMailRoute = instanceScreen(
  "/mail",
  () => import("./screens/instance/mail-screen.js"),
  "InstanceMailScreen",
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
  publicRoute.addChildren([
    signInRoute,
    verifyRoute,
    resetPasswordRoute,
    confirmEmailRoute,
    acceptInvitationRoute,
    registerRoute,
    completeRegistrationRoute,
    secondFactorSetupRoute,
  ]),
  appRoute.addChildren([
    homeRoute,
    settingsRoute.addChildren([
      settingsIndexRoute,
      preferencesRoute,
      securityRoute,
      notificationSettingsRoute,
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
        organizationAuditRoute,
      ]),
      instanceRoute.addChildren([
        instanceIndexRoute,
        instanceGeneralRoute,
        instanceOrganizationsRoute,
        instanceAccountsRoute,
        instanceRolesRoute,
        instanceSecurityRoute,
        instanceMailRoute,
        breakGlassRoute,
        instanceNotificationsRoute,
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
