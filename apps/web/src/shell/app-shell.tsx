import { Notice, Rail } from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, Outlet, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { providersQuery, signInSecurityQuery } from "../api/identity-queries.js";
import { request } from "../api/request.js";
import { NotificationPanel } from "../notifications/notification-panel.js";
import { useNotificationStream } from "../notifications/notifications-api.js";
import { preferenceKeys, useUpdatePreference } from "../preferences/preferences.js";
import { useFormat, usePreferences } from "../preferences/preferences-provider.js";
import "../notifications/builtin.js";
import "./builtin.js";
import { signedOut } from "../session/sign-out.js";
import { CommandPaletteHost } from "./command-palette.js";
import { railItems, type ShellContext, type Shortcut, shortcuts } from "./extensions.js";
import { Heron } from "./heron.js";
import { createSequenceMatcher, isTypingTarget, keyName } from "./keyboard.js";
import { useNavigationFocus } from "./navigation-focus.js";
import { useRegistry } from "./registry.js";
import { type ShellState, ShellStateContext } from "./shell.js";
import { OrganizationProvider, useOrganizationState } from "./shell-context.js";
import { ShortcutsDialog } from "./shortcuts-dialog.js";

const route = getRouteApi("/app");

export function AppShell() {
  const { session } = route.useRouteContext();
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const allShortcuts = useRegistry(shortcuts);
  const registeredShortcuts = useMemo(
    () => allShortcuts.filter((shortcut) => !shortcut.listOnly),
    [allShortcuts],
  );
  const items = useRegistry(railItems);

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
      openCommandPalette: () => setPaletteOpen(true),
      openShortcuts: () => setShortcutsOpen(true),
      toggleNotifications: () => setNotificationsOpen((open) => !open),
      toggleSidebar: () =>
        updatePreference.mutate({
          key: preferenceKeys.sidebarCollapsed,
          value: !preferences.sidebarCollapsed,
        }),
      signOut,
      notificationsOpen,
      sidebarCollapsed: preferences.sidebarCollapsed,
    }),
    [organization, router, updatePreference, preferences.sidebarCollapsed, signOut, notificationsOpen],
  );

  useGlobalShortcuts(state, registeredShortcuts);
  useNavigationFocus();
  useNotificationStream(true);

  return (
    <ShellStateContext value={state}>
      <div className="flex h-full bg-bg text-text">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:p-2 focus:shadow-popover"
        >
          {t("shell.skipToContent")}
        </a>
        <Rail
          label={t("rail.label")}
          logo={
            <Link
              to="/"
              aria-label={t("rail.home")}
              className="flex size-10 items-center justify-center rounded-md text-accent focus-visible:outline-2 focus-visible:outline-accent"
            >
              <Heron className="size-8" />
            </Link>
          }
          footer={items
            .filter((item) => item.placement === "footer")
            .map((item) => <item.component key={item.id} />)}
        >
          {items
            .filter((item) => item.placement === "main")
            .map((item) => (
              <item.component key={item.id} />
            ))}
        </Rail>
        {notificationsOpen ? <NotificationPanel onClose={() => setNotificationsOpen(false)} /> : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <InsecureProvidersBanner />
          <MissingGroupsBanner />
          <WithoutOrganizationBanner />
          <WithheldRolesBanner />
          <div className="flex min-w-0 flex-1">
            <Outlet />
          </div>
        </div>
      </div>
      <CommandPaletteHost open={paletteOpen} onOpenChange={setPaletteOpen} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </ShellStateContext>
  );
}

function WithoutOrganizationBanner() {
  const { t } = useTranslation();
  const state = useOrganizationState();
  const account = state.session.account;
  if (account?.type !== "standard" || !state.permissionsLoaded || state.organizations.length > 0) {
    return null;
  }
  return (
    <div className="px-4 pt-3">
      <Notice variant="info" title={t("shell.withoutOrganization.title")}>
        {t("shell.withoutOrganization.description")}
      </Notice>
    </div>
  );
}

function WithheldRolesBanner() {
  const { t } = useTranslation();
  const withheld = useQuery({
    queryKey: ["account", "withheldRoles"],
    queryFn: () => request(() => api.GET("/api/v1/account/withheld-roles")),
    throwOnError: false,
    staleTime: 60_000,
  });
  const first = withheld.data?.[0];
  if (!first) return null;
  return (
    <div className="px-4 pt-3">
      <Notice variant="warning" title={t("shell.withheldRoles.title", { count: withheld.data?.length ?? 0 })}>
        {t("shell.withheldRoles.description", { provider: first.providerName })}
      </Notice>
    </div>
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
    <div className="px-4 pt-3">
      {affected.map((provider) => (
        <Notice
          key={provider.id}
          variant="warning"
          title={t("shell.groupsClaimMissing.title", {
            provider: provider.name,
            since: format.dateTime(provider.groupsClaimMissingSince ?? ""),
          })}
        >
          {t("shell.groupsClaimMissing.description")}
        </Notice>
      ))}
    </div>
  );
}

function InsecureProvidersBanner() {
  const { t } = useTranslation();
  const state = useOrganizationState();
  const allowed = state.can("instance.signIn.view");
  const security = useQuery({ ...signInSecurityQuery, enabled: allowed, throwOnError: false });
  if (!allowed || !security.data?.insecureIdentityProviders) return null;
  return (
    <div className="px-4 pt-3">
      <Notice variant="warning" title={t("shell.insecureProviders.title")}>
        {t("shell.insecureProviders.description")}
      </Notice>
    </div>
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
