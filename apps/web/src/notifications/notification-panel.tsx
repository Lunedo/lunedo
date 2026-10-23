import {
  Button,
  EmptyState,
  focusWhenShown,
  IconButton,
  SegmentedControl,
  Skeleton,
  Spinner,
  useOpener,
} from "@lunedo/ui";
import { useNavigate } from "@tanstack/react-router";
import { BellOff, CheckCheck, Settings, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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

export function NotificationPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const format = useFormat();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("all");
  const list = useNotificationList(filter === "unread");
  const markAll = useMarkAllRead();
  const panel = useRef<HTMLElement>(null);
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const hasUnread = items.some((item) => item.readAt === null);
  const restoreFocus = useOpener();
  const close = useCallback(() => {
    onClose();
    restoreFocus();
  }, [onClose, restoreFocus]);

  useEffect(() => {
    panel.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close]);

  const loadMore = async () => {
    const before = panel.current?.querySelectorAll("[data-notification]").length ?? 0;
    await list.fetchNextPage();
    focusWhenShown(() => panel.current?.querySelectorAll<HTMLElement>("[data-notification]")[before]);
  };

  return (
    <aside
      ref={panel}
      tabIndex={-1}
      aria-labelledby="notifications-title"
      className="absolute inset-y-0 right-0 z-30 flex w-panel max-w-full flex-col border-border border-l bg-surface shadow-popover outline-none max-sm:left-0 max-sm:w-auto"
    >
      <header className="flex items-center gap-2 border-border border-b px-4 py-3">
        <h2 id="notifications-title" className="min-w-0 flex-1 font-semibold text-lg wrap-anywhere">
          {t("notifications.title")}
        </h2>
        <IconButton
          label={t("notifications.preferences")}
          icon={Settings}
          onClick={() => {
            onClose();
            void navigate({ to: "/settings/notifications" });
          }}
        />
        <IconButton label={t("notifications.close")} icon={X} onClick={close} />
      </header>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
        <SegmentedControl
          label={t("notifications.filter")}
          value={filter}
          onValueChange={(value) => setFilter(value as Filter)}
          options={[
            { value: "all", label: t("notifications.all") },
            { value: "unread", label: t("notifications.unread") },
          ]}
        />
        <Button
          variant="secondary"
          size="sm"
          icon={CheckCheck}
          disabled={!hasUnread}
          loading={markAll.isPending}
          onClick={() => markAll.mutate(new Date().toISOString())}
        >
          {t("notifications.markAllRead")}
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
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
    </aside>
  );
}
