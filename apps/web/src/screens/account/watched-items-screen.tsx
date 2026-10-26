import {
  Button,
  EmptyState,
  FilterChips,
  Select,
  Table,
  TableToolbar,
  Tabs,
  TruncatedText,
  useToast,
} from "@lunedo/ui";
import { Link } from "@tanstack/react-router";
import { Bell, BellOff, BookOpen, Boxes, CalendarDays, FileText } from "lucide-react";
import { type Key, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePaged, useSorted } from "../../components/table-state.js";
import { LoadError, useFailureToast } from "../../errors/failure.js";
import {
  useChangeWatches,
  useWatchedList,
  type WatchedEntry,
  type WatchTarget,
} from "../../notifications/watching-api.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { contentHref } from "../../spaces/item-paths.js";
import { SettingsPage } from "../settings/settings-page.js";

export function watchedPath(entry: WatchedEntry): string | null {
  if (entry.kind === "space") return `/spaces/${encodeURIComponent(entry.spaceKey)}`;
  return contentHref({ kind: entry.kind, number: entry.target.number, title: entry.title }, entry.spaceKey);
}

export type WatchedType = "space" | "page" | "article" | "meeting";

export function watchedType(entry: WatchedEntry): WatchedType {
  if (entry.kind === "space") return "space";
  if (entry.kind === "meetingSeries" || entry.kind === "meetingTopic") return "meeting";
  return entry.spaceType === "knowledgeBase" ? "article" : "page";
}

const TYPE_ICONS = { space: Boxes, page: FileText, article: BookOpen, meeting: CalendarDays } as const;

const keyOf = (entry: WatchedEntry) => `${entry.target.type}:${entry.target.id}`;

