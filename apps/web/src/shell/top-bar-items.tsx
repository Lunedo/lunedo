import { IconButton, Menu, type MenuItem } from "@lunedo/ui";
import { useNavigate } from "@tanstack/react-router";
import {
  Bell,
  Building2,
  CircleHelp,
  Code,
  Keyboard,
  LifeBuoy,
  LockKeyhole,
  LogOut,
  Palette,
  Server,
  Settings,
  UserRound,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useBackupAttention } from "../components/backup-banner.js";
import { PersonAvatar } from "../components/person-avatar.js";
import { docsUrl } from "../docs/docs-url.js";
import { useHelpUrl } from "../knowledge-bases/help-target.js";
import { NotificationPopover } from "../notifications/notification-panel.js";
import { unreadCountLabel, useUnreadCount } from "../notifications/notifications-api.js";
import { isNavigationVisible, type NavigationSection, navigationItems } from "./extensions.js";
import { useShownLocation } from "./navigation-pending.js";
import { useRegistry } from "./registry.js";
import { useShell } from "./shell.js";
import { useOrganizationState, useSession } from "./shell-context.js";

export function NotificationsButton() {
  const { t } = useTranslation();
  const shell = useShell();
  const unread = useUnreadCount();
  const count = unread.data?.count ?? 0;
  return (
    <span className="relative inline-flex">
      <NotificationPopover
        open={shell.notificationsOpen}
        onOpenChange={(open) => {
          if (open !== shell.notificationsOpen) shell.toggleNotifications();
        }}
        trigger={
          <IconButton
            label={
              count > 0
                ? t("rail.notificationsUnread", { count, label: unreadCountLabel(unread.data ?? { count, capped: false }) })
                : t("rail.notifications")
            }
            icon={Bell}
            size="field"
          />
        }
      />
      {count > 0 ? (
        <span
          aria-hidden="true"
          data-unread-dot=""
          className="pointer-events-none absolute top-1 right-1 size-2 rounded-full bg-badge ring-2 ring-bg"
        />
      ) : null}
    </span>
  );
}

export function HelpMenu() {
  const { t } = useTranslation();
  const shell = useShell();
  const { organizationId } = useOrganizationState();
  const help = useHelpUrl(organizationId);
  const open = (url: string) => {
    globalThis.open(url, "_blank", "noopener");
  };
  const items: MenuItem[] = [
    ...(help.custom
      ? [{ label: t("help.knowledgeBase"), icon: CircleHelp, onSelect: () => open(help.url) }]
      : []),
    { label: t("help.documentation"), icon: LifeBuoy, onSelect: () => open(docsUrl("README.md")) },
    { label: t("help.shortcuts"), icon: Keyboard, shortcut: "?", onSelect: shell.openShortcuts },
    { label: t("help.apiReference"), icon: Code, onSelect: () => open("/api/docs") },
  ];
  return (
    <Menu trigger={<IconButton label={t("rail.help")} icon={CircleHelp} size="field" />} items={items} />
  );
}

const ADMIN_AREAS = [
  { section: "organization", labelKey: "navigation.organization", icon: Building2 },
  { section: "instance", labelKey: "navigation.instance", icon: Server },
] as const satisfies readonly { section: NavigationSection; labelKey: string; icon: typeof Building2 }[];

export function useAdminAreas() {
  const shell = useShell();
  const navigation = useRegistry(navigationItems);
  return ADMIN_AREAS.flatMap((area) => {
    const first = navigation.find(
      (item) => item.section === area.section && isNavigationVisible(item, shell),
    );
    return first ? [{ ...area, to: first.to }] : [];
  });
}

function AttentionDot() {
  return (
    <span
      aria-hidden="true"
      data-attention-dot=""
      className="pointer-events-none absolute top-1 right-1 size-2 rounded-full bg-badge ring-2 ring-bg"
    />
  );
}

export function SettingsGear() {
  const { t } = useTranslation();
  const shell = useShell();
  const location = useShownLocation();
  const areas = useAdminAreas();
  const backupAttention = useBackupAttention();
  const attention = backupAttention && areas.some((area) => area.section === "instance");
  const open = (to: string) =>
    shell.navigate(to, shell.organizationId ? { organizationId: shell.organizationId } : {});
  const current =
    location.pathname.startsWith("/settings/organizations/") ||
    location.pathname.startsWith("/settings/instance");
  const [only] = areas;
  if (!only) return null;
  if (areas.length === 1) {
    return (
      <span className="relative inline-flex">
        <IconButton
          label={attention ? t("rail.settingsAttention") : t("rail.settings")}
          icon={Settings}
          size="field"
          aria-current={current ? "page" : undefined}
          onClick={() => open(only.to)}
        />
        {attention ? <AttentionDot /> : null}
      </span>
    );
  }
  return (
    <span className="relative inline-flex">
      <Menu
        trigger={
          <IconButton
            label={attention ? t("rail.settingsAttention") : t("rail.settings")}
            icon={Settings}
            size="field"
            aria-current={current ? "page" : undefined}
          />
        }
        items={areas.map((area) => ({
          label: t(area.labelKey),
          icon: area.icon,
          onSelect: () => open(area.to),
          ...(attention && area.section === "instance" ? { attention: t("rail.backupAttention") } : {}),
        }))}
      />
      {attention ? <AttentionDot /> : null}
    </span>
  );
}

export function AccountMenu() {
  const { t } = useTranslation();
  const session = useSession();
  const shell = useShell();
  const navigate = useNavigate();
  const name = session.account?.name ?? "";
  const email = session.account?.email ?? "";
  return (
    <Menu
      trigger={
        <button
          type="button"
          aria-label={t("rail.account")}
          className="flex size-control-field items-center justify-center rounded-full focus-visible:focus-ring"
        >
          <PersonAvatar
            id={session.account?.id}
            name={name}
            pictureRef={session.account?.pictureRef}
            size="sm"
          />
        </button>
      }
      items={[
        { type: "header", title: name || email, ...(name && email ? { description: email } : {}) },
        { type: "separator" },
        {
          label: t("navigation.profile"),
          icon: UserRound,
          onSelect: () => void navigate({ to: "/settings/profile" }),
        },
        {
          label: t("navigation.preferences"),
          icon: Palette,
          onSelect: () => void navigate({ to: "/settings/preferences" }),
        },
        {
          label: t("navigation.signInAndSecurity"),
          icon: LockKeyhole,
          onSelect: () => void navigate({ to: "/settings/security" }),
        },
        { type: "separator" },
        { label: t("commands.signOut"), icon: LogOut, onSelect: shell.signOut },
      ]}
    />
  );
}
