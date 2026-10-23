import type { DocumentJson } from "@lunedo/editor-schema";
import { Button, IconButton, Menu, Skeleton, useToast } from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, MessageSquare, MoreHorizontal, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { PersonAvatar } from "../components/person-avatar.js";
import { LoadError } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { useSession } from "../shell/shell-context.js";
import { CommentComposer } from "./comment-composer.js";
import {
  type CommentAnchor,
  CommentBody,
  type CommentPermissions,
  isAnchored,
  isElementAnchor,
  useCommentActions,
} from "./comments-panel.js";
import { type CommentEntry, type CommentThread, collaborationKeys, commentsQuery } from "./queries.js";
import { ReactionBar, useReactionToggle } from "./reaction-bar.js";

export function visibleComments(thread: CommentThread): number {
  return [thread, ...thread.replies].filter((comment) => !comment.deleted && comment.body).length;
}

export function useCreateComment(itemId: string) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  return async (body: DocumentJson, anchor?: CommentAnchor): Promise<string | null> => {
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
      return created.id;
    } catch (error) {
      toast({ variant: "error", title: t("comments.createFailed"), description: problemMessage(t, error) });
      return null;
    }
  };
}

function SelfAvatar() {
  const session = useSession();
  const account = session.account;
  return (
    <PersonAvatar
      id={account?.id}
      name={account?.name ?? ""}
      pictureRef={account?.pictureRef}
      size="sm"
      decorative
    />
  );
}

