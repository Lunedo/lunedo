import { tokens } from "@pagehall/tokens";
import { Menu, RailButton } from "@pagehall/ui";
import { Link, useLocation } from "@tanstack/react-router";
import { Bell, BookOpen, CircleHelp, Keyboard, type LucideIcon, Search, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUnreadCount } from "../notifications/notifications-api.js";
import { useShell } from "./shell.js";

export function RailIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon aria-hidden="true" className="size-icon-lg" strokeWidth={tokens.icon.strokeWidth} />;
}

export function SearchRailItem() {
  const { t } = useTranslation();
  const shell = useShell();
  return (
    <RailButton
      label={t("rail.search")}
      icon={<RailIcon icon={Search} />}
      onClick={shell.openCommandPalette}
    />
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
