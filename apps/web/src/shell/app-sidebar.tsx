import { classNames, Icon, RailButton, SidebarGroup, SidebarItem } from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { Home, Layers, ListChecks, type LucideIcon, User } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { starredQuery, tasksQuery } from "../collaboration/queries.js";
import { recentlyViewedQuery } from "../search/search-api.js";
import { SpaceBadge } from "../spaces/space-badge.js";
import { spaceByKeyQuery } from "../spaces/space-queries.js";
import { useShell } from "./shell.js";
import { useOrganizationState, useSession } from "./shell-context.js";
import { useSidebarSlots } from "./sidebar-slot.js";
import { SpacesEntry, SpacesPanel } from "./spaces-panel.js";

const SIDEBAR_SPACES = 7;

export const OPEN_TASKS_QUERY = { assignee: "me", status: "open", due: "any", limit: 200 } as const;

export interface SidebarEntryProps {
  to: string;
  params?: Record<string, string>;
  icon: LucideIcon;
  label: string;
  current: boolean;
  collapsed: boolean;
  badge?: ReactNode;
  badgeLabel?: string;
  leading?: ReactNode;
}

export function SidebarEntry({
  to,
  params,
  icon,
  label,
  current,
  collapsed,
  badge,
  badgeLabel,
  leading,
}: SidebarEntryProps) {
  const link = <Link to={to as never} {...(params ? { params: params as never } : {})} />;
  if (collapsed) {
    return (
      <RailButton label={badgeLabel ?? label} icon={<Icon icon={icon} size="md" />} current={current} asChild>
        {link}
      </RailButton>
    );
  }
  if (leading) {
    return (
      <li>
        <Link
          to={to as never}
          {...(params ? { params: params as never } : {})}
          aria-current={current ? "page" : undefined}
          className={classNames(
            "flex h-row items-center gap-2 rounded-sm px-2 transition-colors focus-visible:focus-ring motion-reduce:transition-none",
            current ? "bg-accent font-semibold text-on-accent" : "text-text hover:bg-hover",
          )}
          title={label}
        >
          {leading}
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </Link>
      </li>
    );
  }
  return (
    <SidebarItem
      icon={icon}
      label={label}
      current={current}
      asChild
      {...(badge !== undefined ? { badge } : {})}
    >
      {link}
    </SidebarItem>
  );
}

function TasksEntry({ collapsed, current }: { collapsed: boolean; current: boolean }) {
  const { t } = useTranslation();
  const tasks = useQuery({ ...tasksQuery(OPEN_TASKS_QUERY), throwOnError: false, staleTime: 60_000 });
  const count = tasks.data?.items.length ?? 0;
  const shown = count > 99 || tasks.data?.nextCursor ? "99+" : String(count);
  return (
    <SidebarEntry
      to="/tasks"
      icon={ListChecks}
      label={t("rail.tasks")}
      current={current}
      collapsed={collapsed}
      {...(count > 0 ? { badge: shown, badgeLabel: t("sidebar.tasksOpen", { count, shown }) } : {})}
    />
  );
}

