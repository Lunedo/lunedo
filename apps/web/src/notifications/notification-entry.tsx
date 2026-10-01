import { IconButton } from "@pagehall/ui";
import { useNavigate } from "@tanstack/react-router";
import { Bell, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Formatter } from "../format/format.js";
import { translateKey } from "../i18n/translate.js";
import { notificationTypes } from "./notification-types.js";
import { type NotificationItem, useMarkRead } from "./notifications-api.js";

export function notificationText(
  t: Parameters<typeof translateKey>[0],
  item: NotificationItem,
  format: Formatter,
): string {
  const params = Object.fromEntries(
    Object.entries((item.params ?? {}) as Record<string, unknown>).map(([key, value]) => [
      key,
      value === null
        ? translateKey(t, "common.unknown")
        : typeof value === "string" && /^\d{4}-\d{2}-\d{2}(T|$)/.test(value)
          ? format.date(value)
          : value,
    ]),
  );
  return translateKey(t, `notifications.types.${item.type}`, {
    ...params,
    count: item.count,
    actor: item.actor?.name ?? "",
  });
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
  const definition = notificationTypes.list().find((entry) => entry.id === item.type);
  const Icon = definition?.icon ?? Bell;
  const link = definition?.link(item) ?? null;
  const unread = item.readAt === null;
  const text = notificationText(t, item, format);

  const open = () => {
    if (unread) markRead.mutate(item.id);
    if (!link) return;
    onNavigate();
    void navigate({ to: link.to as never, params: link.params as never });
  };

  return (
    <li className="group relative flex items-start gap-3 rounded-md px-2 py-2 hover:bg-hover">
      <span
        aria-hidden="true"
        className={`mt-2 size-2 shrink-0 rounded-full ${unread ? "bg-accent" : "bg-transparent"}`}
      />
      <Icon aria-hidden="true" className="mt-1 size-icon-md shrink-0 text-text-muted" />
      <button
        type="button"
        onClick={open}
        className="min-w-0 flex-1 text-start focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className={`block ${unread ? "font-medium" : ""}`}>{text}</span>
        <span className="block text-sm text-text-muted">
          {item.count > 1 ? `${t("notifications.times", { count: item.count })} · ` : ""}
          <time dateTime={item.updatedAt}>{format.relative(item.updatedAt)}</time>
        </span>
        {unread ? <span className="sr-only">{t("notifications.unreadLabel")}</span> : null}
      </button>
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
