import { IconButton, Menu, type MenuItem } from "@lunedo/ui";
import { Link, useNavigate } from "@tanstack/react-router";
import { Building2, ChevronDown, PanelLeft, Plus, Search, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CreateMenu } from "./create-menu.js";
import { topBarItems } from "./extensions.js";
import { LunedoMark } from "./lunedo-mark.js";
import { useRegistry } from "./registry.js";
import { useShell } from "./shell.js";
import { useCan, useOrganizationState } from "./shell-context.js";
import { useAdminAreas } from "./top-bar-items.js";

export const DESKTOP_QUERY = "(min-width: 48rem)";

function isApplePlatform(): boolean {
  const platform = globalThis.navigator?.platform ?? "";
  return /mac|iphone|ipad/i.test(platform);
}

function OrganizationInitial({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-5 shrink-0 items-center justify-center rounded-sm bg-text text-2xs font-bold text-bg"
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function OrganizationSwitcher() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const state = useOrganizationState();
  const shell = useShell();
  const areas = useAdminAreas();
  const canCreate = useCan("instance.organizations.create");
  const current = state.organization;
  if (!state.multipleOrganizations || !current) return null;
  const organizationSettings = areas.find((area) => area.section === "organization");
  const items: MenuItem[] = [
    ...state.organizations.map((organization) => ({
      label: organization.name,
      icon: Building2,
      checked: organization.id === current.id,
      onSelect: () => {
        if (organization.id === current.id) return;
        state.switchOrganization(organization.id);
        void navigate({ to: "/home" });
      },
    })),
    { type: "separator" },
    ...(organizationSettings
      ? [
          {
            label: t("topBar.organizationSettings"),
            icon: Settings,
            onSelect: () => shell.navigate(organizationSettings.to, { organizationId: current.id }),
          },
        ]
      : []),
    ...(canCreate
      ? [
          {
            label: t("topBar.createOrganization"),
            icon: Plus,
            onSelect: () => shell.navigate("/settings/instance/organizations"),
          },
        ]
      : []),
  ];
  return (
    <Menu
      align="start"
      trigger={
        <button
          type="button"
          aria-label={t("topBar.switchOrganization", { name: current.name })}
          className="flex h-control-md min-w-0 items-center gap-2 rounded-md px-2 text-sm hover:bg-hover focus-visible:focus-ring"
        >
          <OrganizationInitial name={current.name} />
          <span className="hidden max-w-field truncate sm:inline" title={current.name}>
            {current.name}
          </span>
          <ChevronDown aria-hidden="true" className="size-icon-sm text-text-muted" />
        </button>
      }
      items={items}
    />
  );
}

function SearchTrigger() {
  const { t } = useTranslation();
  const shell = useShell();
  const shortcut = isApplePlatform() ? t("topBar.searchShortcutApple") : t("topBar.searchShortcut");
  return (
    <>
      <button
        type="button"
        onClick={shell.openSearch}
        aria-keyshortcuts="Control+K /"
        className="hidden h-control-md w-full max-w-dialog-sm items-center gap-2 rounded-md border border-border bg-surface-sunken px-3 text-sm text-text-muted hover:bg-hover focus-visible:focus-ring md:flex"
      >
        <Search aria-hidden="true" className="size-icon-md shrink-0" />
        <span className="flex-1 text-left">{t("topBar.search")}</span>
        <kbd className="rounded-sm border border-border bg-surface px-1 font-sans text-2xs">{shortcut}</kbd>
      </button>
      <span className="md:hidden">
        <IconButton label={t("topBar.search")} icon={Search} onClick={shell.openSearch} />
      </span>
    </>
  );
}

export function useDesktop(): boolean {
  const [desktop, setDesktop] = useState(() => globalThis.matchMedia?.(DESKTOP_QUERY).matches ?? true);
  useEffect(() => {
    const query = globalThis.matchMedia?.(DESKTOP_QUERY);
    if (!query) return;
    const update = () => setDesktop(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return desktop;
}

function SidebarToggle() {
  const { t } = useTranslation();
  const shell = useShell();
  const desktop = useDesktop();
  const expanded = desktop ? !shell.sidebarCollapsed : shell.mobileSidebarOpen;
  const label = desktop
    ? shell.sidebarCollapsed
      ? t("navigation.expandSidebar")
      : t("navigation.collapseSidebar")
    : shell.mobileSidebarOpen
      ? t("sidebar.close")
      : t("sidebar.open");
  return (
    <IconButton
      label={label}
      icon={PanelLeft}
      aria-keyshortcuts="["
      aria-expanded={expanded}
      onClick={shell.toggleSidebar}
    />
  );
}

export function TopBar() {
  const { t } = useTranslation();
  const items = useRegistry(topBarItems);
  return (
    <header
      data-top-bar=""
      className="flex h-toolbar shrink-0 items-center gap-2 border-b border-border bg-bg px-2 md:gap-3"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1 md:gap-2">
        <SidebarToggle />
        <Link
          to="/"
          aria-label={t("rail.home")}
          className="flex h-control-md shrink-0 items-center gap-2 rounded-md px-1 font-semibold text-text focus-visible:focus-ring"
        >
          <LunedoMark className="size-6 text-accent" />
          <span className="hidden lg:inline">{t("brand.name")}</span>
        </Link>
        <OrganizationSwitcher />
      </div>
      <div className="flex justify-center md:flex-[2]">
        <SearchTrigger />
      </div>
      <div className="flex flex-1 items-center justify-end gap-1 md:gap-2">
        <CreateMenu />
        <ul className="flex items-center gap-1">
          {items.map((item) => (
            <li key={item.id} className="flex">
              <item.component />
            </li>
          ))}
        </ul>
      </div>
    </header>
  );
}