const SPACE_PATH = /^\/spaces\/([^/?#]+)/;

function useInOwnPersonalSpace(): boolean {
  const location = useLocation();
  const session = useSession();
  const match = SPACE_PATH.exec(location.pathname);
  const key = match?.[1] ? decodeURIComponent(match[1]) : null;
  const space = useQuery({ ...spaceByKeyQuery(key ?? ""), enabled: key !== null, throwOnError: false });
  const found = space.data?.space;
  return (
    location.pathname === "/personal-space" ||
    (found !== undefined && found.personal && found.ownerId === session.account?.id)
  );
}

function PersonalSpaceEntry({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation();
  const organization = useOrganizationState();
  const current = useInOwnPersonalSpace();
  const guest = organization.organization?.membershipKind === "guest";
  if (guest || !organization.can("instance.personalSpace.use")) return null;
  return (
    <SidebarEntry
      to="/personal-space"
      icon={User}
      label={t("sidebar.mySpace")}
      current={current}
      collapsed={collapsed}
    />
  );
}

function SpacesNavigation({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation();
  const starred = useQuery({ ...starredQuery(), throwOnError: false });
  const recent = useQuery({ ...recentlyViewedQuery, throwOnError: false });
  const favorites = (starred.data?.spaces ?? []).slice(0, SIDEBAR_SPACES);
  const favoriteKeys = new Set(favorites.map((space) => space.key));
  const visited: { key: string; name: string }[] = [];
  for (const item of recent.data ?? []) {
    if (favoriteKeys.has(item.spaceKey) || visited.some((space) => space.key === item.spaceKey)) continue;
    visited.push({ key: item.spaceKey, name: item.spaceName });
  }
  const recentSpaces = visited.slice(0, Math.max(0, SIDEBAR_SPACES - favorites.length));
  const entry = (space: { key: string; name: string; personal: boolean }) => (
    <SidebarEntry
      key={space.key}
      to="/spaces/$spaceKey"
      params={{ spaceKey: space.key }}
      icon={Layers}
      label={space.name || t("spaces.personal.label")}
      current={false}
      collapsed={collapsed}
      leading={<SpaceBadge space={space} size="sm" />}
    />
  );
  return (
    <div className="flex flex-col gap-1">
      {!collapsed && favorites.length > 0 ? (
        <SidebarGroup label={t("sidebar.favorites")}>{favorites.map(entry)}</SidebarGroup>
      ) : null}
      {!collapsed && recentSpaces.length > 0 ? (
        <SidebarGroup label={t("sidebar.recentSpaces")}>
          {recentSpaces.map((space) => entry({ ...space, personal: false }))}
        </SidebarGroup>
      ) : null}
    </div>
  );
}

export function AppSidebar() {
  const { t } = useTranslation();
  const shell = useShell();
  const location = useLocation();
  const { setMiddle, setBottom, claimed } = useSidebarSlots();
  const overlay = shell.mobileSidebarOpen;
  const collapsed = shell.sidebarCollapsed && !overlay;
  const navigation = useRef<HTMLElement>(null);
  const homeActive = location.pathname === "/home" || location.pathname === "/blog";
  const tasksActive = location.pathname === "/tasks";
  const { closeMobileSidebar } = shell;
  const [spacesOpen, setSpacesOpen] = useState(false);
  const spacesEntry = useRef<HTMLButtonElement>(null);
  const spacesPanelId = useId();
  const closeSpaces = useCallback((returnFocus: boolean) => {
    setSpacesOpen(false);
    if (returnFocus) spacesEntry.current?.focus();
  }, []);

  useEffect(() => {
    if (location.pathname) setSpacesOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (location.pathname) closeMobileSidebar();
  }, [location.pathname, closeMobileSidebar]);

  useEffect(() => {
    if (!overlay) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const nav = navigation.current;
    nav?.querySelector<HTMLElement>("a, button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeMobileSidebar();
      opener?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [overlay, closeMobileSidebar]);

  return (
    <>
      {overlay ? (
        <button
          type="button"
          aria-label={t("sidebar.close")}
          tabIndex={-1}
          onClick={closeMobileSidebar}
          className="fixed inset-0 z-30 bg-overlay md:hidden"
        />
      ) : null}
      <nav
        ref={navigation}
        aria-label={t("rail.label")}
        data-collapsed={collapsed || undefined}
        className={classNames(
          "shrink-0 flex-col border-r border-border bg-sidebar",
          overlay
            ? "fixed inset-y-0 left-0 z-40 flex w-sidebar shadow-dialog md:static md:shadow-none"
            : "relative hidden md:flex",
          collapsed ? "w-rail items-center" : "w-sidebar",
        )}
      >
        <ul className={classNames("flex flex-col gap-px py-3", collapsed ? "items-center" : "px-3")}>
          <SidebarEntry
            to="/home"
            icon={Home}
            label={t("rail.forYou")}
            current={homeActive}
            collapsed={collapsed}
          />
          <TasksEntry collapsed={collapsed} current={tasksActive} />
          <PersonalSpaceEntry collapsed={collapsed} />
          <SpacesEntry
            collapsed={collapsed}
            open={spacesOpen}
            onToggle={() => setSpacesOpen((open) => !open)}
            entryRef={spacesEntry}
            panelId={spacesPanelId}
          />
        </ul>
        {spacesOpen ? <SpacesPanel id={spacesPanelId} onClose={closeSpaces} entryRef={spacesEntry} /> : null}
        <div className="w-full border-t border-border" />
        <div
          className={classNames(
            "flex min-h-0 w-full flex-1 flex-col overflow-y-auto",
            collapsed ? "items-center py-3" : "px-3 pb-3",
          )}
        >
          <div ref={setMiddle} className="contents" />
          {claimed ? null : <SpacesNavigation collapsed={collapsed} />}
        </div>
        {claimed ? (
          <div
            className={classNames(
              "w-full border-t border-border py-3",
              collapsed ? "flex justify-center" : "px-3",
            )}
          >
            <div ref={setBottom} className="contents" />
          </div>
        ) : null}
      </nav>
    </>
  );
}
