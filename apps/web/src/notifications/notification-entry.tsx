import {
  Button,
  Checkbox,
  classNames,
  FieldError,
  formatDuration,
  IconButton,
  Input,
  Menu,
  TruncatedText,
  useToast,
} from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowUpRight,
  Bell,
  BellOff,
  Check,
  CircleDot,
  Ellipsis,
  type LucideIcon,
  Reply,
} from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { taskStatusesQuery } from "../collaboration/queries.js";
import { useSetTaskStatus } from "../collaboration/task-actions.js";
import { PersonAvatar } from "../components/person-avatar.js";
import { useFailureToast } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import type { Formatter } from "../format/format.js";
import { translateKey } from "../i18n/translate.js";
import { AccessRequestActions } from "../sharing/access-requests.js";
import { useSession } from "../shell/shell-context.js";
import { notificationTypes } from "./notification-types.js";
import { type NotificationItem, useMarkManyRead, useMarkRead, useMarkUnread } from "./notifications-api.js";
import { useChangeWatch, useKnownWatchStatus, type WatchTarget } from "./watching-api.js";

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
  if (!entry.data || entry.data.requester.id === session.account?.id) return null;
  if (entry.data.status !== "open") {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-text-muted">
        <Check aria-hidden="true" className="size-icon-sm" />
        {translateKey(t, `sharing.requests.status.${entry.data.status}`)}
      </span>
    );
  }
  return <AccessRequestActions entry={entry.data} variant="inline" />;
}

function TaskDone({ pageId, taskId, task }: { pageId: string; taskId: string; task: string }) {
  const { t } = useTranslation();
  const statuses = useQuery(taskStatusesQuery(pageId));
  const setStatus = useSetTaskStatus(pageId, { onPage: true });
  const done = statuses.data?.find((status) => status.id === taskId)?.done ?? false;
  return (
    <Checkbox
      label={t("notifications.task.done")}
      aria-label={t("notifications.task.doneNamed", { task })}
      checked={done}
      onCheckedChange={(checked) => setStatus.mutate({ taskId, done: checked === true })}
    />
  );
}

