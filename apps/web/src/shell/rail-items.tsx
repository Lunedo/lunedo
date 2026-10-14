import { tokens } from "@pagehall/tokens";
import { Menu, RailButton } from "@pagehall/ui";
import { Link, useLocation } from "@tanstack/react-router";
import {
  Bell,
  BookOpen,
  CircleHelp,
  Home,
  Keyboard,
  Layers,
  ListChecks,
  type LucideIcon,
  Search,
  Settings,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUnreadCount } from "../notifications/notifications-api.js";
import { useShell } from "./shell.js";

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
  return (
    <Menu
      trigger={<RailButton label={t("rail.help")} icon={<RailIcon icon={CircleHelp} />} />}
      align="start"
      items={[
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

export function SettingsRailItem() {
  const { t } = useTranslation();
  const location = useLocation();
  return (
    <RailButton
      label={t("rail.settings")}
      icon={<RailIcon icon={Settings} />}
      current={location.pathname.startsWith("/settings")}
      asChild
    >
      <Link to="/settings/preferences" />
    </RailButton>
  );
}
