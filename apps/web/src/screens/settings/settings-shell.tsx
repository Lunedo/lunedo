import { BackLink, Select, Sidebar, SidebarGroup, SidebarHeader, SidebarItem } from "@lunedo/ui";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useShell } from "../../shell/shell.js";

export interface SettingsEntry {
  id: string;
  label: string;
  href: string;
  group?: string;
}

export interface SettingsEntryGroup {
  label?: string;
  entries: SettingsEntry[];
}

export function currentEntry(entries: readonly SettingsEntry[], pathname: string): SettingsEntry | undefined {
  const path = pathname.replace(/\/+$/, "");
  return entries
    .filter((entry) => path === entry.href || path.startsWith(`${entry.href}/`))
    .reduce<SettingsEntry | undefined>(
      (best, entry) => (best && best.href.length >= entry.href.length ? best : entry),
      undefined,
    );
}

export function groupEntries(entries: readonly SettingsEntry[]): SettingsEntryGroup[] {
  const ungrouped = entries.filter((entry) => entry.group === undefined);
  const groups = new Map<string, SettingsEntry[]>();
  for (const entry of entries) {
    if (entry.group === undefined) continue;
    groups.set(entry.group, [...(groups.get(entry.group) ?? []), entry]);
  }
  return [
    ...(ungrouped.length > 0 ? [{ entries: ungrouped }] : []),
    ...[...groups].map(([label, grouped]) => ({ label, entries: grouped })),
  ];
}

export function SettingsShell({
  label,
  eyebrow,
  title,
  back,
  header,
  search,
  entries,
  children,
}: {
  label: string;
  eyebrow: string;
  title: string;
  back?: { label: string; href: string };
  header?: ReactNode;
  search?: ReactNode;
  entries: readonly SettingsEntry[];
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const shell = useShell();
  const location = useLocation();
  const navigate = useNavigate();
  const current = currentEntry(entries, location.pathname);
  const groups = groupEntries(entries);
  const backLink = back ? (
    <BackLink label={back.label} asChild>
      <Link to={back.href as never} />
    </BackLink>
  ) : null;

  return (
    <div className="flex min-w-0 flex-1">
      {shell.sidebarCollapsed ? null : (
        <div className="hidden md:flex">
          <Sidebar label={label}>
            {backLink ? <div className="flex px-2 pb-3">{backLink}</div> : null}
            <SidebarHeader eyebrow={eyebrow}>
              <span title={title}>{title}</span>
            </SidebarHeader>
            {header ? <div className="px-2 pb-2">{header}</div> : null}
            {search ? <div className="px-2 pb-2">{search}</div> : null}
            {groups.map((group) => (
              <SidebarGroup
                key={group.label ?? ""}
                {...(group.label ? { label: group.label, variant: "divided" as const } : {})}
              >
                {group.entries.map((entry) => (
                  <SidebarItem key={entry.id} label={entry.label} current={entry.id === current?.id} asChild>
                    <Link to={entry.href as never} />
                  </SidebarItem>
                ))}
              </SidebarGroup>
            ))}
          </Sidebar>
        </div>
      )}
      <main
        id="main"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the content area scrolls and must be reachable by keyboard
        tabIndex={0}
        className="min-w-0 flex-1 overflow-y-auto outline-none focus-visible:focus-ring"
      >
        <div className="flex flex-col gap-2 px-4 pt-3 md:hidden">
          {backLink}
          {header}
          {search}
          {entries.length > 0 ? (
            <Select
              aria-label={t("navigation.settingsSection")}
              value={current?.id ?? ""}
              onValueChange={(id) => {
                const entry = entries.find((candidate) => candidate.id === id);
                if (entry) void navigate({ to: entry.href as never });
              }}
              options={groups.flatMap((group) =>
                group.entries.map((entry) => ({
                  value: entry.id,
                  label: entry.label,
                  group: group.label ?? title,
                })),
              )}
            />
          ) : null}
        </div>
        {children}
      </main>
    </div>
  );
}
