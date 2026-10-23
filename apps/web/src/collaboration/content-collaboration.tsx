import type { TextAnchor } from "@lunedo/editor-schema";
import { IconButton, type MenuItem, useToast } from "@lunedo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Star, StarOff } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import type { ReadViewCollaboration } from "../editor/read-view.js";
import { problemMessage } from "../errors/problem-message.js";
import { useSession } from "../shell/shell-context.js";
import { type CommentAnchor, CommentsPanel, type DescribeElement, openThreadIds } from "./comments-panel.js";
import { useOverlayFocusTrap } from "./focus-trap.js";
import { InlineThreadPopover, type InlineThreadTarget, selectionRange } from "./inline-threads.js";
import { PageComments } from "./page-comments.js";
import { collaborationKeys, commentsQuery, recordView, starredQuery, taskStatusesQuery } from "./queries.js";
import { useSetTaskStatus } from "./task-actions.js";

export type StarTarget = { itemId: string } | { spaceId: string };

export function useStar(target: StarTarget, title: string) {
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
  const menuItem: MenuItem = {
    label: active ? t("starred.removeEntry") : t("starred.addEntry"),
    icon: active ? StarOff : Star,
    onSelect: () => toggle.mutate(!active),
  };
  return { active, toggle: () => toggle.mutate(!active), menuItem };
}

export function StarButton({
  target,
  title,
  size = "md",
}: {
  target: StarTarget;
  title: string;
  size?: "sm" | "md";
}) {
  const { t } = useTranslation();
  const star = useStar(target, title);
  return (
    <IconButton
      label={star.active ? t("starred.unstar", { title }) : t("starred.star", { title })}
      icon={Star}
      size={size}
      aria-pressed={star.active}
      className={star.active ? "text-warning [&_svg]:fill-current" : undefined}
      onClick={star.toggle}
    />
  );
}

export function StarredMark({ target }: { target: StarTarget }) {
  const { t } = useTranslation();
  const starred = useQuery({ ...starredQuery(), throwOnError: false });
  const active =
    "itemId" in target
      ? (starred.data?.items.some((item) => item.id === target.itemId) ?? false)
      : (starred.data?.spaces.some((space) => space.id === target.spaceId) ?? false);
  if (!active) return null;
  return (
    <span className="inline-flex shrink-0 items-center text-warning" title={t("starred.mark")}>
      <Star aria-hidden="true" className="size-icon-md fill-current" />
      <span className="sr-only">{t("starred.mark")}</span>
    </span>
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
  section: ReactNode;
  popover: ReactNode;
  activeThread: string | null;
  commentOn: (anchor: CommentAnchor | null) => void;
}

export function useContentCollaboration({
  itemId,
  spaceId,
  role,
  archived,
  writable,
  describeElement,
  hint,
  layout = "panel",
  highlight = null,
}: {
  itemId: string;
  spaceId: string;
  role: "reader" | "commenter" | "editor" | "admin" | null;
  archived: boolean;
  writable: boolean;
  describeElement?: DescribeElement;
  hint?: string;
  layout?: "panel" | "inline";
  highlight?: string | null;
}): ContentCollaboration {
  const { t } = useTranslation();
  const session = useSession();
  const viewerId = session.account?.id ?? null;
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<CommentAnchor | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [target, setTarget] = useState<InlineThreadTarget | null>(null);
  const [marked, setMarked] = useState<readonly string[] | null>(null);
  const inline = layout === "inline";
  const toggleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setPending(null);
  }, []);
  const toggleButton = useCallback(() => document.getElementById(toggleId), [toggleId]);
  useOverlayFocusTrap({
    active: open,
    container: panelRef,
    returnTo: toggleButton,
    onEscape: close,
    media: "(min-width: 48rem)",
  });
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

  const activate = useCallback(
    (threadId: string) => {
      setActive(threadId);
      if (inline) setTarget({ threadId, pending: null, range: null });
      else setOpen(true);
    },
    [inline],
  );
  const comment = useCallback(
    (anchor: CommentAnchor | null) => {
      if (inline && anchor) {
        setActive(null);
        setTarget({ threadId: null, pending: anchor, range: selectionRange() });
        return;
      }
      setPending(anchor);
      setOpen(true);
    },
    [inline],
  );
  const permissions = {
    viewerId,
    canComment,
    canModerate: role === "admin" && !archived,
    canReact: !archived && role !== null,
  };
  const highlighted = highlight ?? null;
  const highlightedThread = comments.data?.threads.find((thread) => thread.id === highlighted);
  const highlightOpen = highlightedThread !== undefined && openThreads.includes(highlightedThread.id);
  useEffect(() => {
    if (inline && highlightOpen && highlighted && marked?.includes(highlighted)) activate(highlighted);
  }, [inline, highlightOpen, highlighted, activate, marked]);
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
      ...(inline ? { onMarkedThreads: setMarked } : {}),
      ...(canComment ? { onCommentSelection: comment } : {}),
    },
    activeThread: active,
    commentOn: comment,
    editor: {
      ...(canComment ? { onComment: comment } : {}),
      openThreads,
      activeThread: active,
      onThreadClick: activate,
    },
    section: inline ? (
      <PageComments
        itemId={itemId}
        permissions={permissions}
        highlight={highlightOpen && marked?.includes(highlighted ?? "") ? null : highlighted}
        unmarked={marked === null ? [] : openThreads.filter((id) => !marked.includes(id))}
      />
    ) : null,
    popover: inline ? (
      <InlineThreadPopover
        itemId={itemId}
        target={target}
        permissions={permissions}
        onTarget={(next) => {
          setTarget(next);
          setActive(next.threadId);
        }}
        onClose={() => {
          setTarget(null);
          setActive(null);
        }}
      />
    ) : null,
    commentsButton: inline ? null : (
      <IconButton
        label={
          openThreads.length > 0
            ? t("comments.toggleWithOpen", { count: openThreads.length })
            : t("comments.toggle")
        }
        id={toggleId}
        icon={MessageSquare}
        aria-pressed={open}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      />
    ),
    panel:
      open && !inline ? (
        <div
          ref={panelRef}
          className="fixed inset-0 z-40 flex bg-surface md:sticky md:top-0 md:inset-auto md:z-auto md:h-dvh md:self-start"
        >
          <CommentsPanel
            itemId={itemId}
            permissions={permissions}
            pending={pending}
            onPendingDone={() => setPending(null)}
            activeThread={active}
            onActivate={setActive}
            onClose={close}
            {...(describeElement ? { describeElement } : {})}
            {...(hint ? { hint } : {})}
          />
        </div>
      ) : null,
  };
}