function FlatComment({
  comment,
  itemId,
  people,
  permissions,
  onReply,
  compact = false,
}: {
  comment: CommentEntry;
  itemId: string;
  people: Record<string, string>;
  permissions: CommentPermissions;
  onReply?: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const actions = useCommentActions(itemId);
  const react = useReactionToggle({ itemId, commentId: comment.id });
  const [editing, setEditing] = useState(false);
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
    <div className="flex gap-3">
      <PersonAvatar
        id={comment.author?.id}
        name={name}
        pictureRef={comment.author?.pictureRef}
        size="sm"
        decorative
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-h-control-sm items-center gap-2">
          <span className="min-w-0 truncate text-sm font-semibold" title={name}>
            {name}
          </span>
          <time
            className="shrink-0 text-xs text-text-muted"
            dateTime={comment.createdAt}
            title={format.dateTime(comment.createdAt)}
          >
            {format.short(comment.createdAt)}
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
            pageId={itemId}
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
        {compact && comment.reactions.length === 0 && !onReply ? null : (
          <div className="flex flex-wrap items-center gap-2">
            {onReply ? (
              <button
                type="button"
                onClick={onReply}
                className="inline-flex h-control-sm items-center rounded-sm text-sm text-text-muted hover:text-text focus-visible:focus-ring"
              >
                {t("comments.reply")}
              </button>
            ) : null}
            <ReactionBar
              reactions={comment.reactions}
              canReact={permissions.canReact}
              label={t("reactions.commentLabel", { name })}
              onToggle={(emoji, add) => react.mutate({ emoji, add })}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ReplyComposer({
  itemId,
  threadId,
  autoFocus,
  onDone,
}: {
  itemId: string;
  threadId: string;
  autoFocus?: boolean;
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const actions = useCommentActions(itemId);
  return (
    <div className="flex gap-3">
      <SelfAvatar />
      <div className="min-w-0 flex-1">
        <CommentComposer
          pageId={itemId}
          label={t("comments.replyLabel")}
          placeholder={t("comments.replyPlaceholder")}
          submitLabel={t("comments.reply")}
          compact
          {...(autoFocus ? { autoFocus } : {})}
          {...(onDone ? { onCancel: onDone } : {})}
          onSubmit={async (body) => {
            const sent = await actions.reply(threadId, body);
            if (sent) onDone?.();
            return sent;
          }}
        />
      </div>
    </div>
  );
}

function ThreadQuote({ thread }: { thread: CommentThread }) {
  const { t } = useTranslation();
  if (!thread.quote) return null;
  return (
    <blockquote className="border-l-4 border-warning ps-2 text-sm text-text-muted">
      {t("comments.quoted", { quote: thread.quote })}
    </blockquote>
  );
}

function PageThread({
  thread,
  itemId,
  people,
  permissions,
  highlighted,
  footer,
}: {
  thread: CommentThread;
  itemId: string;
  people: Record<string, string>;
  permissions: CommentPermissions;
  highlighted: boolean;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const [replying, setReplying] = useState(false);
  const element = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!highlighted) return;
    element.current?.scrollIntoView?.({ block: "center" });
    element.current?.focus({ preventScroll: true });
  }, [highlighted]);
  const reply = permissions.canComment ? () => setReplying(true) : undefined;
  return (
    <article
      ref={element}
      id={`comment-${thread.id}`}
      tabIndex={-1}
      aria-label={thread.quote ? t("comments.threadOn", { quote: thread.quote }) : t("comments.pageThread")}
      data-highlighted={highlighted || undefined}
      className="flex flex-col gap-3 rounded-sm py-4 focus-visible:focus-ring data-highlighted:bg-accent-soft"
    >
      <ThreadQuote thread={thread} />
      <FlatComment
        comment={thread}
        itemId={itemId}
        people={people}
        permissions={permissions}
        {...(reply ? { onReply: reply } : {})}
      />
      {thread.replies.length > 0 ? (
        <ol className="flex flex-col gap-3 ps-9">
          {thread.replies.map((entry) => (
            <li key={entry.id}>
              <FlatComment
                comment={entry}
                itemId={itemId}
                people={people}
                permissions={permissions}
                {...(reply ? { onReply: reply } : {})}
              />
            </li>
          ))}
        </ol>
      ) : null}
      {replying ? (
        <div className="ps-9">
          <ReplyComposer itemId={itemId} threadId={thread.id} autoFocus onDone={() => setReplying(false)} />
        </div>
      ) : null}
      {footer}
    </article>
  );
}

export function PageComments({
  itemId,
  permissions,
  highlight,
}: {
  itemId: string;
  permissions: CommentPermissions;
  highlight: string | null;
}) {
  const { t } = useTranslation();
  const comments = useQuery(commentsQuery(itemId));
  const actions = useCommentActions(itemId);
  const create = useCreateComment(itemId);
  const threads = comments.data?.threads ?? [];
  const people = comments.data?.people ?? {};
  const page = threads.filter((thread) => !isAnchored(thread));
  const resolved = threads.filter((thread) => isAnchored(thread) && thread.resolvedAt !== null);
  const highlightResolved = resolved.some((thread) => thread.id === highlight);
  const [showResolved, setShowResolved] = useState(highlightResolved);
  if (highlightResolved && !showResolved) setShowResolved(true);
  const count = page.reduce((sum, thread) => sum + visibleComments(thread), 0);

  return (
    <section aria-labelledby="page-comments" className="mt-10 flex flex-col">
      <h2 id="page-comments" className="border-b border-border pb-2 text-lg font-semibold">
        {t("comments.title")}
        {count > 0 ? (
          <>
            {" "}
            <span className="ms-1 font-normal text-text-muted">{count}</span>
          </>
        ) : null}
      </h2>
      {comments.isPending ? (
        <div className="flex flex-col gap-3 py-4">
          <Skeleton className="h-field w-full" />
        </div>
      ) : null}
      {comments.isError ? (
        <div className="py-4">
          <LoadError
            what={t("comments.loadFailed")}
            error={comments.error}
            onRetry={() => comments.refetch()}
          />
        </div>
      ) : null}
      {comments.data && page.length === 0 ? (
        <p className="py-4 text-sm text-text-muted">
          {permissions.canComment ? t("comments.emptyCanComment") : t("comments.empty")}
        </p>
      ) : null}
      {page.length > 0 ? (
        <ol className="flex flex-col divide-y divide-border">
          {page.map((thread) => (
            <li key={thread.id}>
              <PageThread
                thread={thread}
                itemId={itemId}
                people={people}
                permissions={permissions}
                highlighted={thread.id === highlight}
              />
            </li>
          ))}
        </ol>
      ) : null}
      {resolved.length > 0 ? (
        <div className="border-t border-border py-3">
          <button
            type="button"
            aria-expanded={showResolved}
            onClick={() => setShowResolved(!showResolved)}
            className="inline-flex min-h-control-sm items-center rounded-sm text-sm text-accent hover:underline focus-visible:focus-ring"
          >
            {showResolved
              ? t("comments.hideResolved", { count: resolved.length })
              : t("comments.showResolved", { count: resolved.length })}
          </button>
          {showResolved ? (
            <ol className="flex flex-col divide-y divide-border">
              {resolved.map((thread) => (
                <li key={thread.id}>
                  <PageThread
                    thread={thread}
                    itemId={itemId}
                    people={people}
                    permissions={permissions}
                    highlighted={thread.id === highlight}
                    footer={
                      permissions.canComment ? (
                        <div className="ps-9">
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={RotateCcw}
                            onClick={() => void actions.resolve(thread.id, false)}
                          >
                            {t("comments.reopen")}
                          </Button>
                        </div>
                      ) : null
                    }
                  />
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
      {permissions.canComment ? (
        <div className="flex gap-3 border-t border-border pt-4">
          <SelfAvatar />
          <div className="min-w-0 flex-1">
            <CommentComposer
              pageId={itemId}
              label={t("comments.newPageComment")}
              placeholder={t("comments.pagePlaceholder")}
              compact
              submitLabel={t("comments.comment")}
              onSubmit={async (body) => (await create(body)) !== null}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function InlineThread({
  itemId,
  threadId,
  pending,
  permissions,
  onCreated,
  onCancel,
}: {
  itemId: string;
  threadId: string | null;
  pending: CommentAnchor | null;
  permissions: CommentPermissions;
  onCreated: (threadId: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const comments = useQuery(commentsQuery(itemId));
  const actions = useCommentActions(itemId);
  const create = useCreateComment(itemId);
  const thread = comments.data?.threads.find((entry) => entry.id === threadId) ?? null;
  const people = comments.data?.people ?? {};

  if (!thread) {
    if (!pending) {
      return comments.isPending ? (
        <Skeleton className="h-field w-full" />
      ) : (
        <p className="text-sm text-text-muted">{t("comments.threadGone")}</p>
      );
    }
    return (
      <div className="flex flex-col gap-3">
        <CommentComposer
          pageId={itemId}
          label={t("comments.newInline")}
          placeholder={t("comments.placeholder")}
          submitLabel={t("comments.comment")}
          autoFocus
          onCancel={onCancel}
          onSubmit={async (body) => {
            const created = await create(body, pending);
            if (created) onCreated(created);
            return created !== null;
          }}
        />
      </div>
    );
  }

  const count = visibleComments(thread);
  const copyLink = async () => {
    const url = new URL(globalThis.location.href);
    url.searchParams.set("comment", thread.id);
    try {
      await navigator.clipboard.writeText(url.toString());
      toast({ title: t("comments.linkCopied") });
    } catch {
      toast({
        variant: "error",
        title: t("comments.linkCopyFailed"),
        description: t("page.copyManually", { url: url.toString() }),
      });
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <MessageSquare aria-hidden="true" className="size-icon-sm text-text-muted" />
        <span className="flex-1 text-sm text-text-muted">{t("comments.count", { count })}</span>
        {permissions.canComment ? (
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
              {t("comments.done")}
            </Button>
          )
        ) : null}
        <Menu
          trigger={<IconButton label={t("comments.threadActions")} icon={MoreHorizontal} size="sm" />}
          items={[{ label: t("comments.copyLink"), icon: MessageSquare, onSelect: () => void copyLink() }]}
        />
      </div>
      <ol className="flex flex-col gap-3">
        {[thread, ...thread.replies].map((entry) => (
          <li key={entry.id}>
            <FlatComment comment={entry} itemId={itemId} people={people} permissions={permissions} compact />
          </li>
        ))}
      </ol>
      {permissions.canComment ? <ReplyComposer itemId={itemId} threadId={thread.id} /> : null}
    </div>
  );
}
