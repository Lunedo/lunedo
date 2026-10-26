import { Button, type CommandGroup, type CommandItem, CommandPalette, Highlighted, Kbd } from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { Bookmark, Clock, FilePlus, Globe, History, Layers, SearchX, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDebounced } from "../components/table-state.js";
import { problemMessage } from "../errors/problem-message.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { useCommandGroups } from "../shell/command-groups.js";
import { isApplePlatform } from "../shell/keyboard.js";
import { useShell } from "../shell/shell.js";
import { useOrganizationState } from "../shell/shell-context.js";
import { itemHref } from "../spaces/item-paths.js";
import { useSpaceDisplayName } from "../spaces/space-badge.js";
import { spaceByKeyQuery } from "../spaces/space-queries.js";
import { useClearRecentSearches } from "./recent-searches.js";
import {
  filtersOf,
  peopleQuery,
  QUICK_DEBOUNCE_MS,
  quickSearchQuery,
  recentlyViewedQuery,
  recentSearchesQuery,
  type SearchHit,
  spacesQuery,
  useRememberSearch,
  useSavedSearches,
} from "./search-api.js";
import { noFilters, type SearchFilters, toSearchParams } from "./search-params.js";
import { hitHref, hitIcon, hitPath, hitTitle } from "./search-results.js";

const SPACE_PATH = /^\/spaces\/([^/]+)/;
const MIN_DIRECTORY_QUERY = 2;
const BUSY_DELAY_MS = 300;

export function useCurrentSpace() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const key = SPACE_PATH.exec(pathname)?.[1];
  const decoded = key ? decodeURIComponent(key) : "";
  const space = useQuery({ ...spaceByKeyQuery(decoded), enabled: decoded.length > 0, throwOnError: false });
  return decoded ? (space.data?.space ?? null) : null;
}

function useDelayed(active: boolean, delay: number): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), delay);
    return () => clearTimeout(timer);
  }, [active, delay]);
  return shown;
}

export function QuickSearchHost({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!open) return null;
  return <QuickSearch onOpenChange={onOpenChange} />;
}

