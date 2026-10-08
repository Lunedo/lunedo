import type { TextAnchor } from "@pagehall/editor-schema";
import { IconButton, useToast } from "@pagehall/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Star } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import type { ReadViewCollaboration } from "../editor/read-view.js";
import { problemMessage } from "../errors/problem-message.js";
import { useSession } from "../shell/shell-context.js";
import { CommentsPanel, openThreadIds } from "./comments-panel.js";
import { collaborationKeys, commentsQuery, recordView, starredQuery, taskStatusesQuery } from "./queries.js";
import { useSetTaskStatus } from "./task-actions.js";

export function StarButton({
  target,
  title,
}: {
  target: { itemId: string } | { spaceId: string };
  title: string;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const starred = useQuery(starredQuery());
  const active =
    "itemId" in target
      ? (starred.data?.items.some((item) => item.id === target.itemId) ?? false)
      : (starred.data?.spaces.some((space) => space.id === target.spaceId) ?? false);
  const toggle = useMutation({
    mutationFn: (star: boolean) => {
      if ("itemId" in target) {
        const params = { params: { path: { itemId: target.itemId } } };
        return request(() =>
          star
            ? api.PUT("/api/v1/starred/items/{itemId}", params)
            : api.DELETE("/api/v1/starred/items/{itemId}", params),
        );
      }
      const params = { params: { path: { spaceId: target.spaceId } } };
      return request(() =>
        star
          ? api.PUT("/api/v1/starred/spaces/{spaceId}", params)
          : api.DELETE("/api/v1/starred/spaces/{spaceId}", params),
      );
    },
    onSuccess: (_result, star) =>
      toast({ title: star ? t("starred.added", { title }) : t("starred.removed", { title }) }),
    onError: (error, star) =>
      toast({
        variant: "error",
        title: star ? t("starred.addFailed") : t("starred.removeFailed"),
        description: problemMessage(t, error),
      }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: collaborationKeys.starred });
      void queryClient.invalidateQueries({ queryKey: collaborationKeys.home });
    },
  });
  return (
    <IconButton
      label={active ? t("starred.unstar", { title }) : t("starred.star", { title })}
      icon={Star}
      aria-pressed={active}
      className={active ? "text-warning [&_svg]:fill-current" : undefined}
      onClick={() => toggle.mutate(!active)}
    />
  );
}

export interface ContentCollaboration {
  readView: ReadViewCollaboration;
  editor: {
    onComment?: (anchor: TextAnchor) => void;
    openThreads: readonly string[];
    activeThread: string | null;
    onThreadClick: (threadId: string) => void;
  };
  commentsButton: ReactNode;
  panel: ReactNode;
}

export function useContentCollaboration({
  itemId,
  spaceId,
  role,
  archived,
  writable,
}: {
  itemId: string;
  spaceId: string;
  role: "reader" | "commenter" | "editor" | "admin" | null;
  archived: boolean;
  writable: boolean;
}): ContentCollaboration {
  const { t } = useTranslation();
  const session = useSession();
  const viewerId = session.account?.id ?? null;
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<TextAnchor | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const comments = useQuery(commentsQuery(itemId));
  const statuses = useQuery(taskStatusesQuery(itemId));
  const setStatus = useSetTaskStatus(itemId);
  const canComment = !archived && (role === "commenter" || role === "editor" || role === "admin");
  const openThreads = useMemo(() => openThreadIds(comments.data?.threads), [comments.data]);
  const taskStatuses = useMemo(
    () => new Map((statuses.data ?? []).map((status) => [status.id, status.done])),
    [statuses.data],
  );

  useEffect(() => {
    recordView(itemId);
  }, [itemId]);

  const activate = useCallback((threadId: string) => {
    setActive(threadId);
    setOpen(true);
  }, []);
  const comment = useCallback((anchor: TextAnchor) => {
    setPending(anchor);
    setOpen(true);
  }, []);
  const canToggleTask = useCallback(
    ({ assignee }: { id: string; assignee: string | null }) =>
      !archived && (writable || (assignee !== null && assignee === viewerId)),
    [archived, writable, viewerId],
  );
  const toggleTask = useCallback(
    (taskId: string, done: boolean) => setStatus.mutate({ taskId, done }),
    [setStatus],
  );

  return {
    readView: {
      taskStatuses,
      canToggleTask,
      onToggleTask: toggleTask,
      openThreads,
      activeThread: active,
      onThreadClick: activate,
      spaceId,
      ...(canComment ? { onCommentSelection: comment } : {}),
    },
    editor: {
      ...(canComment ? { onComment: comment } : {}),
      openThreads,
      activeThread: active,
      onThreadClick: activate,
    },
    commentsButton: (
      <IconButton
        label={
          openThreads.length > 0
            ? t("comments.toggleWithOpen", { count: openThreads.length })
            : t("comments.toggle")
        }
        icon={MessageSquare}
        aria-pressed={open}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      />
    ),
    panel: open ? (
      <div className="fixed inset-0 z-40 flex bg-surface md:sticky md:top-0 md:inset-auto md:z-auto md:max-h-dvh md:self-start">
        <CommentsPanel
          itemId={itemId}
          permissions={{
            viewerId,
            canComment,
            canModerate: role === "admin" && !archived,
            canReact: !archived && role !== null,
          }}
          pending={pending}
          onPendingDone={() => setPending(null)}
          activeThread={active}
          onActivate={setActive}
          onClose={() => {
            setOpen(false);
            setPending(null);
          }}
        />
      </div>
    ) : null,
  };
}
