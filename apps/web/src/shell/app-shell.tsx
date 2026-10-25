import { Notice } from "@lunedo/ui";
import { queryOptions, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Outlet, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { providersQuery, signInSecurityQuery } from "../api/identity-queries.js";
import { request } from "../api/request.js";
import { useNotificationStream } from "../notifications/notifications-api.js";
import { preferenceKeys, useUpdatePreference } from "../preferences/preferences.js";
import { useFormat, usePreferences } from "../preferences/preferences-provider.js";
import "../notifications/browser-push.js";
import "../notifications/builtin.js";
import "./builtin.js";
import { maintenanceQuery } from "../api/maintenance.js";
import { PortalAccountHome } from "../knowledge-bases/portal-account-home.js";
import { QuickSearchHost } from "../search/quick-search.js";
import { signedOut } from "../session/sign-out.js";
import { AnnouncementBanners, shownAnnouncementsQuery } from "./announcement-banners.js";
import { AppSidebar } from "./app-sidebar.js";
import { type ShellContext, type Shortcut, shortcuts } from "./extensions.js";
import { createSequenceMatcher, isTypingTarget, keyName } from "./keyboard.js";
import { MaintenanceBanner } from "./maintenance-banner.js";
import { useNavigationFocus } from "./navigation-focus.js";
import { NavigationProgress, useShownLocation } from "./navigation-pending.js";
import { useRegistry } from "./registry.js";
import {
  type CreateKind,
  type SettingsReturn,
  type ShellState,
  ShellStateContext,
  type SpaceCreateTarget,
} from "./shell.js";
import { ShellBanner } from "./shell-banner.js";
import { OrganizationProvider, useOrganizationState } from "./shell-context.js";
import { ShortcutsDialog } from "./shortcuts-dialog.js";
import { SidebarSlotProvider, useSidebarSlotState } from "./sidebar-slot.js";
import { DESKTOP_QUERY, TopBar } from "./top-bar.js";

const SETTINGS_PATH = /^\/(settings|spaces\/[^/]+\/settings)(\/|$)/;
const SPACE_PATH = /^\/spaces\/([^/?#]+)/;
const HOME_RETURN: SettingsReturn = { href: "/home", spaceKey: null };

function isDesktop(): boolean {
  return globalThis.matchMedia?.(DESKTOP_QUERY).matches ?? true;
}

const route = getRouteApi("/app");

export function AppShell() {
  const { session } = route.useRouteContext();
  if (session.account?.type === "portal") return <PortalAccountHome />;
  return (
    <OrganizationProvider session={session}>
      <ShellFrame />
    </OrganizationProvider>
  );
}

function ShellFrame() {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const organization = useOrganizationState();
  const preferences = usePreferences();
  const updatePreference = useUpdatePreference();
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const allShortcuts = useRegistry(shortcuts);
  const registeredShortcuts = useMemo(
    () => allShortcuts.filter((shortcut) => !shortcut.listOnly),
    [allShortcuts],
  );
  const location = useShownLocation();
  const sidebarSlots = useSidebarSlotState();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [collapseSuggested, setCollapseSuggested] = useState(false);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [spaceCreateTarget, setSpaceCreateTarget] = useState<SpaceCreateTarget | null>(null);
  const [pendingCreate, setPendingCreate] = useState<{ spaceKey: string; kind: CreateKind } | null>(null);
  const suggestionApplies = collapseSuggested && !suggestionDismissed && !preferences.sidebarCollapsed;
  const inSettings = SETTINGS_PATH.test(location.pathname);
  const [settingsNavigationHidden, setSettingsNavigationHidden] = useState(false);
  const [settingsReturn, setSettingsReturn] = useState<SettingsReturn>(HOME_RETURN);
  const sidebarCollapsed = inSettings
    ? settingsNavigationHidden
    : editMode
      ? preferences.sidebarCollapsedWhileEditing
      : preferences.sidebarCollapsed || suggestionApplies;
  const closeMobileSidebar = useCallback(() => setMobileSidebarOpen(false), []);
  const suggestCollapsedSidebar = useCallback((suggested: boolean) => {
    setCollapseSuggested(suggested);
    if (!suggested) setSuggestionDismissed(false);
  }, []);
  const appHref = inSettings ? null : location.href;
  useEffect(() => {
    if (appHref === null) return;
    setSettingsNavigationHidden(false);
    const key = SPACE_PATH.exec(appHref)?.[1];
    setSettingsReturn({ href: appHref, spaceKey: key ? decodeURIComponent(key) : null });
  }, [appHref]);

  const signOut = useCallback(() => {
    void request(() => api.POST("/api/v1/auth/sign-out"), { sessionHandling: false })
      .catch(() => undefined)
      .then(async () => {
        signedOut();
        queryClient.clear();
        await router.navigate({ to: "/sign-in", search: { reason: "signedOut" } });
      });
  }, [queryClient, router]);

  const state = useMemo<ShellState>(
    () => ({
      organizationId: organization.organizationId,
      can: organization.can,
      navigate: (to, params) => void router.navigate({ to: to as never, params: params as never }),
      openCommandPalette: () => setSearchOpen(true),
      openSearch: () => setSearchOpen(true),
      openShortcuts: () => setShortcutsOpen(true),
      toggleNotifications: () => setNotificationsOpen((open) => !open),
      toggleSidebar: () => {
        if (!isDesktop()) {
          setMobileSidebarOpen((open) => !open);
          return;
        }
        if (inSettings) {
          setSettingsNavigationHidden((hidden) => !hidden);
          return;
        }
        if (editMode) {
          updatePreference.mutate({
            key: preferenceKeys.sidebarCollapsedWhileEditing,
            value: !preferences.sidebarCollapsedWhileEditing,
          });
          return;
        }
        if (suggestionApplies) {
          setSuggestionDismissed(true);
          return;
        }
        updatePreference.mutate({
          key: preferenceKeys.sidebarCollapsed,
          value: !preferences.sidebarCollapsed,
        });
      },
      signOut,
      notificationsOpen,
      sidebarCollapsed,
      settingsReturn,
      mobileSidebarOpen,
      closeMobileSidebar,
      suggestCollapsedSidebar,
      editMode,
      setEditMode,
      spaceCreateTarget,
      setSpaceCreateTarget,
      pendingCreate,
      requestCreate: (spaceKey, kind) => setPendingCreate({ spaceKey, kind }),
      clearPendingCreate: () => setPendingCreate(null),
    }),
    [
      organization,
      router,
      updatePreference,
      preferences.sidebarCollapsed,
      preferences.sidebarCollapsedWhileEditing,
      editMode,
      signOut,
      notificationsOpen,
      sidebarCollapsed,
      settingsReturn,
      inSettings,
      suggestionApplies,
      mobileSidebarOpen,
      closeMobileSidebar,
      suggestCollapsedSidebar,
      spaceCreateTarget,
      pendingCreate,
    ],
  );

  useGlobalShortcuts(state, registeredShortcuts);
  useNavigationFocus();
  useNotificationStream(true);
  const settled = useShellSettled();
  if (!settled) return <ShellPlaceholder collapsed={sidebarCollapsed} />;

  return (
    <ShellStateContext value={state}>
      <SidebarSlotProvider value={sidebarSlots}>
        <div className="relative flex h-full flex-col overflow-hidden bg-bg text-text">
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:p-2 focus:shadow-popover"
          >
            {t("shell.skipToContent")}
          </a>
          <TopBar />
          <MaintenanceBanner />
          <AnnouncementBanners />
          <InsecureProvidersBanner />
          <MissingGroupsBanner />
          <WithheldRolesBanner />
          <div className="relative flex min-h-0 min-w-0 flex-1">
            {inSettings ? null : <AppSidebar />}
            <div data-content-area="" className="relative flex min-h-0 min-w-0 flex-1">
              <NavigationProgress />
              <Outlet />
            </div>
          </div>
        </div>
        <QuickSearchHost open={searchOpen} onOpenChange={setSearchOpen} />
        <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      </SidebarSlotProvider>
    </ShellStateContext>
  );
}

export const withheldRolesQuery = queryOptions({
  queryKey: ["account", "withheldRoles"],
  queryFn: () => request(() => api.GET("/api/v1/account/withheld-roles")),
  staleTime: 60_000,
});

function useShellSettled(): boolean {
  const organization = useOrganizationState();
  const adminBanners = organization.can("instance.signIn.view");
  const banners = useQueries({
    queries: [
      { ...maintenanceQuery, retry: false },
      shownAnnouncementsQuery,
      withheldRolesQuery,
      { ...providersQuery, enabled: adminBanners },
      { ...signInSecurityQuery, enabled: adminBanners },
    ].map((query) => ({ ...query, throwOnError: false })),
  });
  const settled =
    organization.settled && banners.every((banner) => banner.fetchStatus === "idle" || !banner.isPending);
  const [shown, setShown] = useState(settled);
  if (settled && !shown) setShown(true);
  return shown || settled;
}

export function ShellPending() {
  const preferences = usePreferences();
  return <ShellPlaceholder collapsed={preferences.sidebarCollapsed} />;
}

function ShellPlaceholder({ collapsed }: { collapsed: boolean }) {
  return (
    <div aria-busy="true" className="flex h-full flex-col bg-bg">
      <div className="h-toolbar shrink-0 border-b border-border" />
      <div className="flex min-h-0 flex-1">
        <div
          className={`hidden shrink-0 border-r border-border bg-sidebar md:block ${collapsed ? "w-rail" : "w-sidebar"}`}
        />
      </div>
    </div>
  );
}

export function WithoutOrganizationNotice() {
  const { t } = useTranslation();
  const state = useOrganizationState();
  const account = state.session.account;
  if (account?.type !== "standard" || !state.permissionsLoaded || state.organizations.length > 0) {
    return null;
  }
  return (
    <Notice variant="info" title={t("shell.withoutOrganization.title")}>
      {t("shell.withoutOrganization.description")}
    </Notice>
  );
}

function WithheldRolesBanner() {
  const { t } = useTranslation();
  const withheld = useQuery({ ...withheldRolesQuery, throwOnError: false });
  const first = withheld.data?.[0];
  if (!first) return null;
  return (
    <ShellBanner
      variant="warning"
      title={t("shell.withheldRoles.title", { count: withheld.data?.length ?? 0 })}
    >
      {t("shell.withheldRoles.description", { provider: first.providerName })}
    </ShellBanner>
  );
}

function MissingGroupsBanner() {
  const { t } = useTranslation();
  const format = useFormat();
  const state = useOrganizationState();
  const allowed = state.can("instance.signIn.view");
  const providers = useQuery({ ...providersQuery, enabled: allowed, throwOnError: false });
  const affected = (providers.data ?? []).filter(
    (provider) =>
      provider.groupsClaimMissingSince !== null && provider.warnings.includes("groupsClaimMissing"),
  );
  if (!allowed || affected.length === 0) return null;
  return (
    <>
      {affected.map((provider) => (
        <ShellBanner
          key={provider.id}
          variant="warning"
          title={t("shell.groupsClaimMissing.title", {
            provider: provider.name,
            since: format.shortDateTime(provider.groupsClaimMissingSince ?? ""),
          })}
        >
          {t("shell.groupsClaimMissing.description")}
        </ShellBanner>
      ))}
    </>
  );
}

function InsecureProvidersBanner() {
  const { t } = useTranslation();
  const state = useOrganizationState();
  const allowed = state.can("instance.signIn.view");
  const security = useQuery({ ...signInSecurityQuery, enabled: allowed, throwOnError: false });
  if (!allowed || !security.data?.insecureIdentityProviders) return null;
  return (
    <ShellBanner variant="warning" title={t("shell.insecureProviders.title")}>
      {t("shell.insecureProviders.description")}
    </ShellBanner>
  );
}

function useGlobalShortcuts(context: ShellContext, list: readonly Shortcut[]) {
  const contextRef = useRef(context);
  useEffect(() => {
    contextRef.current = context;
  });
  useEffect(() => {
    const matcher = createSequenceMatcher(list.map((shortcut) => shortcut.keys));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const name = keyName(event);
      const global = name.startsWith("mod+");
      if (!global && isTypingTarget(event.target)) return;
      if (["Shift", "Control", "Meta", "Alt"].includes(event.key)) return;
      const matched = matcher.press(name);
      if (!matched) return;
      const shortcut = list.find(
        (candidate) =>
          candidate.keys.length === matched.length &&
          candidate.keys.every((key, index) => key === matched[index]),
      );
      if (!shortcut) return;
      event.preventDefault();
      shortcut.run(contextRef.current);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [list]);
}
