import { commentKit, type DocumentJson, type TextAnchor } from "@pagehall/editor-schema";
import { Avatar, Badge, Button, IconButton, Menu, Skeleton, useToast } from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Reply,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { LoadError } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { CommentComposer } from "./comment-composer.js";
import { type CommentEntry, type CommentThread, collaborationKeys, commentsQuery } from "./queries.js";
import { ReactionBar, useReactionToggle } from "./reaction-bar.js";

export interface ElementAnchor {
  elementId: string;
  label: string;
}

export type CommentAnchor = TextAnchor | ElementAnchor;

export function isElementAnchor(anchor: CommentAnchor): anchor is ElementAnchor {
  return "elementId" in anchor;
}

export type DescribeElement = (elementId: string, quote: string) => string;

function isAnchored(thread: CommentThread): boolean {
  return thread.anchor === "inline" || thread.anchor === "element";
}

export interface CommentPermissions {
  viewerId: string | null;
  canComment: boolean;
  canModerate: boolean;
  canReact: boolean;
}

function CommentBody({ body, people }: { body: DocumentJson; people: Record<string, string> }) {
  const { t } = useTranslation();
  const html = useMemo(() => {
    try {
      return commentKit.renderHtml(body, {
        mention: (id) => (people[id] ? { name: people[id] } : null),
        labels: { unknownPerson: t("editor.mention.unknown") },
      });
    } catch {
      return null;
    }
  }, [body, people, t]);
  if (html === null) return <p className="text-sm text-text-muted">{t("comments.unreadable")}</p>;
  return (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: the shared renderer escapes all content of the validated comment
    <div className="ph-content ph-comment-body text-sm" dangerouslySetInnerHTML={{ __html: html }} />
  );
}

function useCommentActions(itemId: string) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: collaborationKeys.comments(itemId) });
  const fail = (title: string) => (error: unknown) => {
    toast({ variant: "error", title, description: problemMessage(t, error) });
    return false;
  };
  return {
    reply: (commentId: string, body: DocumentJson) =>
      request(() =>
        api.POST("/api/v1/comments/{commentId}/replies", {
          params: { path: { commentId } },
          body: { body: body as never },
        }),
      )
        .then(async () => {
          await refresh();
          return true;
        })
        .catch(fail(t("comments.replyFailed"))),
    update: (commentId: string, body: DocumentJson) =>
      request(() =>
        api.PUT("/api/v1/comments/{commentId}", {
          params: { path: { commentId } },
          body: { body: body as never },
        }),
      )
        .then(async () => {
          await refresh();
          return true;
        })
        .catch(fail(t("comments.editFailed"))),
    remove: async (commentId: string) => {
      try {
        await request(() => api.DELETE("/api/v1/comments/{commentId}", { params: { path: { commentId } } }));
        await refresh();
        toast({
          title: t("comments.deleted"),
          undo: {
            seconds: 10,
            onUndo: () =>
              void request(() =>
                api.POST("/api/v1/comments/{commentId}/restore", { params: { path: { commentId } } }),
              )
                .then(refresh)
                .catch(fail(t("comments.restoreFailed"))),
          },
        });
      } catch (error) {
        fail(t("comments.deleteFailed"))(error);
      }
    },
    resolve: (commentId: string, resolved: boolean) =>
      request(() =>
        api.PUT("/api/v1/comments/{commentId}/resolved", {
          params: { path: { commentId } },
          body: { resolved },
        }),
      )
        .then(refresh)
        .catch(fail(resolved ? t("comments.resolveFailed") : t("comments.reopenFailed"))),
  };
}

