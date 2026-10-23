import { slugify } from "@lunedo/editor-schema";
import { Button, EmptyState, List, ListRow, Section, Skeleton, useToast } from "@lunedo/ui";
import { Link } from "@tanstack/react-router";
import { Bell, BellOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LoadError, useFailureToast } from "../../errors/failure.js";
import { translateKey } from "../../i18n/translate.js";
import { seriesPath, topicPath } from "../../meetings/queries.js";
import {
  useChangeWatch,
  useWatchedList,
  type WatchedEntry,
  type WatchTarget,
} from "../../notifications/watching-api.js";
import { blogPostPath, folderPath, pagePath, whiteboardPath } from "../../spaces/space-queries.js";
import { SettingsPage } from "../settings/settings-page.js";

export function watchedPath(entry: WatchedEntry): string | null {
  const slug = slugify(entry.title);
  const id = entry.target.id;
  switch (entry.kind) {
    case "space":
      return `/spaces/${encodeURIComponent(entry.spaceKey)}`;
    case "page":
      return pagePath(entry.spaceKey, id, slug);
    case "blogPost":
      return blogPostPath(entry.spaceKey, id, slug);
    case "folder":
      return folderPath(entry.spaceKey, id, slug);
    case "meetingSeries":
      return seriesPath(entry.spaceKey, id);
    case "meetingTopic":
      return topicPath(entry.spaceKey, id);
    case "whiteboard":
      return whiteboardPath(entry.spaceKey, id, slug);
    default:
      return null;
  }
}

export function WatchedItemsScreen() {
  const { t } = useTranslation();
  const list = useWatchedList();
  const change = useChangeWatch();
  const { toast } = useToast();
  const failed = useFailureToast();
  const items = list.data?.items ?? [];

  const release = (entry: WatchedEntry) => {
    const target = entry.target as WatchTarget;
    const previous = { state: entry.state, keepActionable: entry.keepActionable };
    change.mutate(
      { target, change: { state: null } },
      {
        onSuccess: () =>
          toast({
            title: t(
              entry.state === "muted" ? "notifications.watching.unmuted" : "notifications.watching.removed",
              {
                name: entry.title,
              },
            ),
            undo: { onUndo: () => change.mutate({ target, change: previous }) },
          }),
        onError: (error) => failed(t("notifications.watching.changeFailed"), error, () => release(entry)),
      },
    );
  };

  return (
    <SettingsPage
      title={t("notifications.watching.screenTitle")}
      description={t("notifications.watching.screenDescription")}
    >
      {list.isPending ? <Skeleton className="h-12 w-full" /> : null}
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
      ) : null}
      {(["watching", "muted"] as const).map((state) => {
        const entries = items.filter((entry) => entry.state === state);
        if (entries.length === 0) return null;
        const title = t(`notifications.watching.states.${state}`);
        return (
          <Section
            key={state}
            title={
              <>
                {title} <span className="font-normal text-text-muted">{entries.length}</span>
              </>
            }
          >
            <List label={title}>
              {entries.map((entry) => (
                <WatchedRow
                  key={`${entry.target.type}:${entry.target.id}`}
                  entry={entry}
                  onRelease={release}
                />
              ))}
            </List>
          </Section>
        );
      })}
    </SettingsPage>
  );
}

function WatchedRow({ entry, onRelease }: { entry: WatchedEntry; onRelease: (entry: WatchedEntry) => void }) {
  const { t } = useTranslation();
  const path = watchedPath(entry);
  const kind = translateKey(t, `notifications.watching.kinds.${entry.kind}`);
  return (
    <ListRow
      icon={entry.state === "muted" ? BellOff : Bell}
      title={
        path ? (
          <Link to={path as never} className="wrap-anywhere hover:underline focus-visible:focus-ring">
            {entry.title}
          </Link>
        ) : (
          <span className="wrap-anywhere">{entry.title}</span>
        )
      }
      description={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{kind}</span>
          {entry.target.type === "item" ? (
            <span>{t("notifications.watching.inSpace", { space: entry.spaceName })}</span>
          ) : null}
          {entry.state === "muted" && entry.keepActionable ? (
            <span>{t("notifications.watching.keepsMentions")}</span>
          ) : null}
          {entry.automatic ? <span>{t("notifications.watching.automatic")}</span> : null}
        </span>
      }
      actions={
        <Button variant="secondary" size="sm" onClick={() => onRelease(entry)}>
          {entry.state === "muted"
            ? t("notifications.watching.unmuteAction")
            : t("notifications.watching.unwatch")}
        </Button>
      }
    />
  );
}