function QuickSearch({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const router = useRouter();
  const organization = useOrganizationState();
  const space = useCurrentSpace();
  const spaceName = useSpaceDisplayName();
  const organizationId = space?.organizationId ?? organization.organizationId;
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"space" | "all">("space");
  const inSpace = space !== null && scope === "space";
  const typed = query.trim();
  const debounced = useDebounced(typed, QUICK_DEBOUNCE_MS);
  const settled = debounced === typed;
  const remember = useRememberSearch(organizationId);
  const format = useFormat();
  const commandGroups = useCommandGroups(query, () => onOpenChange(false));
  const linkGroups = commandGroups.filter((group) =>
    group.items.some((item) => item.id === "confluence-link"),
  );
  const otherCommands = commandGroups.filter((group) => !linkGroups.includes(group));
  const clearRecent = useClearRecentSearches(organizationId ?? "");
  const createTarget = useShell().spaceCreateTarget;
  const canCreatePage = createTarget?.kinds.includes("page") ?? false;

  const results = useQuery({
    ...quickSearchQuery(organizationId ?? "", debounced, inSpace ? space.id : null),
    enabled: organizationId !== null && debounced.length > 0,
    throwOnError: false,
  });
  const people = useQuery({
    ...peopleQuery(debounced),
    enabled: debounced.length >= MIN_DIRECTORY_QUERY,
    throwOnError: false,
  });
  const spaces = useQuery({
    ...spacesQuery(organizationId ?? "", debounced),
    enabled: organizationId !== null && debounced.length >= MIN_DIRECTORY_QUERY,
    throwOnError: false,
  });
  const recent = useQuery({
    ...recentSearchesQuery(organizationId ?? ""),
    enabled: organizationId !== null,
    throwOnError: false,
  });
  const saved = useSavedSearches(organizationId);
  const viewed = useQuery({ ...recentlyViewedQuery, throwOnError: false });

  const current = results.data && !results.isPlaceholderData && settled ? results.data : null;
  const busy = useDelayed(typed.length > 0 && (!settled || results.isFetching), BUSY_DELAY_MS);

  const searchPageHref = (text: string, filters: SearchFilters) =>
    router.buildLocation({ to: "/search", search: toSearchParams(text, filters) }).href;

  const go = (href: string, rememberQuery = true) => {
    if (rememberQuery && typed) remember.mutate({ query: typed });
    void navigate({ href });
  };

  const groups = ((): CommandGroup[] => {
    if (!typed) {
      const list: CommandGroup[] = [];
      const recentSearches = recent.data ?? [];
      if (recentSearches.length > 0) {
        list.push({
          heading: t("search.quick.recentSearches"),
          items: [
            ...recentSearches.map<CommandItem>((entry) => ({
              id: `recent:${entry.id}`,
              label: entry.query,
              icon: Clock,
              keepOpen: true,
              onSelect: () => setQuery(entry.query),
            })),
            {
              id: "recent:clear",
              label: t("search.quick.clearRecent"),
              icon: X,
              keepOpen: true,
              onSelect: () => clearRecent(recentSearches),
            },
          ],
        });
      }
      const savedSearches = saved.data ?? [];
      if (savedSearches.length > 0) {
        list.push({
          heading: t("search.savedSearches"),
          items: savedSearches.map((entry) => {
            const href = searchPageHref(entry.query, filtersOf(entry.filters));
            return {
              id: `saved:${entry.id}`,
              label: entry.name,
              description: entry.query,
              icon: Bookmark,
              href,
              onSelect: () => go(href, false),
            };
          }),
        });
      }
      const items = (viewed.data ?? []).flatMap<CommandItem>((item) => {
        const href = itemHref({ id: item.id, kind: item.kind, title: item.title, link: null }, item.spaceKey);
        if (!href) return [];
        return [
          {
            id: `viewed:${item.id}`,
            label: item.title,
            description: item.spaceName,
            icon: History,
            href,
            onSelect: () => go(href, false),
          },
        ];
      });
      if (items.length > 0)
        list.push({ heading: t("search.quick.recentlyViewed"), items: items.slice(0, 5) });
      return [...linkGroups, ...list, ...otherCommands];
    }

    const hits = current?.results ?? [];
    const hitItem = (hit: SearchHit, withPath: boolean): CommandItem[] => {
      const href = hitHref(hit);
      if (!href) return [];
      return [
        {
          id: `hit:${hit.type}:${hit.id}`,
          label: hitTitle(t, hit),
          description: withPath ? (
            `${hitPath(t, hit).join(" › ")} · ${format.calendarDate(hit.updatedAt)}`
          ) : (
            <Highlighted parts={hit.excerpt} />
          ),
          icon: hitIcon(hit),
          href,
          onSelect: () => go(href),
        },
      ];
    };
    const content = hits.filter((hit) => hit.type !== "comment");
    const local = inSpace ? content.filter((hit) => hit.space?.id === space.id) : content;
    const elsewhere = inSpace ? content.filter((hit) => hit.space?.id !== space.id) : [];
    const createItems: CommandItem[] =
      createTarget && canCreatePage
        ? [
            {
              id: "create:page",
              label: t(
                createTarget.knowledgeBase ? "search.quick.createArticle" : "search.quick.createPage",
                {
                  title: typed,
                },
              ),
              description: t("search.quick.createIn", { space: createTarget.name }),
              icon: FilePlus,
              onSelect: () => createTarget.create("page", typed),
            },
          ]
        : [];
    const commandHeading = t("commands.commands");
    const commandList: CommandGroup[] = otherCommands.some((group) => group.heading === commandHeading)
      ? otherCommands.map((group) =>
          group.heading === commandHeading ? { ...group, items: [...createItems, ...group.items] } : group,
        )
      : [{ heading: commandHeading, items: createItems }, ...otherCommands];
    const list: CommandGroup[] = [
      ...linkGroups,
      ...commandList,
      {
        heading: inSpace
          ? t("search.quick.inSpace", { space: spaceName(space) })
          : t("search.quick.pagesAndPosts"),
        items: local.flatMap((hit) => hitItem(hit, true)),
      },
      {
        heading: t("search.quick.comments"),
        items: hits.filter((hit) => hit.type === "comment").flatMap((hit) => hitItem(hit, false)),
      },
      { heading: t("search.quick.otherSpaces"), items: elsewhere.flatMap((hit) => hitItem(hit, true)) },
    ];
    if (settled && !spaces.isPlaceholderData) {
      list.push({
        heading: t("search.quick.spaces"),
        items: (spaces.data?.items ?? []).map((entry) => {
          const href = `/spaces/${encodeURIComponent(entry.key)}`;
          return {
            id: `space:${entry.id}`,
            label: entry.displayName || entry.key,
            description: entry.key,
            icon: Layers,
            href,
            onSelect: () => go(href),
          };
        }),
      });
    }
    if (settled && !people.isPlaceholderData) {
      list.push({
        heading: t("search.quick.people"),
        items: (people.data?.items ?? [])
          .filter((person) => person.type !== "service")
          .map((person) => {
            const href = searchPageHref("", { ...noFilters, authorIds: [person.id] });
            return {
              id: `person:${person.id}`,
              label: person.name,
              description: t("search.quick.contentBy"),
              icon: UserRound,
              href,
              onSelect: () => go(href),
            };
          }),
      });
    }
    const more: CommandItem[] = [];
    if (inSpace && current && local.length === 0) {
      more.push({
        id: "scope:all",
        label: t("search.quick.searchAllSpaces"),
        icon: Globe,
        keepOpen: true,
        onSelect: () => setScope("all"),
      });
    }
    if (more.length > 0) list.push({ heading: t("search.quick.more"), items: more });
    return list;
  })();

  const nothingFound = typed.length > 0 && current !== null && current.results.length === 0;
  const status = results.isError ? (
    <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
      <span className="flex-1 text-danger">
        {t("search.quick.failed")} {problemMessage(t, results.error)}
      </span>
      <Button size="sm" onClick={() => void results.refetch()}>
        {t("ui.retry")}
      </Button>
    </div>
  ) : organizationId === null ? (
    <p className="text-sm text-text-muted">{t("search.noOrganization")}</p>
  ) : nothingFound ? (
    <p className="flex items-center gap-2 text-sm text-text-muted">
      <SearchX aria-hidden="true" className="size-icon-md shrink-0" />
      {inSpace
        ? t("search.quick.nothingInSpace", { query: typed, space: spaceName(space) })
        : t("search.quick.nothing", { query: typed })}
    </p>
  ) : null;

  const mod = isApplePlatform() ? "⌘" : "Ctrl";
  return (
    <CommandPalette
      open
      onOpenChange={onOpenChange}
      label={t("search.quick.label")}
      placeholder={t("search.quick.placeholder")}
      emptyText={t("search.quick.empty")}
      groups={groups}
      query={query}
      onQueryChange={setQuery}
      filter={false}
      busy={busy}
      busyLabel={t("search.searching")}
      closeHint="Esc"
      status={status}
      toolbar={
        space ? (
          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">{t("search.quick.scope")}</legend>
            <ScopeButton pressed={scope === "space"} icon={Layers} onClick={() => setScope("space")}>
              {t("search.quick.spaceFirst", { space: spaceName(space) })}
            </ScopeButton>
            <ScopeButton pressed={scope === "all"} icon={Globe} onClick={() => setScope("all")}>
              {t("search.quick.allSpaces")}
            </ScopeButton>
          </fieldset>
        ) : undefined
      }
      footer={
        <>
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> {t("search.quick.move")}
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> {t("search.quick.open")}
          </span>
          <span className="flex items-center gap-1">
            <Kbd>{mod}</Kbd>
            <Kbd>↵</Kbd> {t("search.quick.newTab")}
          </span>
          {typed ? (
            <a
              href={searchPageHref(typed, noFilters)}
              onClick={(event) => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
                event.preventDefault();
                onOpenChange(false);
                go(searchPageHref(typed, noFilters));
              }}
              className="text-accent hover:underline focus-visible:focus-ring sm:ml-auto"
            >
              {t("search.quick.allResults", { query: typed })}
            </a>
          ) : (
            <span className="sm:ml-auto">{t("search.onlyReadable")}</span>
          )}
        </>
      }
    />
  );
}

function ScopeButton({
  pressed,
  icon: Icon,
  onClick,
  children,
}: {
  pressed: boolean;
  icon: typeof Layers;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className="inline-flex min-h-hit max-w-full items-center gap-1 rounded-full border border-border bg-surface px-3 text-sm font-medium text-text-muted focus-visible:focus-ring aria-pressed:border-transparent aria-pressed:bg-selected aria-pressed:text-selected-text"
    >
      <Icon aria-hidden="true" className="size-icon-sm shrink-0" />
      <span className="truncate" title={children}>
        {children}
      </span>
    </button>
  );
}
