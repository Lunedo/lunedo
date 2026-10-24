import { Button, formatDuration, IconButton, useToast } from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Bell, BellOff, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { PersonAvatar } from "../components/person-avatar.js";
import { useFailureToast } from "../errors/failure.js";
import type { Formatter } from "../format/format.js";
import { translateKey } from "../i18n/translate.js";
import { AccessRequestActions } from "../sharing/access-requests.js";
import { useSession } from "../shell/shell-context.js";
import { notificationTypes } from "./notification-types.js";
import { type NotificationItem, useMarkRead } from "./notifications-api.js";
import { useChangeWatch, useKnownWatchStatus } from "./watching-api.js";

function statusLabel(t: Parameters<typeof translateKey>[0], params: Record<string, unknown>): string {
  if (typeof params.statusName === "string") return params.statusName;
  if (typeof params.statusBuiltIn === "string")
    return translateKey(t, `pageStatus.builtIn.${params.statusBuiltIn}`);
  return "none";
}

export function notificationText(
  t: Parameters<typeof translateKey>[0],
  item: NotificationItem,
  format: Formatter,
  accountId?: string,
): string {
  const raw = (item.params ?? {}) as Record<string, unknown>;
  const dateTimes = notificationTypes.list().find((entry) => entry.id === item.type)?.dateTimeParams ?? [];
  const params = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [
      key,
      value === null
        ? translateKey(t, "common.unknown")
        : typeof value === "string" && /^\d{4}-\d{2}-\d{2}(T|$)/.test(value)
          ? dateTimes.includes(key)
            ? format.calendarDateTime(value)
            : format.calendarDate(value.length === 10 ? `${value}T12:00:00Z` : value)
          : value,
    ]),
  );
  const minutes = raw.minutes;
  return translateKey(t, `notifications.types.${item.type}`, {
    ...params,
    ...(typeof minutes === "number" ? { duration: formatDuration(minutes, format.settings.language) } : {}),
    count: item.count,
    actor: item.actor?.name ?? "",
    actorCount: item.actorCount,
    others: Math.max(item.actorCount - 1, 0),
    own: accountId !== undefined && raw.ownerId === accountId ? "true" : "false",
    status: statusLabel(t, raw),
  });
}

export function countText(t: Parameters<typeof translateKey>[0], item: NotificationItem): string {
  const key = `notifications.counts.${item.type}`;
  const specific = translateKey(t, key, { count: item.count });
  return specific === key ? translateKey(t, "notifications.times", { count: item.count }) : specific;
}

function kindLabel(t: Parameters<typeof translateKey>[0], type: string): string | null {
  const key = `notifications.labels.${type}`;
  const label = translateKey(t, key);
  return label === key ? null : label;
}

function PendingRequest({ requestId }: { requestId: string }) {
  const { t } = useTranslation();
  const session = useSession();
  const entry = useQuery({
    queryKey: ["accessRequests", requestId],
    queryFn: () =>
      request(() => api.GET("/api/v1/access-requests/{requestId}", { params: { path: { requestId } } })),
    throwOnError: false,
    retry: false,
  });
  if (!entry.data || entry.data.status !== "open" || entry.data.requester.id === session.account?.id)
    return null;
  return (
    <>
      {entry.data.message ? (
        <span className="block text-sm text-text-muted wrap-anywhere">
          {t("notifications.quoted", { text: entry.data.message })}
        </span>
      ) : null}
      <AccessRequestActions entry={entry.data} />
    </>
  );
}

export function NotificationEntry({
  item,
  format,
  onNavigate,
}: {
  item: NotificationItem;
  format: Formatter;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const markRead = useMarkRead();
  const session = useSession();
  const changeWatch = useChangeWatch();
  const { toast } = useToast();
  const failed = useFailureToast();
  const definition = notificationTypes.list().find((entry) => entry.id === item.type);
  const Icon = definition?.icon ?? Bell;
  const link = definition?.link(item) ?? null;
  const unread = item.readAt === null;
  const text = notificationText(t, item, format, session.account?.id);
  const itemTitle = String((item.params as Record<string, unknown> | null)?.itemTitle ?? "");
  const watchedItem = definition?.watched && item.target.id ? item.target.id : null;
  const known = useKnownWatchStatus({ type: "item", id: watchedItem ?? item.id }).data;
  const stillWatched = known === undefined || known.effective?.state === "watching";

  const open = () => {
    if (unread) markRead.mutate(item.id);
    if (!link) return;
    onNavigate();
    void navigate({ to: link.to as never, params: link.params as never, search: link.search as never });
  };

  const stopWatching = (itemId: string) => {
    const target = { type: "item" as const, id: itemId };
    changeWatch.mutate(
      { target, change: { state: "notWatching" } },
      {
        onSuccess: () =>
          toast({
            title: t("notifications.stoppedWatching", { name: itemTitle }),
            undo: { onUndo: () => changeWatch.mutate({ target, change: { state: null } }) },
          }),
        onError: (error) =>
          failed(t("notifications.watching.changeFailed"), error, () => stopWatching(itemId)),
      },
    );
  };

  const watchAgain = (itemId: string) => {
    const target = { type: "item" as const, id: itemId };
    changeWatch.mutate(
      { target, change: { state: "watching" } },
      {
        onSuccess: () => toast({ title: t("notifications.watchingAgain", { name: itemTitle }) }),
        onError: (error) => failed(t("notifications.watching.changeFailed"), error, () => watchAgain(itemId)),
      },
    );
  };

  return (
    <li className="group relative flex items-start gap-3 rounded-md px-2 py-2 hover:bg-hover">
      <span
        aria-hidden="true"
        className={`mt-2 size-2 shrink-0 rounded-full ${unread ? "bg-accent" : "bg-transparent"}`}
      />
      {item.actor?.id && item.actor.name ? (
        <span className="mt-1 shrink-0">
          <PersonAvatar id={item.actor.id} name={item.actor.name} size="sm" decorative />
        </span>
      ) : (
        <Icon aria-hidden="true" className="mt-1 size-icon-md shrink-0 text-text-muted" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <button
          type="button"
          data-notification=""
          onClick={open}
          className="min-w-0 text-start focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span className={`block wrap-anywhere ${unread ? "font-medium" : ""}`}>{text}</span>
          <span className="block text-sm text-text-muted">
            {kindLabel(t, item.type) ? `${kindLabel(t, item.type)} · ` : ""}
            {item.count > 1 ? `${countText(t, item)} · ` : ""}
            <time dateTime={item.updatedAt} title={format.dateTime(item.updatedAt)}>
              {format.short(item.updatedAt)}
            </time>
          </span>
          {unread ? <span className="sr-only">{t("notifications.unreadLabel")}</span> : null}
        </button>
        {item.type === "access.requested" && item.target.id ? (
          <PendingRequest requestId={item.target.id} />
        ) : null}
        {watchedItem && stillWatched ? (
          <div>
            <Button variant="secondary" size="sm" icon={BellOff} onClick={() => stopWatching(watchedItem)}>
              {t("notifications.stopWatching")}
            </Button>
          </div>
        ) : null}
        {watchedItem && !stillWatched ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-text-muted">{t("notifications.notWatched")}</span>
            <Button variant="secondary" size="sm" icon={Bell} onClick={() => watchAgain(watchedItem)}>
              {t("notifications.watchAgain")}
            </Button>
          </div>
        ) : null}
      </div>
      {unread ? (
        <IconButton
          label={t("notifications.markRead")}
          icon={Check}
          size="sm"
          onClick={() => markRead.mutate(item.id)}
        />
      ) : null}
    </li>
  );
}
