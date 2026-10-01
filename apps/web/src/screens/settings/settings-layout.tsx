import { IconButton, Select, Sidebar, SidebarGroup, SidebarHeader, SidebarItem } from "@pagehall/ui";
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { translateKey } from "../../i18n/translate.js";
import {
  isNavigationVisible,
  type NavigationItem,
  type NavigationSection,
  navigationItems,
} from "../../shell/extensions.js";
import { useRegistry } from "../../shell/registry.js";
import { useShell } from "../../shell/shell.js";
import { useOrganizationState } from "../../shell/shell-context.js";

function resolvePath(to: string, organizationId: string | null): string {
  return organizationId ? to.replace("$organizationId", organizationId) : to;
}

export function SettingsLayout() {
  const { t } = useTranslation();
  const shell = useShell();
  const organization = useOrganizationState();
  const navigation = useRegistry(navigationItems);
  const location = useLocation();
  const navigate = useNavigate();

  const sections: { section: NavigationSection; label: string; items: NavigationItem[] }[] = (
    [
      { section: "account", label: t("navigation.myAccount") },
      {
        section: "organization",
        label: organization.organization?.name ?? t("navigation.organization"),
      },
      { section: "instance", label: t("navigation.instance") },
    ] as const
  )
    .map((entry) => ({
      ...entry,
      items: navigation.filter((item) => item.section === entry.section && isNavigationVisible(item, shell)),
    }))
    .filter((entry) => entry.items.length > 0);

  const current = (item: NavigationItem) =>
    location.pathname.startsWith(resolvePath(item.to, organization.organizationId));
  const params = organization.organizationId ? { organizationId: organization.organizationId } : {};

  const switchOrganization = (organizationId: string) => {
    const active = navigation.find((item) => item.section === "organization" && current(item));
    shell.navigate(active?.to ?? "/settings/organizations/$organizationId/general", { organizationId });
  };

  return (
    <div className="flex min-w-0 flex-1">
      {shell.sidebarCollapsed ? null : (
        <div className="hidden md:flex">
          <Sidebar label={t("navigation.settings")}>
            <SidebarHeader
              actions={
                <IconButton
                  label={t("navigation.collapseSidebar")}
                  icon={PanelLeftClose}
                  onClick={shell.toggleSidebar}
                />
              }
            >
              {t("navigation.settings")}
            </SidebarHeader>
            {sections.map((section) => (
              <SidebarGroup key={section.section} label={section.label}>
                {section.section === "organization" && organization.multipleOrganizations ? (
                  <div className="px-2 pb-2">
                    <Select
                      aria-label={t("navigation.switchOrganization")}
                      value={organization.organizationId ?? ""}
                      onValueChange={switchOrganization}
                      options={organization.organizations.map((entry) => ({
                        value: entry.id,
                        label: entry.name,
                      }))}
                    />
                  </div>
                ) : null}
                {section.items.map((item) => (
                  <SidebarItem
                    key={item.id}
                    icon={item.icon}
                    label={translateKey(t, item.labelKey)}
                    current={current(item)}
                    asChild
                  >
                    <Link to={item.to as never} params={params as never} />
                  </SidebarItem>
                ))}
              </SidebarGroup>
            ))}
          </Sidebar>
        </div>
      )}
      <main id="main" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto outline-none">
        <div className="flex items-center gap-2 px-4 pt-3 md:hidden">
          <div className="flex-1">
            <Select
              aria-label={t("navigation.settingsSection")}
              value={sections.flatMap((section) => section.items).find(current)?.id ?? ""}
              onValueChange={(id) => {
                const item = navigation.find((entry) => entry.id === id);
                if (item) void navigate({ to: item.to as never, params: params as never });
              }}
              options={sections.flatMap((section) =>
                section.items.map((item) => ({
                  value: item.id,
                  label: translateKey(t, item.labelKey),
                  group: section.label,
                })),
              )}
            />
          </div>
        </div>
        {shell.sidebarCollapsed ? (
          <div className="hidden px-4 pt-3 md:block">
            <IconButton
              label={t("navigation.expandSidebar")}
              icon={PanelLeftOpen}
              onClick={shell.toggleSidebar}
            />
          </div>
        ) : null}
        <Outlet />
      </main>
    </div>
  );
}
