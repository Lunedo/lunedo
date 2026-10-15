import {
  type CommandGroup,
  type CommandItem,
  CommandPalette,
  fuzzyMatch,
  Highlighted,
  highlightParts,
  Kbd,
  useToast,
} from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { Building2, Command as CommandIcon, Link2, type LucideIcon, Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/request.js";
import { useDebounced } from "../components/table-state.js";
import { useFailureToast } from "../errors/failure.js";
import { translateKey } from "../i18n/translate.js";
import { useConfluenceLink } from "../imports/confluence-link.js";
import { looksLikeConfluenceLink } from "../imports/reimport-api.js";
import { QUICK_DEBOUNCE_MS, quickSearchQuery } from "../search/search-api.js";
import { noFilters, toSearchParams } from "../search/search-params.js";
import { hitHref, hitIcon, hitTitle } from "../search/search-results.js";
import { commands, isNavigationVisible, navigationItems } from "./extensions.js";
import { displayKey } from "./keyboard.js";
import { recentCommands, rememberCommand } from "./recent-commands.js";
import { useRegistry } from "./registry.js";
import { useShell } from "./shell.js";
import { useOrganizationState, useSession } from "./shell-context.js";

const MATCHES = 12;
const PAGES = 5;
const MIN_PAGE_QUERY = 2;

interface Entry {
  id: string;
  label: string;
  heading: string;
  scope?: string;
  icon?: LucideIcon;
  shortcut?: string[];
  keywords: string[];
  run: () => void;
}

function rank(
  query: string,
  entries: readonly Entry[],
): { entry: Entry; item: Omit<CommandItem, "onSelect"> }[] {
  return entries
    .flatMap((entry) => {
      const byLabel = fuzzyMatch(query, entry.label);
      const byKeyword = byLabel
        ? null
        : entry.keywords.map((keyword) => fuzzyMatch(query, keyword)).find((match) => match !== null);
      const match = byLabel ?? (byKeyword ? { score: byKeyword.score - 50, ranges: [] } : null);
      if (!match) return [];
      return [
        {
          score: match.score,
          entry,
          item: {
            id: entry.id,
            label: entry.label,
            labelContent: <Highlighted parts={highlightParts(entry.label, match.ranges)} />,
            ...(entry.scope ? { scope: entry.scope } : {}),
            ...(entry.icon ? { icon: entry.icon } : {}),
            ...(entry.shortcut ? { shortcut: entry.shortcut } : {}),
          },
        },
      ];
    })
    .sort((left, right) => right.score - left.score)
    .map(({ entry, item }) => ({ entry, item }));
}

export function CommandPaletteHost({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!open) return null;
  return <Palette onOpenChange={onOpenChange} />;
}

function Palette({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const shell = useShell();
  const router = useRouter();
  const navigate = useNavigate();
  const session = useSession();
  const accountId = session.account?.id ?? "";
  const organization = useOrganizationState();
  const navigation = useRegistry(navigationItems);
  const actions = useRegistry(commands);
  const openLink = useConfluenceLink();
  const failed = useFailureToast();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState(() => recentCommands(accountId));
  const typed = query.trim();
  const debounced = useDebounced(typed, QUICK_DEBOUNCE_MS);
  const organizationId = shell.organizationId;
  const pages = useQuery({
    ...quickSearchQuery(organizationId ?? "", debounced, null),
    enabled: organizationId !== null && debounced.length >= MIN_PAGE_QUERY,
    throwOnError: false,
  });

  const close = () => onOpenChange(false);
  const sections = [
    { section: "account", heading: t("navigation.myAccount"), scope: t("commands.scopes.personal") },
    {
      section: "organization",
      heading: organization.organization?.name ?? t("navigation.organization"),
      scope: t("commands.scopes.organization"),
    },
    { section: "instance", heading: t("navigation.instance"), scope: t("commands.scopes.instance") },
  ] as const;

  const entries: Entry[] = [
    ...actions
      .filter((command) => (command.visible ? command.visible(shell) : true))
      .map((command) => ({
        id: command.id,
        label: translateKey(t, command.labelKey),
        heading: t("commands.actions"),
        ...(command.icon ? { icon: command.icon } : {}),
        ...(command.shortcut ? { shortcut: command.shortcut } : {}),
        keywords: command.keywords ?? [],
        run: () => command.run(shell),
      })),
    ...sections.flatMap(({ section, heading, scope }) =>
      navigation
        .filter((item) => item.section === section && isNavigationVisible(item, shell))
        .map((item) => ({
          id: item.id,
          label: translateKey(t, item.labelKey),
          heading,
          scope,
          icon: item.icon,
          ...(item.shortcut ? { shortcut: item.shortcut } : {}),
          keywords: [heading, scope],
          run: () =>
            shell.navigate(item.to, shell.organizationId ? { organizationId: shell.organizationId } : {}),
        })),
    ),
    ...(organization.multipleOrganizations
      ? organization.organizations.map((entry) => ({
          id: `organization.${entry.id}`,
          label: t("commands.switchTo", { name: entry.name }),
          heading: t("navigation.switchOrganization"),
          icon: Building2,
          keywords: [entry.slug],
          run: () =>
            shell.navigate("/settings/organizations/$organizationId/general", { organizationId: entry.id }),
        }))
      : []),
  ];

  const toItem = ({ entry, item }: { entry: Entry; item: Omit<CommandItem, "onSelect"> }): CommandItem => ({
    ...item,
    onSelect: () => {
      if (accountId) rememberCommand(accountId, entry.id);
      setRecent(recentCommands(accountId));
      close();
      entry.run();
    },
  });
  const plain = (entry: Entry) => ({
    entry,
    item: {
      id: entry.id,
      label: entry.label,
      ...(entry.scope ? { scope: entry.scope } : {}),
      ...(entry.icon ? { icon: entry.icon } : {}),
      ...(entry.shortcut ? { shortcut: entry.shortcut } : {}),
    },
  });

  const groups: CommandGroup[] = [];
  if (looksLikeConfluenceLink(query)) {
    const link = query.trim();
    const openOld = (): Promise<void> =>
      openLink(link).catch((error: unknown) => {
        if (error instanceof ApiError && error.code === "notFound") {
          toast({
            title: t("commands.confluenceLinkFailed"),
            description: t("imports.links.notFound"),
            variant: "error",
          });
        } else {
          failed(t("commands.confluenceLinkFailed"), error, () => void openOld());
        }
      });
    groups.push({
      heading: t("commands.confluenceLink"),
      items: [
        {
          id: "confluence-link",
          label: t("commands.openConfluenceLink"),
          icon: Link2,
          onSelect: () => {
            close();
            void openOld();
          },
        },
      ],
    });
  }

  const recentEntries = recent.flatMap((id) => entries.filter((entry) => entry.id === id));
  if (!typed) {
    groups.push({ heading: t("commands.recent"), items: recentEntries.map(plain).map(toItem) });
    for (const heading of [...new Set(entries.map((entry) => entry.heading))]) {
      groups.push({
        heading,
        items: entries
          .filter((entry) => entry.heading === heading && !recent.includes(entry.id))
          .map(plain)
          .map(toItem),
      });
    }
  } else {
    const ranked = rank(typed, entries);
    groups.push({
      heading: t("commands.commands"),
      items: ranked
        .filter(({ entry }) => !recent.includes(entry.id))
        .slice(0, MATCHES)
        .map(toItem),
    });
    groups.push({
      heading: t("commands.recent"),
      items: rank(typed, recentEntries).map(toItem),
    });
    const current = pages.data && !pages.isPlaceholderData && debounced === typed ? pages.data : null;
    const pageItems = (current?.results ?? [])
      .filter((hit) => hit.type !== "comment")
      .slice(0, PAGES)
      .flatMap<CommandItem>((hit) => {
        const href = hitHref(hit);
        if (!href) return [];
        const title = hitTitle(t, hit);
        const match = fuzzyMatch(typed, title);
        const item: CommandItem = {
          id: `page:${hit.id}`,
          label: title,
          ...(match ? { labelContent: <Highlighted parts={highlightParts(title, match.ranges)} /> } : {}),
          icon: hitIcon(hit),
          href,
          onSelect: () => {
            close();
            void navigate({ href });
          },
        };
        return [item];
      });
    if (typed.length >= MIN_PAGE_QUERY && organizationId) {
      const all = router.buildLocation({ to: "/search", search: toSearchParams(typed, noFilters) }).href;
      pageItems.push({
        id: "pages:all",
        label: t("commands.searchFor", { query: typed }),
        icon: Search,
        href: all,
        alwaysShown: true,
        onSelect: () => {
          close();
          void navigate({ href: all });
        },
      });
    }
    groups.push({ heading: t("commands.pages"), items: pageItems });
  }

  return (
    <CommandPalette
      open
      onOpenChange={onOpenChange}
      label={t("commands.label")}
      placeholder={t("commands.placeholder")}
      emptyText={t("commands.empty")}
      groups={groups}
      query={query}
      onQueryChange={setQuery}
      filter={false}
      icon={CommandIcon}
      closeHint="Esc"
      footer={
        <>
          <span>{t("commands.fuzzyHint")}</span>
          <span className="flex items-center gap-1 sm:ml-auto">
            <Kbd>{displayKey("mod+k")}</Kbd> {t("commands.opensAnywhere")}
          </span>
        </>
      }
    />
  );
}
