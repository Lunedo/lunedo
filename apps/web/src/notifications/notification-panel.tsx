import {
  Button,
  classNames,
  EmptyState,
  FilterMenu,
  focusWhenShown,
  Popover,
  Skeleton,
  Spinner,
  Switch,
  Tabs,
  WIDE_HIT_AREA,
} from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BellOff, CheckCheck, Settings } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDebounced } from "../components/table-state.js";
import { LoadError } from "../errors/failure.js";
import type { Weekday } from "../format/format.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { useDocumentTitle } from "../screens/settings/settings-page.js";
import { spacesQuery } from "../search/search-api.js";
import { useOrganizationState } from "../shell/shell-context.js";
import { NotificationEntry } from "./notification-entry.js";
import {
  type NotificationFilter,
  type NotificationItem,
  type NotificationKind,
  useMarkAllRead,
  useNotificationList,
  unreadCountLabel,
  useUnreadCount,
  useUnreadCountOf,
} from "./notifications-api.js";

type Kind = "all" | NotificationKind;

type DayBucket = "today" | "yesterday" | "thisWeek" | "older";

const WEEKDAY_INDEX: Record<Weekday, number> = { sunday: 0, monday: 1, saturday: 6 };

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function groupByDay(
  items: readonly NotificationItem[],
  now = new Date(),
  weekStart: Weekday = "monday",
): { key: DayBucket; items: NotificationItem[] }[] {
  const today = startOfDay(now);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const offset = (today.getDay() - WEEKDAY_INDEX[weekStart] + 7) % 7;
  const week = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
  const groups: { key: DayBucket; items: NotificationItem[] }[] = [];
  for (const item of items) {
    const date = new Date(item.updatedAt);
    const key: DayBucket =
      date >= today ? "today" : date >= yesterday ? "yesterday" : date >= week ? "thisWeek" : "older";
    const existing = groups.find((group) => group.key === key);
    if (existing) existing.items.push(item);
    else groups.push({ key, items: [item] });
  }
  return groups;
}

export function NotificationPopover({
  open,
  onOpenChange,
  trigger,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
}) {
  return (
    <Popover
      trigger={trigger}
      open={open}
      onOpenChange={onOpenChange}
      align="end"
      variant="panel"
      labelledBy="notifications-title"
    >
      {open ? <NotificationFeed variant="popover" onClose={() => onOpenChange(false)} /> : null}
    </Popover>
  );
}

export function NotificationsScreen() {
  const { t } = useTranslation();
  useDocumentTitle(t("notifications.title"));
  return (
    <main
      id="main"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the content area scrolls and must be reachable by keyboard
      tabIndex={0}
      className="min-w-0 flex-1 overflow-y-auto outline-none focus-visible:focus-ring"
    >
      <div className="mx-auto flex w-full max-w-content flex-col px-4 pt-6 pb-12 md:px-8">
        <NotificationFeed variant="page" onClose={() => undefined} />
      </div>
    </main>
  );
}

function SpaceFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  const organization = useOrganizationState();
  const [search, setSearch] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const term = useDebounced(search.trim());
  const spaces = useQuery({
    ...spacesQuery(organization.organizationId ?? "", term, 20),
    enabled: organization.organizationId !== null,
    throwOnError: false,
  });
  const options = [
    { value: "", label: t("notifications.allSpaces") },
    ...(spaces.data?.items ?? []).map((space) => ({ value: space.id, label: space.name || space.key })),
  ];
  return (
    <FilterMenu
      label={t("notifications.space")}
      value={value}
      options={options}
      {...(value
        ? { valueLabel: names[value] ?? options.find((option) => option.value === value)?.label ?? "" }
        : {})}
      search={{ value: search, onChange: setSearch, placeholder: t("notifications.findSpace") }}
      onValueChange={(next) => {
        const label = options.find((option) => option.value === next)?.label;
        if (next && label) setNames((current) => ({ ...current, [next]: label }));
        onChange(next);
      }}
    />
  );
}

