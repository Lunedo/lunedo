import {
  Button,
  classNames,
  EmptyState,
  focusWhenShown,
  Popover,
  Skeleton,
  Spinner,
  Tabs,
  WIDE_HIT_AREA,
} from "@lunedo/ui";
import { Link } from "@tanstack/react-router";
import { BellOff, CheckCheck, Settings } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LoadError } from "../errors/failure.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { NotificationEntry } from "./notification-entry.js";
import { type NotificationItem, useMarkAllRead, useNotificationList } from "./notifications-api.js";

type Filter = "all" | "unread";

export function groupByDay(
  items: readonly NotificationItem[],
  now = new Date(),
): { key: "today" | "yesterday" | "earlier"; items: NotificationItem[] }[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const yesterday = new Date(start.getTime() - 86_400_000);
  const groups = {
    today: [] as NotificationItem[],
    yesterday: [] as NotificationItem[],
    earlier: [] as NotificationItem[],
  };
  for (const item of items) {
    const updated = new Date(item.updatedAt);
    if (updated >= start) groups.today.push(item);
    else if (updated >= yesterday) groups.yesterday.push(item);
    else groups.earlier.push(item);
  }
  return (["today", "yesterday", "earlier"] as const)
    .map((key) => ({ key, items: groups[key] }))
    .filter((group) => group.items.length > 0);
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
      {open ? <NotificationList onClose={() => onOpenChange(false)} /> : null}
    </Popover>
  );
}

function NotificationList({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const format = useFormat();
  const [filter, setFilter] = useState<Filter>("all");
  const list = useNotificationList(filter === "unread");
  const markAll = useMarkAllRead();
  const body = useRef<HTMLDivElement>(null);
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const hasUnread = items.some((item) => item.readAt === null);

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

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move between the notifications like in a menu
    <div onKeyDown={onKeyDown} className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 px-4 pt-3">
        <h2 id="notifications-title" className="min-w-0 flex-1 font-semibold wrap-anywhere">
          {t("notifications.title")}
        </h2>
        {hasUnread ? (
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
        ) : null}
      </header>
      <div className="flex min-h-0 flex-1 flex-col px-2">
        <Tabs
          label={t("notifications.filter")}
          value={filter}
          onValueChange={(value) => setFilter(value as Filter)}
          tabs={[
            { value: "all", label: t("notifications.all") },
            { value: "unread", label: t("notifications.unread") },
          ]}
          fill
        >
          <div ref={body} className="pb-2">
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
              filter === "unread" ? (
                <EmptyState
                  icon={CheckCheck}
                  title={t("notifications.allRead")}
                  action={
                    <Button variant="secondary" onClick={() => setFilter("all")}>
                      {t("notifications.showAll")}
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={BellOff}
                  title={t("notifications.none")}
                  description={t("notifications.noneDescription")}
                />
              )
            ) : null}
            {groupByDay(items).map((group) => (
              <section key={group.key} aria-labelledby={`notifications-${group.key}`} className="pt-2">
                <h3
                  id={`notifications-${group.key}`}
                  className="px-2 pb-1 font-semibold text-text-muted text-xs uppercase tracking-label"
                >
                  {t(`notifications.groups.${group.key}`)}
                </h3>
                <ul className="flex flex-col">
                  {group.items.map((item) => (
                    <NotificationEntry key={item.id} item={item} format={format} onNavigate={onClose} />
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
        </Tabs>
      </div>
      <footer className="flex justify-end border-t border-border px-4 py-2">
        <Link
          to="/settings/notifications"
          onClick={onClose}
          className={classNames(
            WIDE_HIT_AREA,
            "inline-flex h-control-sm items-center gap-1 rounded-sm text-sm font-medium text-accent hover:underline focus-visible:focus-ring",
          )}
        >
          <Settings aria-hidden="true" className="size-icon-sm" />
          {t("notifications.preferences")}
        </Link>
      </footer>
    </div>
  );
}
