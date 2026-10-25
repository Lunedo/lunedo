import { Button, Select, Sidebar, SidebarGroup, SidebarHeader, SidebarItem } from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useShell } from "../../shell/shell.js";
import { spaceDisplayName } from "../../spaces/space-badge.js";
import { spaceByKeyQuery } from "../../spaces/space-queries.js";

export interface SettingsEntry {
  id: string;
  label: string;
  href: string;
  group?: string;
  notApplicable?: string;
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

function useBackTarget(space: { key: string; name: string } | undefined): { label: string; href: string } {
  const { t } = useTranslation();
  const { settingsReturn } = useShell();
  const returnKey = space ? null : settingsReturn.spaceKey;
  const returnSpace = useQuery({
    ...spaceByKeyQuery(returnKey ?? ""),
    enabled: returnKey !== null,
    throwOnError: false,
  });
  if (space) {
    return {
      label: t("navigation.backTo", { name: space.name }),
      href: settingsReturn.spaceKey === space.key ? settingsReturn.href : `/spaces/${space.key}`,
    };
  }
  if (returnKey) {
    const found = returnSpace.data?.space;
    return {
      label: t("navigation.backTo", { name: found ? spaceDisplayName(t, found) : returnKey }),
      href: settingsReturn.href,
    };
  }
  return { label: t("navigation.backTo", { name: t("rail.forYou") }), href: settingsReturn.href };
}

function BackButton({ label, href }: { label: string; href: string }) {
  return (
    <Button variant="secondary" block asChild className="justify-start">
      <Link to={href as never} data-settings-back="" title={label}>
        <ChevronLeft aria-hidden="true" className="size-icon-md shrink-0" />
        <span className="min-w-0 truncate">{label}</span>
      </Link>
    </Button>
  );
}

export function SettingsShell({
  label,
  eyebrow,
  title,
  space,
  header,
  search,
  entries,
  children,
}: {
  label: string;
  eyebrow: string;
  title: string;
  space?: { key: string; name: string };
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
  const back = useBackTarget(space);
  const drawer = useRef<HTMLDivElement>(null);
  const { mobileSidebarOpen, closeMobileSidebar } = shell;

  useEffect(() => {
    if (location.pathname) closeMobileSidebar();
  }, [location.pathname, closeMobileSidebar]);

  useEffect(() => {
    if (!mobileSidebarOpen) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    drawer.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeMobileSidebar();
      opener?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileSidebarOpen, closeMobileSidebar]);

  const navigation = (
    <Sidebar label={label}>
      <div className="flex px-2 pb-3">
        <BackButton {...back} />
      </div>
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
            <SidebarItem
              key={entry.id}
              label={entry.label}
              current={entry.id === current?.id}
              muted={entry.notApplicable !== undefined}
              asChild
            >
              <Link
                to={entry.href as never}
                {...(entry.notApplicable ? { title: entry.notApplicable } : {})}
              />
            </SidebarItem>
          ))}
        </SidebarGroup>
      ))}
    </Sidebar>
  );

  return (
    <div className="flex min-w-0 flex-1">
      {shell.sidebarCollapsed ? null : <div className="hidden md:flex">{navigation}</div>}
      {mobileSidebarOpen ? (
        <>
          <button
            type="button"
            aria-label={t("sidebar.close")}
            tabIndex={-1}
            onClick={closeMobileSidebar}
            className="fixed inset-0 z-30 bg-overlay md:hidden"
          />
          <div ref={drawer} className="fixed inset-y-0 left-0 z-40 flex shadow-dialog md:hidden">
            {navigation}
          </div>
        </>
      ) : null}
      <main
        id="main"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the content area scrolls and must be reachable by keyboard
        tabIndex={0}
        className="min-w-0 flex-1 overflow-y-auto outline-none focus-visible:focus-ring"
      >
        <div className="flex flex-col gap-2 px-4 pt-3 md:hidden">
          {mobileSidebarOpen ? null : <BackButton {...back} />}
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
