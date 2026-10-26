import {
  type CommandGroup,
  type CommandItem,
  fuzzyMatch,
  Highlighted,
  highlightParts,
  useToast,
} from "@lunedo/ui";
import { Building2, Link2, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/request.js";
import { useFailureToast } from "../errors/failure.js";
import { translateKey } from "../i18n/translate.js";
import { useConfluenceLink } from "../imports/confluence-link.js";
import { looksLikeConfluenceLink } from "../imports/reimport-api.js";
import { commands, isNavigationVisible, navigationItems } from "./extensions.js";
import { recentCommands, rememberCommand } from "./recent-commands.js";
import { useRegistry } from "./registry.js";
import { useShell } from "./shell.js";
import { useOrganizationState, useSession } from "./shell-context.js";

const MATCHES = 5;

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

export function useCommandGroups(query: string, close: () => void): CommandGroup[] {
  const { t } = useTranslation();
  const shell = useShell();
  const session = useSession();
  const accountId = session.account?.id ?? "";
  const organization = useOrganizationState();
  const navigation = useRegistry(navigationItems);
  const actions = useRegistry(commands);
  const openLink = useConfluenceLink();
  const failed = useFailureToast();
  const { toast } = useToast();
  const [recent, setRecent] = useState(() => recentCommands(accountId));
  const typed = query.trim();

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
    id: `command:${item.id}`,
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
    groups.push({
      heading: t("commands.actions"),
      items: entries
        .filter((entry) => entry.heading === t("commands.actions") && !recent.includes(entry.id))
        .map(plain)
        .map(toItem),
    });
  } else {
    groups.push({
      heading: t("commands.commands"),
      items: [
        ...rank(typed, recentEntries),
        ...rank(typed, entries).filter(({ entry }) => !recent.includes(entry.id)),
      ]
        .slice(0, MATCHES)
        .map(toItem),
    });
  }
  return groups;
}