function ReplyForm({ commentId, onDone }: { commentId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const send = async () => {
    const value = text.trim();
    if (!value) {
      setInvalid(true);
      input.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await request(() =>
        api.POST("/api/v1/comments/{commentId}/replies", {
          params: { path: { commentId } },
          body: {
            body: {
              type: "doc",
              content: [{ type: "paragraph", content: [{ type: "text", text: value }] }],
            } as never,
          },
        }),
      );
      toast({ title: t("notifications.reply.sent"), variant: "success" });
      onDone();
    } catch (failure) {
      toast({
        title: t("notifications.reply.failed"),
        description: problemMessage(t, failure),
        variant: "error",
        action: { label: t("errors.retry"), onSelect: () => void send() },
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex flex-wrap items-start gap-2"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Input
          ref={input}
          aria-label={t("notifications.reply.label")}
          placeholder={t("notifications.reply.placeholder")}
          value={text}
          invalid={invalid}
          autoFocus
          onChange={(event) => {
            setText(event.target.value);
            setInvalid(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") onDone();
          }}
        />
        {invalid ? <FieldError>{t("notifications.reply.empty")}</FieldError> : null}
      </div>
      <Button type="submit" size="sm" variant="primary" loading={busy}>
        {t("notifications.reply.send")}
      </Button>
      <Button size="sm" variant="ghost" onClick={onDone}>
        {t("common.cancel")}
      </Button>
    </form>
  );
}

type NotificationGroup = NonNullable<NotificationItem["group"]>;

function groupPeople(t: Parameters<typeof translateKey>[0], group: NotificationGroup): string {
  const names = group.actors.slice(0, 2).map((actor) => actor.name);
  const others = Math.max(group.actorCount - names.length, 0);
  if (names.length === 0) return "";
  return others > 0
    ? t("notifications.group.byMore", { names: names.join(", "), count: others })
    : t("notifications.group.by", { names: names.join(", ") });
}

function GroupMembers({
  group,
  format,
  onNavigate,
}: {
  group: NotificationGroup;
  format: Formatter;
  onNavigate: () => void;
}) {
  const markRead = useMarkRead();
  return (
    <ul className="mt-1 flex flex-col divide-y divide-border border-y border-border">
      {group.members.map((member) => (
        <li key={member.id} className="flex items-center gap-2 py-1.5 text-sm">
          {member.actor?.id && member.actor.name ? (
            <PersonAvatar id={member.actor.id} name={member.actor.name} size="sm" decorative />
          ) : null}
          {member.itemId ? (
            <Link
              to="/spaces/$spaceKey/pages/$itemId/{-$slug}"
              params={{ spaceKey: group.spaceKey, itemId: member.itemId } as never}
              onClick={() => {
                if (member.readAt === null) markRead.mutate(member.id);
                onNavigate();
              }}
              className="min-w-0 truncate rounded-sm hover:underline focus-visible:focus-ring"
            >
              {member.itemTitle}
            </Link>
          ) : (
            <span className="min-w-0 truncate">{member.itemTitle}</span>
          )}
          {member.actor?.name ? (
            <span className="shrink-0 text-text-muted max-sm:hidden">{member.actor.name}</span>
          ) : null}
          <time dateTime={member.updatedAt} className="ml-auto shrink-0 text-xs text-text-muted">
            {format.short(member.updatedAt)}
          </time>
        </li>
      ))}
    </ul>
  );
}

export function NotificationEntry({
  item,
  format,
  onNavigate,
  compact = false,
}: {
  item: NotificationItem;
  format: Formatter;
  onNavigate: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const markRead = useMarkRead();
  const markManyRead = useMarkManyRead();
  const markUnread = useMarkUnread();
  const session = useSession();
  const changeWatch = useChangeWatch();
  const { toast } = useToast();
  const failed = useFailureToast();
  const [expanded, setExpanded] = useState(false);
  const [replying, setReplying] = useState(false);
  const group = item.group ?? null;
  const definition = notificationTypes.list().find((entry) => entry.id === item.type);
  const TypeIcon = definition?.icon ?? Bell;
  const link = group
    ? { to: "/spaces/$spaceKey", params: { spaceKey: group.spaceKey }, search: undefined }
    : (definition?.link(item) ?? null);
  const unreadIds = group
    ? group.members.filter((member) => member.readAt === null).map((member) => member.id)
    : item.readAt === null
      ? [item.id]
      : [];
  const unread = unreadIds.length > 0;
  const raw = (item.params ?? {}) as Record<string, unknown>;
  const itemTitle = String(raw.itemTitle ?? "");
  const commentId =
    (item.type === "comment.created" || item.type === "content.mentioned") &&
    typeof raw.commentId === "string"
      ? raw.commentId
      : null;
  const watchTarget: WatchTarget | null = group
    ? { type: "space", id: group.spaceId }
    : definition?.watched && item.target.id
      ? { type: "item", id: item.target.id }
      : null;
  const known = useKnownWatchStatus(watchTarget ?? { type: "item", id: item.id }).data;
  const stillWatched = watchTarget !== null && (known === undefined || known.effective?.state === "watching");
  const title = group
    ? t("notifications.group.title", { space: group.spaceName, count: group.members.length })
    : notificationText(t, item, format, session.account?.id);
  const meta = group
    ? groupPeople(t, group)
    : [kindLabel(t, item.type), item.count > 1 ? countText(t, item) : null].filter(Boolean).join(" · ");

  const readAll = () => {
    const [first] = unreadIds;
    if (unreadIds.length === 1 && first) markRead.mutate(first);
    else if (unreadIds.length > 1) markManyRead.mutate(unreadIds);
  };
  const toggleRead = () => {
    if (unread) readAll();
    else markUnread.mutate(group?.members[0]?.id ?? item.id);
  };
  const open = () => {
    readAll();
    if (!link) return;
    onNavigate();
    void navigate({ to: link.to as never, params: link.params as never, search: link.search as never });
  };
  const stopWatching = () => {
    if (!watchTarget) return;
    const name = group ? group.spaceName : itemTitle;
    const change = watchTarget.type === "space" ? { state: null } : { state: "notWatching" as const };
    const undo = watchTarget.type === "space" ? { state: "watching" as const } : { state: null };
    changeWatch.mutate(
      { target: watchTarget, change },
      {
        onSuccess: () =>
          toast({
            title: t("notifications.stoppedWatching", { name }),
            undo: { onUndo: () => changeWatch.mutate({ target: watchTarget, change: undo }) },
          }),
        onError: (error) => failed(t("notifications.watching.changeFailed"), error, stopWatching),
      },
    );
  };

  const lead = group ? (
    <span className="flex -space-x-3" aria-hidden="true">
      {group.actors.slice(0, 2).map((actor) => (
        <span key={actor.id} className="rounded-full ring-2 ring-bg">
          <PersonAvatar id={actor.id} name={actor.name} size="sm" decorative />
        </span>
      ))}
    </span>
  ) : item.actor?.id && item.actor.name ? (
    <PersonAvatar id={item.actor.id} name={item.actor.name} size="sm" decorative />
  ) : (
    <span className="inline-flex size-control-sm items-center justify-center rounded-md bg-control text-text-muted">
      <TypeIcon aria-hidden="true" className="size-icon-md" />
    </span>
  );

  const actions: { label: string; icon: LucideIcon; onSelect: () => void }[] = [
    ...(commentId
      ? [{ label: t("notifications.actions.reply"), icon: Reply, onSelect: () => setReplying(true) }]
      : []),
    ...(link ? [{ label: t("notifications.actions.open"), icon: ArrowUpRight, onSelect: open }] : []),
    {
      label: unread ? t("notifications.markRead") : t("notifications.actions.markUnread"),
      icon: unread ? Check : CircleDot,
      onSelect: toggleRead,
    },
    ...(watchTarget && stillWatched
      ? [
          {
            label:
              watchTarget.type === "space"
                ? t("notifications.actions.stopWatchingSpace")
                : t("notifications.actions.stopWatchingPage"),
            icon: BellOff,
            onSelect: stopWatching,
          },
        ]
      : []),
  ];

  return (
    <li
      data-unread={unread || undefined}
      className={classNames(
        "group/row grid grid-cols-[0.5rem_auto_minmax(0,1fr)_auto] items-start gap-x-3 rounded-md px-2 focus-within:bg-hover hover:bg-hover",
        compact ? "py-2" : "py-3",
      )}
    >
      <span
        aria-hidden="true"
        className={classNames("mt-3 size-2 rounded-full", unread ? "bg-accent" : "bg-transparent")}
      />
      <span className="mt-0.5">{lead}</span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <button
          type="button"
          data-notification=""
          onClick={open}
          className="min-w-0 rounded-sm text-start focus-visible:focus-ring"
        >
          <span
            className={classNames(
              "block wrap-anywhere",
              compact && "line-clamp-2",
              unread ? "font-semibold text-text" : "text-text-muted",
            )}
          >
            {title}
          </span>
          {meta ? <span className="block text-sm text-text-muted">{meta}</span> : null}
          {unread ? <span className="sr-only">{t("notifications.unreadLabel")}</span> : null}
        </button>
        {item.preview ? (
          <div data-notification-preview="" className="border-l-2 border-border pl-3 text-sm text-text">
            <TruncatedText text={item.preview} />
          </div>
        ) : null}
        {item.type === "access.requested" && item.target.id ? (
          <PendingRequest requestId={item.target.id} />
        ) : null}
        {item.type === "task.assigned" && item.target.id && typeof raw.taskId === "string" ? (
          <TaskDone pageId={item.target.id} taskId={raw.taskId} task={String(raw.taskText ?? "")} />
        ) : null}
        {group ? (
          <div className="flex flex-col">
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((current) => !current)}
              className="self-start rounded-sm text-sm font-medium text-accent hover:underline focus-visible:focus-ring"
            >
              {expanded
                ? t("notifications.group.showLess")
                : t("notifications.group.showAll", { count: group.members.length })}
            </button>
            {expanded ? <GroupMembers group={group} format={format} onNavigate={onNavigate} /> : null}
          </div>
        ) : null}
        {replying && commentId ? <ReplyForm commentId={commentId} onDone={() => setReplying(false)} /> : null}
      </div>
      <div className="relative flex min-h-control-sm items-start justify-end">
        <time
          dateTime={item.updatedAt}
          title={format.dateTime(item.updatedAt)}
          className="whitespace-nowrap pt-1 text-xs text-text-muted pointer-fine:group-focus-within/row:invisible pointer-fine:group-hover/row:invisible"
        >
          {format.short(item.updatedAt)}
        </time>
        <span
          data-notification-actions=""
          className="absolute top-0 right-0 hidden items-center gap-0.5 rounded-md bg-hover pointer-fine:group-focus-within/row:flex pointer-fine:group-hover/row:flex"
        >
          {actions.map((action) => (
            <IconButton
              key={action.label}
              label={action.label}
              icon={action.icon}
              size="sm"
              onClick={action.onSelect}
            />
          ))}
        </span>
        <span className="pointer-fine:hidden">
          <Menu
            trigger={<IconButton label={t("notifications.actions.more")} icon={Ellipsis} size="sm" />}
            items={actions}
          />
        </span>
      </div>
    </li>
  );
}