function CommentView({
  comment,
  itemId,
  pageId,
  people,
  permissions,
}: {
  comment: CommentEntry;
  itemId: string;
  pageId: string;
  people: Record<string, string>;
  permissions: CommentPermissions;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const actions = useCommentActions(itemId);
  const [editing, setEditing] = useState(false);
  const react = useReactionToggle({ itemId, commentId: comment.id });
  if (comment.deleted || !comment.body) {
    return <p className="text-sm text-text-muted italic">{t("comments.deletedPlaceholder")}</p>;
  }
  const own = comment.author?.id !== undefined && comment.author.id === permissions.viewerId;
  const menu = [
    ...(own && permissions.canComment
      ? [{ label: t("comments.edit"), icon: Pencil, onSelect: () => setEditing(true) }]
      : []),
    ...((own && permissions.canComment) || permissions.canModerate
      ? [
          {
            label: t("comments.delete"),
            icon: Trash2,
            danger: true,
            onSelect: () => void actions.remove(comment.id),
          },
        ]
      : []),
  ];
  const name = comment.author?.name ?? t("editor.mention.unknown");
  return (
    <div className="flex gap-2">
      <Avatar name={name} size="sm" decorative />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate text-sm font-semibold" title={name}>
            {name}
          </span>
          <time
            className="shrink-0 text-xs text-text-muted"
            dateTime={comment.createdAt}
            title={format.dateTime(comment.createdAt)}
          >
            {format.relative(comment.createdAt)}
          </time>
          {comment.editedAt ? <span className="text-xs text-text-muted">{t("comments.edited")}</span> : null}
          <span className="flex-1" />
          {menu.length > 0 ? (
            <Menu
              trigger={<IconButton label={t("comments.actions", { name })} icon={MoreHorizontal} size="sm" />}
              items={menu}
            />
          ) : null}
        </div>
        {editing ? (
          <CommentComposer
            pageId={pageId}
            label={t("comments.editLabel")}
            placeholder={t("comments.placeholder")}
            submitLabel={t("comments.save")}
            initial={comment.body as DocumentJson}
            autoFocus
            onCancel={() => setEditing(false)}
            onSubmit={async (body) => {
              const saved = await actions.update(comment.id, body);
              if (saved) setEditing(false);
              return saved;
            }}
          />
        ) : (
          <CommentBody body={comment.body as DocumentJson} people={people} />
        )}
        <ReactionBar
          reactions={comment.reactions}
          canReact={permissions.canReact}
          label={t("reactions.commentLabel", { name })}
          onToggle={(emoji, add) => react.mutate({ emoji, add })}
        />
      </div>
    </div>
  );
}

function ThreadView({
  thread,
  itemId,
  people,
  permissions,
  active,
  onActivate,
  describeElement,
}: {
  thread: CommentThread;
  itemId: string;
  people: Record<string, string>;
  permissions: CommentPermissions;
  active: boolean;
  onActivate: (threadId: string) => void;
  describeElement: DescribeElement | undefined;
}) {
  const { t } = useTranslation();
  const actions = useCommentActions(itemId);
  const [replying, setReplying] = useState(false);
  const element = useRef<HTMLElement>(null);
  useEffect(() => {
    if (active) element.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const inline = thread.anchor === "inline";
  const elementId = thread.elementId ?? null;
  const onElement = typeof elementId === "string";
  const quote = onElement
    ? (describeElement?.(elementId, thread.quote ?? "") ?? (thread.quote || t("comments.element")))
    : thread.quote;
  return (
    <article
      ref={element}
      aria-label={quote ? t("comments.threadOn", { quote }) : t("comments.pageThread")}
      className={`flex flex-col gap-3 rounded-md border p-3 ${active ? "border-accent" : "border-border"}`}
    >
      {onElement ? (
        thread.anchor === "element" ? (
          <button
            type="button"
            onClick={() => onActivate(thread.id)}
            className="border-l-4 border-warning pl-2 text-start text-sm text-text-muted hover:text-text focus-visible:focus-ring"
            title={t("comments.showOnBoard")}
          >
            {quote}
          </button>
        ) : (
          <div className="flex flex-col gap-1">
            <blockquote className="border-l-4 border-border pl-2 text-sm text-text-muted line-through">
              {quote}
            </blockquote>
            <p className="text-xs text-text-muted">{t("comments.elementGone")}</p>
          </div>
        )
      ) : thread.quote ? (
        inline ? (
          <button
            type="button"
            onClick={() => onActivate(thread.id)}
            className="border-l-4 border-warning pl-2 text-start text-sm text-text-muted hover:text-text focus-visible:focus-ring"
            title={t("comments.showInText")}
          >
            “{thread.quote}”
          </button>
        ) : (
          <div className="flex flex-col gap-1">
            <blockquote className="border-l-4 border-border pl-2 text-sm text-text-muted line-through">
              “{thread.quote}”
            </blockquote>
            <p className="text-xs text-text-muted">{t("comments.textGone")}</p>
          </div>
        )
      ) : null}
      <CommentView
        comment={thread}
        itemId={itemId}
        pageId={itemId}
        people={people}
        permissions={permissions}
      />
      {thread.replies.length > 0 ? (
        <ol className="flex flex-col gap-3 border-l border-border pl-3">
          {thread.replies.map((reply) => (
            <li key={reply.id}>
              <CommentView
                comment={reply}
                itemId={itemId}
                pageId={itemId}
                people={people}
                permissions={permissions}
              />
            </li>
          ))}
        </ol>
      ) : null}
      {permissions.canComment ? (
        <div className="flex flex-wrap items-center gap-2">
          {replying ? (
            <div className="w-full">
              <CommentComposer
                pageId={itemId}
                label={t("comments.replyLabel")}
                placeholder={t("comments.placeholder")}
                submitLabel={t("comments.reply")}
                autoFocus
                onCancel={() => setReplying(false)}
                onSubmit={async (body) => {
                  const sent = await actions.reply(thread.id, body);
                  if (sent) setReplying(false);
                  return sent;
                }}
              />
            </div>
          ) : (
            <Button size="sm" variant="secondary" icon={Reply} onClick={() => setReplying(true)}>
              {t("comments.reply")}
            </Button>
          )}
          {isAnchored(thread) ? (
            thread.resolvedAt ? (
              <Button
                size="sm"
                variant="secondary"
                icon={RotateCcw}
                onClick={() => void actions.resolve(thread.id, false)}
              >
                {t("comments.reopen")}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                icon={Check}
                onClick={() => void actions.resolve(thread.id, true)}
              >
                {t("comments.resolve")}
              </Button>
            )
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function openThreadIds(threads: readonly CommentThread[] | undefined): string[] {
  return (threads ?? [])
    .filter((thread) => isAnchored(thread) && thread.resolvedAt === null)
    .map((thread) => thread.id);
}

export function CommentsPanel({
  itemId,
  permissions,
  pending,
  onPendingDone,
  activeThread,
  onActivate,
  onClose,
  describeElement,
  hint,
}: {
  itemId: string;
  permissions: CommentPermissions;
  pending: CommentAnchor | null;
  onPendingDone: () => void;
  activeThread: string | null;
  onActivate: (threadId: string) => void;
  onClose: () => void;
  describeElement?: DescribeElement;
  hint?: string;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const comments = useQuery(commentsQuery(itemId));
  const [showResolved, setShowResolved] = useState(false);
  const threads = comments.data?.threads ?? [];
  const people = comments.data?.people ?? {};
  const open = threads.filter((thread) => isAnchored(thread) && thread.resolvedAt === null);
  const page = threads.filter((thread) => !isAnchored(thread));
  const resolved = threads.filter((thread) => isAnchored(thread) && thread.resolvedAt !== null);

  const create = async (body: DocumentJson, anchor?: CommentAnchor) => {
    try {
      const created = await request(() =>
        api.POST("/api/v1/pages/{pageId}/comments", {
          params: { path: { pageId: itemId } },
          body: (anchor
            ? isElementAnchor(anchor)
              ? { body, elementId: anchor.elementId }
              : { body, anchor }
            : { body }) as never,
        }),
      );
      await queryClient.invalidateQueries({ queryKey: collaborationKeys.comments(itemId) });
      if (anchor) {
        onPendingDone();
        onActivate(created.id);
      }
      return true;
    } catch (error) {
      toast({ variant: "error", title: t("comments.createFailed"), description: problemMessage(t, error) });
      return false;
    }
  };

  const renderThread = (thread: (typeof threads)[number]) => (
    <li key={thread.id}>
      <ThreadView
        thread={thread}
        itemId={itemId}
        people={people}
        permissions={permissions}
        active={thread.id === activeThread}
        onActivate={onActivate}
        describeElement={describeElement}
      />
    </li>
  );

  return (
    <aside
      aria-label={t("comments.title")}
      className="flex h-full w-full flex-col border-l border-border bg-surface md:w-panel md:shrink-0"
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-2">
        <MessageSquare aria-hidden="true" className="size-icon-md text-text-muted" />
        <h2 className="font-semibold">{t("comments.title")}</h2>
        {open.length > 0 ? (
          <Badge variant="neutral">{t("comments.openCount", { count: open.length })}</Badge>
        ) : null}
        <span className="flex-1" />
        <IconButton label={t("comments.close")} icon={X} size="sm" onClick={onClose} />
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {pending ? (
          <section
            className="flex flex-col gap-2 rounded-md border border-accent p-3"
            aria-label={isElementAnchor(pending) ? t("comments.newOnElement") : t("comments.newInline")}
          >
            <blockquote className="border-l-4 border-warning pl-2 text-sm text-text-muted">
              {isElementAnchor(pending) ? pending.label : `“${pending.exact}”`}
            </blockquote>
            <CommentComposer
              pageId={itemId}
              label={isElementAnchor(pending) ? t("comments.newOnElement") : t("comments.newInline")}
              placeholder={t("comments.placeholder")}
              submitLabel={t("comments.comment")}
              autoFocus
              onCancel={onPendingDone}
              onSubmit={(body) => create(body, pending)}
            />
          </section>
        ) : null}
        {comments.isPending ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-field w-full" />
            <Skeleton className="h-field w-full" />
          </div>
        ) : null}
        {comments.isError ? (
          <LoadError
            what={t("comments.loadFailed")}
            error={comments.error}
            onRetry={() => comments.refetch()}
          />
        ) : null}
        {comments.data && threads.length === 0 && !pending ? (
          <p className="text-sm text-text-muted">
            {permissions.canComment ? t("comments.emptyCanComment") : t("comments.empty")}
          </p>
        ) : null}
        {hint && permissions.canComment ? <p className="text-xs text-text-muted">{hint}</p> : null}
        {open.length > 0 ? (
          <section aria-label={t("comments.openSection")} className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold tracking-label text-text-muted uppercase">
              {t("comments.openSection")}
            </h3>
            <ul className="flex flex-col gap-3">{open.map(renderThread)}</ul>
          </section>
        ) : null}
        {page.length > 0 ? (
          <section aria-label={t("comments.pageSection")} className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold tracking-label text-text-muted uppercase">
              {t("comments.pageSection")}
            </h3>
            <ul className="flex flex-col gap-3">{page.map(renderThread)}</ul>
          </section>
        ) : null}
        {resolved.length > 0 ? (
          <section className="flex flex-col gap-2">
            <Button
              variant="outline"
              size="sm"
              icon={showResolved ? ChevronDown : ChevronRight}
              aria-expanded={showResolved}
              onClick={() => setShowResolved(!showResolved)}
            >
              {t("comments.resolvedSection", { count: resolved.length })}
            </Button>
            {showResolved ? <ul className="flex flex-col gap-3">{resolved.map(renderThread)}</ul> : null}
          </section>
        ) : null}
      </div>
      {permissions.canComment ? (
        <div className="border-t border-border p-4">
          <CommentComposer
            pageId={itemId}
            label={describeElement ? t("comments.newBoardComment") : t("comments.newPageComment")}
            placeholder={t("comments.placeholder")}
            submitLabel={t("comments.comment")}
            onSubmit={(body) => create(body)}
          />
        </div>
      ) : null}
    </aside>
  );
}
