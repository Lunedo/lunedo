import { tokens } from "@lunedo/tokens";
import { Menu, RailButton } from "@lunedo/ui";
import { Link, useLocation } from "@tanstack/react-router";
import {
  Bell,
  BookOpen,
  Building2,
  CircleHelp,
  Home,
  Keyboard,
  Layers,
  LifeBuoy,
  ListChecks,
  type LucideIcon,
  Search,
  Server,
  Settings,
  UserRound,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useHelpUrl } from "../knowledge-bases/help-target.js";
import { useUnreadCount } from "../notifications/notifications-api.js";
import { isNavigationVisible, type NavigationSection, navigationItems } from "./extensions.js";
import { useRegistry } from "./registry.js";
import { useShell } from "./shell.js";
import { useOrganizationState } from "./shell-context.js";

export function RailIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon aria-hidden="true" className="size-icon-lg" strokeWidth={tokens.icon.strokeWidth} />;
}

export function SearchRailItem() {
  const { t } = useTranslation();
  const shell = useShell();
  const location = useLocation();
  return (
    <RailButton
      label={t("rail.search")}
      icon={<RailIcon icon={Search} />}
      current={location.pathname === "/search"}
      onClick={shell.openSearch}
    />
  );
}

export function SpacesRailItem() {
  const { t } = useTranslation();
  const location = useLocation();
  return (
    <RailButton
      label={t("rail.spaces")}
      icon={<RailIcon icon={Layers} />}
      current={location.pathname.startsWith("/spaces") || location.pathname.startsWith("/personal-space")}
      asChild
    >
      <Link to="/spaces" />
    </RailButton>
  );
}

export function HomeRailItem() {
  const { t } = useTranslation();
  const location = useLocation();
  return (
    <RailButton
      label={t("rail.forYou")}
      icon={<RailIcon icon={Home} />}
      current={location.pathname === "/home" || location.pathname === "/blog"}
      asChild
    >
      <Link to="/home" />
    </RailButton>
  );
}

export function TasksRailItem() {
  const { t } = useTranslation();
  const location = useLocation();
  return (
    <RailButton
      label={t("rail.tasks")}
      icon={<RailIcon icon={ListChecks} />}
      current={location.pathname === "/tasks"}
      asChild
    >
      <Link to="/tasks" />
    </RailButton>
  );
}

export function NotificationsRailItem() {
  const { t } = useTranslation();
  const shell = useShell();
  const unread = useUnreadCount();
  const count = unread.data ?? 0;
  return (
    <RailButton
      label={count > 0 ? t("rail.notificationsUnread", { count }) : t("rail.notifications")}
      icon={<RailIcon icon={Bell} />}
      current={shell.notificationsOpen}
      onClick={shell.toggleNotifications}
      {...(count > 0 ? { badge: count > 99 ? "99+" : String(count) } : {})}
    />
  );
}

export function HelpRailItem() {
  const { t } = useTranslation();
  const shell = useShell();
  const { organizationId } = useOrganizationState();
  const help = useHelpUrl(organizationId);
  return (
    <Menu
      trigger={<RailButton label={t("rail.help")} icon={<RailIcon icon={CircleHelp} />} />}
      align="start"
      items={[
        {
          label: help.custom ? t("help.knowledgeBase") : t("help.documentation"),
          icon: LifeBuoy,
          onSelect: () => {
            globalThis.open(help.url, "_blank", "noopener");
          },
        },
        { label: t("help.shortcuts"), icon: Keyboard, shortcut: "?", onSelect: shell.openShortcuts },
        {
          label: t("help.apiReference"),
          icon: BookOpen,
          onSelect: () => {
            globalThis.open("/api/docs", "_blank", "noopener");
          },
        },
      ]}
    />
  );
}

const SETTINGS_AREAS = [
  { section: "account", labelKey: "navigation.myAccount", icon: UserRound },
  { section: "organization", labelKey: "navigation.organization", icon: Building2 },
  { section: "instance", labelKey: "navigation.instance", icon: Server },
] as const satisfies readonly { section: NavigationSection; labelKey: string; icon: LucideIcon }[];

export function SettingsRailItem() {
  const { t } = useTranslation();
  const shell = useShell();
  const location = useLocation();
  const navigation = useRegistry(navigationItems);
  const areas = SETTINGS_AREAS.flatMap((area) => {
    const first = navigation.find(
      (item) => item.section === area.section && isNavigationVisible(item, shell),
    );
    return first ? [{ ...area, to: first.to }] : [];
  });
  return (
    <Menu
      trigger={
        <RailButton
          label={t("rail.settings")}
          icon={<RailIcon icon={Settings} />}
          current={location.pathname.startsWith("/settings")}
        />
      }
      align="start"
      items={areas.map((area) => ({
        label: t(area.labelKey),
        icon: area.icon,
        onSelect: () =>
          shell.navigate(area.to, shell.organizationId ? { organizationId: shell.organizationId } : {}),
      }))}
    />
  );
}
