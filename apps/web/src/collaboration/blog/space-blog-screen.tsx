import {
  Button,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Skeleton,
  Textarea,
  useToast,
} from "@pagehall/ui";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { CalendarClock, Newspaper, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { useDocumentTitle } from "../../screens/settings/settings-page.js";
import { spaceDisplayName } from "../../spaces/space-badge.js";
import { useSpace } from "../../spaces/space-context.js";
import { collaborationKeys } from "../queries.js";
import { BlogList, PostBadges, PostMeta, postHref } from "./blog-list.js";
import { HeldActions, heldReason } from "./held-notice.js";

const TITLE_MAX = 255;
const EXCERPT_MAX = 500;

function CreatePostDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { space } = useSpace();
  const [title, setTitle] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [errors, setErrors] = useState<{ title?: string; excerpt?: string }>({});
  const [busy, setBusy] = useState(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const excerptInput = useRef<HTMLTextAreaElement>(null);

  const create = async () => {
    const next: { title?: string; excerpt?: string } = {};
    if (title.trim().length === 0) next.title = t("blog.titleRequired");
    else if (title.trim().length > TITLE_MAX) next.title = t("blog.titleTooLong", { max: TITLE_MAX });
    if (excerpt.trim().length > EXCERPT_MAX) next.excerpt = t("blog.excerptTooLong", { max: EXCERPT_MAX });
    setErrors(next);
    if (next.title) {
      titleInput.current?.focus();
      return;
    }
    if (next.excerpt) {
      excerptInput.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const post = await request(() =>
        api.POST("/api/v1/spaces/{spaceId}/blog", {
          params: { path: { spaceId: space.id } },
          body: { title: title.trim(), excerpt: excerpt.trim() },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: collaborationKeys.spaceBlog(space.id) });
      onOpenChange(false);
      setTitle("");
      setExcerpt("");
      await navigate({ to: postHref(post), search: { edit: true } });
    } catch (error) {
      toast({ variant: "error", title: t("blog.createFailed"), description: problemMessage(t, error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("blog.writeTitle", { space: spaceDisplayName(t, space) })}
      description={t("blog.writeDescription")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("blog.cancel")}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void create()}>
            {t("blog.createPost")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <Field label={t("blog.postTitle")} error={errors.title} required>
          <Input
            ref={titleInput}
            value={title}
            placeholder={t("blog.postTitleExample")}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field
          label={t("blog.excerpt")}
          hint={t("blog.excerptHint", { max: EXCERPT_MAX })}
          error={errors.excerpt}
        >
          <Textarea
            ref={excerptInput}
            value={excerpt}
            rows={3}
            onChange={(event) => setExcerpt(event.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  );
}

function ScheduledPosts({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();
  const scheduled = useQuery({
    queryKey: collaborationKeys.scheduledPosts(spaceId),
    throwOnError: false,
    queryFn: () =>
      request(() => api.GET("/api/v1/spaces/{spaceId}/blog/scheduled", { params: { path: { spaceId } } })),
  });
  return (
    <section aria-labelledby="scheduled-posts" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="scheduled-posts" className="flex items-center gap-2 text-lg font-semibold">
          <CalendarClock aria-hidden className="size-icon text-text-muted" />
          {t("blog.scheduledTitle")}
        </h2>
        <p className="text-sm text-text-muted">{t("blog.scheduledDescription")}</p>
      </div>
      {scheduled.isPending ? <Skeleton className="h-field w-full" /> : null}
      {scheduled.isError ? (
        <LoadError
          what={t("blog.scheduledLoadFailed")}
          error={scheduled.error}
          onRetry={() => scheduled.refetch()}
        />
      ) : null}
      {scheduled.data && scheduled.data.items.length === 0 ? (
        <p className="text-sm text-text-muted">{t("blog.scheduledEmpty")}</p>
      ) : null}
      {scheduled.data && scheduled.data.items.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {scheduled.data.items.map((post) => (
            <li key={post.id} className="flex flex-col gap-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to={postHref(post)}
                  className="min-w-0 font-semibold hover:underline focus-visible:focus-ring"
                  title={post.title}
                >
                  {post.title}
                </Link>
                <PostBadges post={post} level="space" />
              </div>
              <PostMeta post={post} />
              {post.held ? (
                <>
                  <p className="text-sm text-text">{heldReason(t, post)}</p>
                  <HeldActions post={post} />
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function SpaceBlogScreen() {
  const { t } = useTranslation();
  const { space, canEdit } = useSpace();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  useDocumentTitle(t("blog.spaceTitle", { space: spaceDisplayName(t, space) }));
  const posts = useInfiniteQuery({
    queryKey: collaborationKeys.spaceBlog(space.id),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      request(() =>
        api.GET("/api/v1/spaces/{spaceId}/blog", {
          params: {
            path: { spaceId: space.id },
            query: { limit: 30, ...(pageParam ? { cursor: pageParam } : {}) },
          },
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const items = posts.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <div className="mx-auto flex w-full max-w-page flex-col gap-6 px-4 pt-6 pb-12 md:px-8">
      <PageHeader
        title={t("blog.title")}
        description={t("blog.spaceDescription", { space: spaceDisplayName(t, space) })}
        icon={Newspaper}
        breadcrumbs={[
          { label: spaceDisplayName(t, space), href: `/spaces/${space.key}` },
          { label: t("blog.title") },
        ]}
        actions={
          canEdit ? (
            <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
              {t("blog.write")}
            </Button>
          ) : undefined
        }
      />
      {posts.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-field w-full" />
          <Skeleton className="h-field w-full" />
        </div>
      ) : null}
      {posts.isError ? (
        <LoadError what={t("blog.loadFailed")} error={posts.error} onRetry={() => posts.refetch()} />
      ) : null}
      {posts.data && items.length === 0 ? (
        <EmptyState
          icon={Newspaper}
          title={t("blog.emptyTitle")}
          description={canEdit ? t("blog.emptyEditor") : t("blog.emptyReader")}
          action={
            canEdit ? (
              <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
                {t("blog.write")}
              </Button>
            ) : undefined
          }
        />
      ) : null}
      {items.length > 0 ? (
        <BlogList
          posts={items}
          level="space"
          showSpace={false}
          canPin={space.role === "admin" && !space.archived}
          onPin={async (post, pinned) => {
            await request(() =>
              api.PUT("/api/v1/blog-posts/{postId}/pinned", {
                params: { path: { postId: post.id } },
                body: { pinned },
              }),
            );
            await queryClient.invalidateQueries({ queryKey: collaborationKeys.spaceBlog(space.id) });
          }}
          hasMore={posts.hasNextPage}
          loadingMore={posts.isFetchingNextPage}
          onMore={() => void posts.fetchNextPage()}
        />
      ) : null}
      {space.role === "admin" ? <ScheduledPosts spaceId={space.id} /> : null}
      <CreatePostDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