export function WatchedItemsScreen() {
  const { t } = useTranslation();
  const format = useFormat();
  const list = useWatchedList();
  const change = useChangeWatches();
  const { toast } = useToast();
  const failed = useFailureToast();
  const items = list.data?.items ?? [];
  const [tab, setTab] = useState<"watching" | "muted">("watching");
  const [type, setType] = useState<"all" | WatchedType>("all");
  const [spaceId, setSpaceId] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<Key>>(new Set());
  const needle = search.trim().toLowerCase();
  const inTab = items.filter((entry) => entry.state === tab);
  const spaces = [...new Map(inTab.map((entry) => [entry.spaceId, entry.spaceName]))].sort((left, right) =>
    left[1].localeCompare(right[1]),
  );
  const filtered = inTab.filter(
    (entry) =>
      (type === "all" || watchedType(entry) === type) &&
      (spaceId === "all" || entry.spaceId === spaceId) &&
      (!needle ||
        entry.title.toLowerCase().includes(needle) ||
        entry.spaceName.toLowerCase().includes(needle)),
  );
  const sorted = useSorted(filtered, { key: "since", direction: "desc" }, (entry, key) =>
    key === "name"
      ? entry.title.toLowerCase()
      : key === "space"
        ? entry.spaceName.toLowerCase()
        : entry.updatedAt,
  );
  const paged = usePaged(sorted.rows);
  const chosen = items.filter((entry) => selected.has(keyOf(entry)));
  const reset = () => {
    setSelected(new Set());
    paged.reset();
  };

  const apply = (entries: readonly WatchedEntry[], next: "remove" | "mute") => {
    if (entries.length === 0) return;
    const changes = entries.map((entry) => ({
      target: entry.target as WatchTarget,
      state: next === "mute" ? ("muted" as const) : null,
      ...(next === "mute" ? { keepActionable: true } : {}),
    }));
    const previous = entries.map((entry) => ({
      target: entry.target as WatchTarget,
      state: entry.state,
      keepActionable: entry.keepActionable,
    }));
    change.mutate(changes, {
      onSuccess: () => {
        setSelected(new Set());
        toast({
          title:
            entries.length === 1
              ? t(`notifications.watching.bulk.${next}One`, { name: entries[0]?.title ?? "" })
              : t(`notifications.watching.bulk.${next}`, { count: entries.length }),
          undo: { onUndo: () => change.mutate(previous) },
        });
      },
      onError: (error) => failed(t("notifications.watching.changeFailed"), error, () => apply(entries, next)),
    });
  };

  return (
    <SettingsPage
      wide
      title={t("notifications.watching.screenTitle")}
      description={t("notifications.watching.screenDescription")}
    >
      {list.isError ? (
        <LoadError
          what={t("notifications.watching.loadFailed")}
          error={list.error}
          onRetry={() => list.refetch()}
        />
      ) : null}
      {list.isSuccess && items.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={t("notifications.watching.none")}
          description={t("notifications.watching.noneDescription")}
        />
      ) : (
        <Tabs
          label={t("notifications.watching.screenTitle")}
          value={tab}
          onValueChange={(value) => {
            setTab(value as "watching" | "muted");
            setSpaceId("all");
            reset();
          }}
          tabs={[
            {
              value: "watching",
              label: t("notifications.watching.states.watching"),
              count: items.filter((entry) => entry.state === "watching").length,
            },
            {
              value: "muted",
              label: t("notifications.watching.states.muted"),
              count: items.filter((entry) => entry.state === "muted").length,
            },
          ]}
        >
          <div className="flex flex-col gap-3">
            <TableToolbar
              search={{
                value: search,
                onChange: (value) => {
                  setSearch(value);
                  reset();
                },
                label: t("notifications.watching.search"),
                placeholder: t("notifications.watching.search"),
              }}
              filters={
                <>
                  <FilterChips
                    label={t("notifications.watching.typeFilter")}
                    value={type}
                    onValueChange={(value) => {
                      setType(value as "all" | WatchedType);
                      reset();
                    }}
                    options={[
                      { value: "all", label: t("notifications.watching.types.all") },
                      { value: "space", label: t("notifications.watching.types.space") },
                      { value: "page", label: t("notifications.watching.types.page") },
                      { value: "article", label: t("notifications.watching.types.article") },
                      { value: "meeting", label: t("notifications.watching.types.meeting") },
                    ]}
                  />
                  {spaces.length > 1 ? (
                    <Select
                      aria-label={t("notifications.watching.spaceFilter")}
                      className="w-auto max-w-field"
                      value={spaceId}
                      onValueChange={(value) => {
                        setSpaceId(value);
                        reset();
                      }}
                      options={[
                        { value: "all", label: t("notifications.watching.allSpaces") },
                        ...spaces.map(([id, name]) => ({ value: id, label: name })),
                      ]}
                    />
                  ) : null}
                </>
              }
              pagination={paged.pagination}
            />
            <Table
              caption={t(`notifications.watching.states.${tab}`)}
              rowKey={keyOf}
              rows={paged.rows}
              loading={list.isPending}
              sort={sorted.sort}
              onSortChange={sorted.setSort}
              pagination={paged.pagination}
              empty={<p className="text-text-muted">{t("notifications.watching.noMatch")}</p>}
              selection={{
                selected,
                onChange: setSelected,
                rowLabel: (entry) => t("notifications.watching.select", { name: entry.title }),
                bulkBar: () => (
                  <>
                    <span>{t("notifications.watching.selected", { count: chosen.length })}</span>
                    <span className="ml-auto flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={BellOff}
                        onClick={() => apply(chosen, "remove")}
                      >
                        {tab === "muted"
                          ? t("notifications.watching.unmuteAction")
                          : t("notifications.watching.unwatch")}
                      </Button>
                      {tab === "watching" ? (
                        <Button size="sm" variant="secondary" onClick={() => apply(chosen, "mute")}>
                          {t("notifications.watching.muteAction")}
                        </Button>
                      ) : null}
                      <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                        {t("notifications.watching.clearSelection")}
                      </Button>
                    </span>
                  </>
                ),
              }}
              columns={[
                {
                  key: "name",
                  header: t("notifications.watching.name"),
                  sortable: true,
                  grow: true,
                  cell: (entry) => {
                    const path = watchedPath(entry);
                    const Glyph = TYPE_ICONS[watchedType(entry)];
                    return (
                      <span className="flex min-w-0 items-center gap-2">
                        <Glyph aria-hidden="true" className="size-icon-md shrink-0 text-text-muted" />
                        {path ? (
                          <Link
                            to={path as never}
                            className="min-w-0 truncate font-medium hover:underline focus-visible:focus-ring"
                            title={entry.title}
                          >
                            {entry.title}
                          </Link>
                        ) : (
                          <TruncatedText text={entry.title} className="font-medium" />
                        )}
                      </span>
                    );
                  },
                },
                {
                  key: "type",
                  header: t("notifications.watching.type"),
                  hideBelow: "sm",
                  cell: (entry) => (
                    <span className="whitespace-nowrap">
                      {t(`notifications.watching.typeNames.${watchedType(entry)}`)}
                    </span>
                  ),
                },
                {
                  key: "space",
                  header: t("notifications.watching.space"),
                  sortable: true,
                  hideBelow: "md",
                  cell: (entry) => <TruncatedText text={entry.spaceName} className="max-w-field" />,
                },
                {
                  key: "why",
                  header: t("notifications.watching.why"),
                  hideBelow: "md",
                  cell: (entry) => (
                    <span
                      className="whitespace-nowrap text-text-muted"
                      title={entry.automatic ? t("notifications.watching.automatic") : undefined}
                    >
                      {entry.automatic
                        ? t("notifications.watching.reasons.automatic")
                        : entry.state === "muted"
                          ? t("notifications.watching.reasons.muted")
                          : t("notifications.watching.reasons.chosen")}
                    </span>
                  ),
                },
                {
                  key: "since",
                  header: t("notifications.watching.since"),
                  sortable: true,
                  hideBelow: "md",
                  cell: (entry) => (
                    <span className="whitespace-nowrap text-text-muted">{format.date(entry.updatedAt)}</span>
                  ),
                },
                {
                  key: "actions",
                  sticky: true,
                  align: "end",
                  header: <span className="sr-only">{t("settings.actions")}</span>,
                  cell: (entry) => (
                    <span className="flex justify-end opacity-100 sm:opacity-0 sm:group-hover/row:opacity-100 sm:group-focus-within/row:opacity-100">
                      <Button size="sm" variant="ghost" onClick={() => apply([entry], "remove")}>
                        {entry.state === "muted"
                          ? t("notifications.watching.unmuteAction")
                          : t("notifications.watching.unwatch")}
                      </Button>
                    </span>
                  ),
                },
              ]}
            />
          </div>
        </Tabs>
      )}
    </SettingsPage>
  );
}