function NotificationFeed({ variant, onClose }: { variant: "popover" | "page"; onClose: () => void }) {
  const { t } = useTranslation();
  const format = useFormat();
  const page = variant === "page";
  const [kind, setKind] = useState<Kind>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [spaceId, setSpaceId] = useState("");
  const filter: NotificationFilter = {
    unreadOnly,
    ...(kind === "all" ? {} : { kind }),
    ...(page && spaceId ? { spaceId } : {}),
    grouped: true,
  };
  const unreadAll = useUnreadCount().data;
  const unreadMentions = useUnreadCountOf("mentions").data;
  const unreadWatched = useUnreadCountOf("watched").data;
  const unreadRequests = useUnreadCountOf("requests", page).data;
  const counts: Record<Kind, number | undefined> = {
    all: unreadAll,
    mentions: unreadMentions,
    watched: unreadWatched,
    requests: unreadRequests,
  };
  const list = useNotificationList(filter);
  const markAll = useMarkAllRead();
  const body = useRef<HTMLDivElement>(null);
  const items = list.data?.pages.flatMap((entry) => entry.items) ?? [];
  const hasUnread = items.some(
    (item) => item.readAt === null || (item.group?.members.some((member) => member.readAt === null) ?? false),
  );
  const kinds: Kind[] = page ? ["all", "mentions", "watched", "requests"] : ["all", "mentions", "watched"];

  const loadMore = async () => {
    const before = body.current?.querySelectorAll("[data-notification]").length ?? 0;
    await list.fetchNextPage();
    focusWhenShown(() => body.current?.querySelectorAll<HTMLElement>("[data-notification]")[before]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const rows = [...(body.current?.querySelectorAll<HTMLElement>("[data-notification]") ?? [])];
    const index = rows.indexOf(document.activeElement as HTMLElement);
    const target =
      event.key === "ArrowDown"
        ? rows[index === -1 ? 0 : Math.min(index + 1, rows.length - 1)]
        : event.key === "ArrowUp"
          ? rows[index === -1 ? rows.length - 1 : Math.max(index - 1, 0)]
          : event.key === "Home"
            ? rows[0]
            : event.key === "End"
              ? rows.at(-1)
              : undefined;
    if (!target) return;
    event.preventDefault();
    target.focus();
  };

  const markAllButton = hasUnread ? (
    <button
      type="button"
      aria-busy={markAll.isPending || undefined}
      onClick={() => markAll.mutate(new Date().toISOString())}
      className={classNames(
        WIDE_HIT_AREA,
        "inline-flex h-control-sm shrink-0 items-center gap-1 rounded-sm px-1 text-sm font-medium text-accent hover:underline focus-visible:focus-ring",
      )}
    >
      {markAll.isPending ? (
        <Spinner label={t("ui.loading")} />
      ) : (
        <CheckCheck aria-hidden="true" className="size-icon-sm" />
      )}
      {t("notifications.markAllRead")}
    </button>
  ) : null;

  const content = (
    <div ref={body} className={page ? "pt-2" : "pb-2"}>
      {list.isPending ? (
        <div className="flex flex-col gap-3 p-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : null}
      {list.isError ? (
        <div className="p-2">
          <LoadError
            what={t("failures.loadNotifications")}
            error={list.error}
            onRetry={() => list.refetch()}
          />
        </div>
      ) : null}
      {list.isSuccess && items.length === 0 ? (
        unreadOnly ? (
          <EmptyState
            icon={CheckCheck}
            title={t("notifications.allRead")}
            action={
              <Button variant="secondary" onClick={() => setUnreadOnly(false)}>
                {t("notifications.showAll")}
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={BellOff}
            title={t(`notifications.emptyKinds.${kind}`)}
            description={t("notifications.noneDescription")}
          />
        )
      ) : null}
      {groupByDay(items, new Date(), format.firstDayOfWeek).map((group) => (
        <section key={group.key} aria-labelledby={`notifications-${variant}-${group.key}`} className="pt-2">
          <h3
            id={`notifications-${variant}-${group.key}`}
            className="border-b border-border px-2 pb-1 font-semibold text-text-muted text-xs uppercase tracking-label"
          >
            {t(`notifications.groups.${group.key}`)}
          </h3>
          <ul className="flex flex-col divide-y divide-border">
            {group.items.map((item) => (
              <NotificationEntry
                key={item.id}
                item={item}
                format={format}
                onNavigate={onClose}
                compact={!page}
              />
            ))}
          </ul>
        </section>
      ))}
      {list.hasNextPage ? (
        <div className="flex justify-center p-2">
          <Button variant="secondary" size="sm" onClick={() => void loadMore()}>
            {list.isFetchingNextPage ? <Spinner label={t("ui.loading")} /> : t("notifications.more")}
          </Button>
        </div>
      ) : null}
    </div>
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move between the notifications like in a menu
    <div onKeyDown={onKeyDown} className="flex min-h-0 flex-1 flex-col">
      <header className={classNames("flex flex-wrap items-center gap-2", page ? "pb-4" : "px-4 pt-3")}>
        {page ? (
          <h1
            id="notifications-title"
            className="w-full min-w-0 text-xl font-semibold tracking-heading wrap-anywhere sm:w-auto sm:flex-1"
          >
            {t("notifications.title")}
          </h1>
        ) : (
          <h2 id="notifications-title" className="min-w-0 flex-1 font-semibold wrap-anywhere">
            {t("notifications.title")}
          </h2>
        )}
        <Switch checked={unreadOnly} onCheckedChange={setUnreadOnly} label={t("notifications.unreadOnly")} />
        {page ? (
          <Link
            to="/settings/notifications"
            className={classNames(
              WIDE_HIT_AREA,
              "inline-flex h-control-sm items-center gap-1 rounded-sm text-sm font-medium text-accent hover:underline focus-visible:focus-ring",
            )}
          >
            <Settings aria-hidden="true" className="size-icon-sm" />
            {t("notifications.preferences")}
          </Link>
        ) : null}
      </header>
      <div className={classNames("flex min-h-0 flex-1 flex-col", page ? "" : "px-2")}>
        <Tabs
          label={t("notifications.filter")}
          value={kind}
          onValueChange={(value) => setKind(value as Kind)}
          tabs={kinds.map((value) => {
            const count = counts[value];
            return {
              value,
              label: t(`notifications.kinds.${value}`),
              ...(count ? { count: unreadCountLabel(count) } : {}),
            };
          })}
          fill={!page}
        >
          {page ? (
            <div className="flex flex-wrap items-center gap-2">
              <SpaceFilter value={spaceId} onChange={setSpaceId} />
              <span className="ml-auto">{markAllButton}</span>
            </div>
          ) : null}
          {content}
        </Tabs>
      </div>
      {page ? null : (
        <footer className="flex items-center justify-between gap-2 border-t border-border px-4 py-2">
          <Link
            to="/notifications"
            onClick={onClose}
            className={classNames(
              WIDE_HIT_AREA,
              "inline-flex h-control-sm items-center rounded-sm text-sm font-medium text-accent hover:underline focus-visible:focus-ring",
            )}
          >
            {t("notifications.showAllPage")}
          </Link>
          {markAllButton}
        </footer>
      )}
    </div>
  );
}
