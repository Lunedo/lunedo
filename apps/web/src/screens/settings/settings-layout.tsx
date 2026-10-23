import { Combobox } from "@lunedo/ui";
import { Outlet, useLocation } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BackupBanner } from "../../components/backup-banner.js";
import { StorageBanner } from "../../components/storage-banner.js";
import { translateKey } from "../../i18n/translate.js";
import { isNavigationVisible, type NavigationSection, navigationItems } from "../../shell/extensions.js";
import { useRegistry } from "../../shell/registry.js";
import { useShell } from "../../shell/shell.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsSearchField, SettingsSearchResults } from "./settings-search.js";
import { currentEntry, type SettingsEntry, SettingsShell } from "./settings-shell.js";

export function settingsArea(pathname: string): NavigationSection {
  if (pathname.startsWith("/settings/organizations/")) return "organization";
  if (pathname === "/settings/instance" || pathname.startsWith("/settings/instance/")) return "instance";
  return "account";
}

function resolveSettingsPath(to: string, organizationId: string | null): string {
  return organizationId ? to.replace("$organizationId", organizationId) : to;
}

export function SettingsLayout() {
  const { t } = useTranslation();
  const shell = useShell();
  const organization = useOrganizationState();
  const navigation = useRegistry(navigationItems);
  const location = useLocation();
  const [query, setQuery] = useState("");
  const area = settingsArea(location.pathname);

  const areas = (
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
  const params = organization.organizationId ? { organizationId: organization.organizationId } : {};

  const entries: SettingsEntry[] = (areas.find((entry) => entry.section === area)?.items ?? []).map(
    (item) => ({
      id: item.id,
      label: translateKey(t, item.labelKey),
      href: resolveSettingsPath(item.to, organization.organizationId),
      ...(item.groupKey ? { group: translateKey(t, item.groupKey) } : {}),
    }),
  );
  const title =
    area === "account"
      ? t("navigation.myAccount")
      : area === "instance"
        ? t("navigation.instance")
        : (organization.organization?.name ?? t("navigation.organization"));

  const switchOrganization = (organizationId: string) => {
    const active = currentEntry(entries, location.pathname);
    const item = navigation.find((candidate) => candidate.id === active?.id);
    shell.navigate(item?.to ?? "/settings/organizations/$organizationId/general", { organizationId });
  };

  return (
    <SettingsShell
      label={t("navigation.settings")}
      eyebrow={t("navigation.settings")}
      title={title}
      entries={entries}
      header={
        area === "organization" && organization.multipleOrganizations ? (
          <Combobox
            aria-label={t("navigation.switchOrganization")}
            value={organization.organizationId}
            onValueChange={(value) => {
              if (value) switchOrganization(value);
            }}
            items={organization.organizations.map((entry) => ({ value: entry.id, label: entry.name }))}
          />
        ) : undefined
      }
      search={<SettingsSearchField value={query} onChange={setQuery} />}
    >
      <StorageBanner />
      <BackupBanner />
      {query.trim() ? (
        <SettingsSearchResults
          query={query}
          areas={areas.map((entry) => ({ label: entry.label, items: entry.items }))}
          params={params}
          onClear={() => setQuery("")}
        />
      ) : (
        <Outlet />
      )}
    </SettingsShell>
  );
}
