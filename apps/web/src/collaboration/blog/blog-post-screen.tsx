import {
  Button,
  Dialog,
  Field,
  type SaveState as FieldSaveState,
  IconButton,
  Input,
  Menu,
  type MenuItem,
  Notice,
  PageHeader,
  SaveStatus,
  Skeleton,
  Textarea,
  useToast,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import {
  CalendarClock,
  Check,
  History,
  MoreHorizontal,
  Newspaper,
  Pencil,
  Pin,
  PinOff,
  Trash2,
  X,
} from "lucide-react";
import { lazy, Suspense, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { CollaborationProblemNotice } from "../../editor/save-indicator.js";
import type { SaveState } from "../../editor/save-state.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { AttachmentsSection, PageDropZone } from "../../files/attachments-section.js";
import { CoverEditor, CoverImage } from "../../files/cover.js";
import { AttachmentPreviewProvider } from "../../files/preview-host.js";
import { UploadsProvider } from "../../files/uploads.js";
import { instantToZoned, zonedToInstant } from "../../format/zoned.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { useDocumentTitle } from "../../screens/settings/settings-page.js";
import { useDeleteItem } from "../../spaces/content-actions.js";
import { draftQuery } from "../../spaces/content-queries.js";
import { InlineTitle } from "../../spaces/inline-title.js";
import { itemSlug } from "../../spaces/item-paths.js";
import { PageLabels } from "../../spaces/page-labels.js";
import { DraftBanner, DraftStatusLine, PublishButton } from "../../spaces/page-publishing.js";
import { PageContent, useLostEditPermission } from "../../spaces/page-screen.js";
import { Redirect } from "../../spaces/redirect.js";
import { spaceDisplayName } from "../../spaces/space-badge.js";
import { useSpace } from "../../spaces/space-context.js";
import { blogPostPath, type ItemDetails, itemQuery, spaceKeys } from "../../spaces/space-queries.js";
import { StarButton, useContentCollaboration } from "../content-collaboration.js";
import { type BlogPost, blogPostQuery, collaborationKeys } from "../queries.js";
import { PageReactions } from "../reaction-bar.js";
import { PostBadges, PostMeta } from "./blog-list.js";
import { FollowBlogButton } from "./follow-blog.js";
import { HeldNotice } from "./held-notice.js";

const route = getRouteApi("/app/spaces/$spaceKey/blog/$itemId/{-$slug}");

const PageEditor = lazy(() =>
  import("../../editor/page-editor.js").then((module) => ({ default: module.PageEditor })),
);

const EXCERPT_MAX = 500;

export function BlogPostScreen() {
  const { t } = useTranslation();
  const { itemId, slug } = route.useParams();
  const search = route.useSearch();
  const { space } = useSpace();
  const item = useQuery(itemQuery(itemId));
  const post = useQuery(blogPostQuery(itemId));
  useDocumentTitle(item.data?.title ?? "");
  if (item.isPending || post.isPending) {
    return (
      <div className="mx-auto flex w-full max-w-content flex-col gap-4 px-4 pt-6 md:px-8">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-field w-full" />
      </div>
    );
  }
  if (item.isError || post.isError) {
    const error = item.error ?? post.error;
    return (
      <div className="p-6">
        <LoadError
          what={t("blog.postLoadFailed")}
          error={error}
          onRetry={() => {
            void item.refetch();
            void post.refetch();
          }}
        />
      </div>
    );
  }
  if (
    item.data.kind !== "blogPost" ||
    item.data.spaceKey !== space.key ||
    slug !== itemSlug(item.data.title)
  ) {
    return (
      <Redirect
        to={blogPostPath(item.data.spaceKey, item.data.id, itemSlug(item.data.title))}
        search={search}
      />
    );
  }
  return <BlogPostView key={item.data.id} item={item.data} post={post.data} />;
}

function ScheduleDialog({
  post,
  open,
  onOpenChange,
}: {
  post: BlogPost;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const format = useFormat();
  const queryClient = useQueryClient();
  const timeZone = format.settings.timeZone;
  const initial = post.scheduledAt
    ? instantToZoned(post.scheduledAt, post.scheduledTimeZone ?? timeZone)
    : instantToZoned(new Date(Date.now() + 86_400_000), timeZone);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(post.scheduledAt ? initial.time : "08:00");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dateInput = useRef<HTMLInputElement>(null);

  const save = async () => {
    const at = zonedToInstant(date, time, timeZone);
    if (!at) {
      setError(t("blog.scheduleInvalid"));
      dateInput.current?.focus();
      return;
    }
    if (at.getTime() <= Date.now()) {
      setError(t("blog.scheduleInPast"));
      dateInput.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await request(() =>
        api.PUT("/api/v1/blog-posts/{postId}/schedule", {
          params: { path: { postId: post.id } },
          body: { at: at.toISOString(), timeZone },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: collaborationKeys.blogPost(post.id) });
      toast({ variant: "success", title: t("blog.scheduledToast", { date: format.dateTime(at) }) });
      onOpenChange(false);
    } catch (failure) {
      toast({ variant: "error", title: t("blog.scheduleFailed"), description: problemMessage(t, failure) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("blog.scheduleTitle")}
      description={t("blog.scheduleDescription", { timeZone })}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("blog.cancel")}
          </Button>
          <Button variant="primary" icon={CalendarClock} loading={busy} onClick={() => void save()}>
            {t("blog.schedulePublication")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("blog.scheduleDate")} error={error}>
          <Input
            ref={dateInput}
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
              setError(null);
            }}
          />
        </Field>
        <Field label={t("blog.scheduleTime")}>
          <Input
            type="time"
            value={time}
            onChange={(event) => {
              setTime(event.target.value);
              setError(null);
            }}
          />
        </Field>
      </div>
    </Dialog>
  );
}

function ExcerptField({ post }: { post: BlogPost }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(post.excerpt);
  const [state, setState] = useState<FieldSaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (value.trim() === post.excerpt) return;
    if (value.trim().length > EXCERPT_MAX) {
      setError(t("blog.excerptTooLong", { max: EXCERPT_MAX }));
      return;
    }
    setState("saving");
    try {
      await request(() =>
        api.PATCH("/api/v1/blog-posts/{postId}", {
          params: { path: { postId: post.id } },
          body: { excerpt: value.trim() },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: collaborationKeys.blogPost(post.id) });
      setError(null);
      setState("saved");
    } catch (failure) {
      setState("error");
      setError(problemMessage(t, failure));
    }
  };
  return (
    <Field label={t("blog.excerpt")} hint={t("blog.excerptHint", { max: EXCERPT_MAX })} error={error}>
      <div className="flex flex-col gap-1">
        <Textarea
          value={value}
          rows={2}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
          onBlur={() => void save()}
        />
        <SaveStatus state={state} />
      </div>
    </Field>
  );
}

function BlogPostView({ item, post }: { item: ItemDetails; post: BlogPost }) {
  const { space, canEdit } = useSpace();
  const search = route.useSearch();
  const lostEdit = useLostEditPermission(canEdit, search.edit === true);
  const writable = canEdit && !space.archived;
  return (
    <UploadsProvider pageId={item.id}>
      <AttachmentPreviewProvider canEdit={writable} requested={search.attachment}>
        <PageDropZone enabled={writable} title={item.title}>
          <BlogPostArticle item={item} post={post} lostEdit={lostEdit} />
        </PageDropZone>
      </AttachmentPreviewProvider>
    </UploadsProvider>
  );
}

function BlogPostArticle({ item, post, lostEdit }: { item: ItemDetails; post: BlogPost; lostEdit: boolean }) {
  const { t } = useTranslation();
  const format = useFormat();
  const { toast } = useToast();
  const { space, canEdit } = useSpace();
  const search = route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const deleteItem = useDeleteItem(space);
  const writable = canEdit && !space.archived;
  const editing = writable && search.edit === true;
  const draft = useQuery({ ...draftQuery(item.id), enabled: writable, throwOnError: false });
  const saveState = useRef<SaveState>("saved");
  const [scheduling, setScheduling] = useState(false);
  const title = writable && draft.data ? draft.data.title : item.title;
  const collaboration = useContentCollaboration({
    itemId: item.id,
    spaceId: space.id,
    role: space.role,
    archived: space.archived,
    writable,
  });

  const setEditing = (next: boolean) =>
    void navigate({
      to: blogPostPath(space.key, item.id, itemSlug(item.title)),
      search: next ? { edit: true } : {},
      replace: true,
    });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: collaborationKeys.blogPost(item.id) });
    await queryClient.invalidateQueries({ queryKey: collaborationKeys.spaceBlog(space.id) });
  };

  const cancelSchedule = async () => {
    try {
      await request(() =>
        api.DELETE("/api/v1/blog-posts/{postId}/schedule", { params: { path: { postId: post.id } } }),
      );
      await refresh();
      toast({ title: t("blog.scheduleCancelled") });
    } catch (error) {
      toast({
        variant: "error",
        title: t("blog.cancelScheduleFailed"),
        description: problemMessage(t, error),
      });
    }
  };

  const pin = async (pinned: boolean) => {
    try {
      await request(() =>
        api.PUT("/api/v1/blog-posts/{postId}/pinned", {
          params: { path: { postId: post.id } },
          body: { pinned },
        }),
      );
      await refresh();
      toast({ title: pinned ? t("blog.pinnedToast", { title }) : t("blog.unpinnedToast", { title }) });
    } catch (error) {
      toast({
        variant: "error",
        title: pinned ? t("blog.pinFailed") : t("blog.unpinFailed"),
        description: problemMessage(t, error),
      });
    }
  };

  const openHistory = () =>
    void navigate({
      to: "/spaces/$spaceKey/pages/$itemId/history",
      params: { spaceKey: space.key, itemId: item.id },
    });

  const menuItems: MenuItem[] = [{ label: t("versions.history"), icon: History, onSelect: openHistory }];
  if (writable) {
    menuItems.unshift({
      label: post.scheduledAt ? t("blog.changeSchedule") : t("blog.schedule"),
      icon: CalendarClock,
      onSelect: () => setScheduling(true),
    });
  }
  if (space.role === "admin" && !space.archived && post.published) {
    menuItems.push({
      label: post.pinnedInSpace ? t("blog.unpinInSpace") : t("blog.pinInSpace"),
      icon: post.pinnedInSpace ? PinOff : Pin,
      onSelect: () => void pin(!post.pinnedInSpace),
    });
  }
  if (writable) {
    menuItems.push(
      { type: "separator" },
      {
        label: t("trash.moveToTrash"),
        icon: Trash2,
        danger: true,
        onSelect: () => void deleteItem(item, { leave: true }),
      },
    );
  }

  return (
    <div className="flex min-h-full">
      <article className="mx-auto flex w-full min-w-0 max-w-content flex-col gap-4 px-4 pt-6 pb-12 md:px-8">
        <PageHeader
          title={
            writable ? (
              <InlineTitle
                value={title}
                label={t("blog.postTitle")}
                onSave={async (next) => {
                  await request(() =>
                    api.PATCH("/api/v1/items/{itemId}", {
                      params: { path: { itemId: item.id } },
                      body: { title: next },
                    }),
                  );
                  await queryClient.invalidateQueries({ queryKey: spaceKeys.item(item.id) });
                  await queryClient.invalidateQueries({ queryKey: ["items", item.id, "draft"] });
                  await refresh();
                }}
              />
            ) : (
              title
            )
          }
          icon={Newspaper}
          breadcrumbs={[
            { label: spaceDisplayName(t, space), href: `/spaces/${space.key}` },
            { label: t("blog.title"), href: `/spaces/${space.key}/blog` },
          ]}
          actions={
            <>
              {writable ? (
                editing ? (
                  <>
                    <Button variant="secondary" icon={Check} onClick={() => setEditing(false)}>
                      {t("page.done")}
                    </Button>
                    <PublishButton page={item} draft={draft.data} saveState={saveState} />
                  </>
                ) : (
                  <Button
                    variant="primary"
                    icon={Pencil}
                    onClick={() => setEditing(true)}
                    aria-keyshortcuts="E"
                  >
                    {t("page.edit")}
                  </Button>
                )
              ) : null}
              {space.role && !editing ? (
                <FollowBlogButton spaceId={space.id} spaceName={spaceDisplayName(t, space)} />
              ) : null}
              <StarButton target={{ itemId: item.id }} title={title} />
              {collaboration.commentsButton}
              <Menu trigger={<IconButton label={t("page.more")} icon={MoreHorizontal} />} items={menuItems} />
            </>
          }
        />
        <div className="flex flex-wrap items-center gap-2">
          <PostMeta post={post} />
          <PostBadges post={post} level="space" />
        </div>
        {post.held && !post.published ? (
          <HeldNotice post={post} canApprove={space.role === "admin" && !space.archived} />
        ) : null}
        {post.scheduledAt && !post.published && !post.held ? (
          <Notice
            variant="info"
            title={t("blog.scheduledNotice", { date: format.dateTime(post.scheduledAt) })}
            action={
              writable ? (
                <Button size="sm" variant="secondary" icon={X} onClick={() => void cancelSchedule()}>
                  {t("blog.cancelSchedule")}
                </Button>
              ) : undefined
            }
          >
            {t("blog.scheduledNoticeDescription")}
          </Notice>
        ) : null}
        {writable ? (
          editing ? (
            <DraftStatusLine draft={draft.data} />
          ) : (
            <DraftBanner draft={draft.data} onOpen={() => setEditing(true)} />
          )
        ) : null}
        {editing ? (
          <CoverEditor postId={post.id} itemId={item.id} cover={post.cover} onChanged={refresh} />
        ) : post.cover ? (
          <CoverImage cover={post.cover} alt="" className="aspect-video w-full rounded-md" />
        ) : null}
        {editing ? (
          <ExcerptField post={post} />
        ) : post.excerpt ? (
          <p className="text-lg text-text-muted">{post.excerpt}</p>
        ) : null}
        <PageLabels pageId={item.id} />
        {lostEdit ? <CollaborationProblemNotice problem="permissionRevoked" /> : null}
        {editing ? (
          <Suspense fallback={<Skeleton className="h-field w-full" />}>
            <PageEditor
              pageId={item.id}
              spaceId={space.id}
              spaceKey={space.key}
              draft
              onSaveStateChange={(state) => {
                saveState.current = state;
              }}
              {...collaboration.editor}
            />
          </Suspense>
        ) : writable && !post.published ? (
          <Notice variant="info" title={t("blog.notPublishedTitle")}>
            {t("blog.notPublishedDescription")}
          </Notice>
        ) : (
          <PageContent pageId={item.id} publishMode collaboration={collaboration.readView} />
        )}
        <AttachmentsSection pageId={item.id} canEdit={writable} />
        <PageReactions itemId={item.id} canReact={!space.archived} />
        {scheduling ? <ScheduleDialog post={post} open={scheduling} onOpenChange={setScheduling} /> : null}
      </article>
      {collaboration.panel}
    </div>
  );
}
