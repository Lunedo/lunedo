import { Badge, Button, IconButton, useToast } from "@pagehall/ui";
import { Link } from "@tanstack/react-router";
import { CircleAlert, Clock, FilePen, Pin, PinOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { problemMessage } from "../../errors/problem-message.js";
import { CoverImage } from "../../files/cover.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { itemHref } from "../../spaces/item-paths.js";
import type { BlogPost } from "../queries.js";

export function postHref(post: Pick<BlogPost, "id" | "title" | "spaceKey">): string {
  return itemHref({ id: post.id, kind: "blogPost", title: post.title, link: null }, post.spaceKey) ?? "";
}

export function PostMeta({ post }: { post: BlogPost }) {
  const { t } = useTranslation();
  const format = useFormat();
  const author = post.author?.name ?? t("editor.mention.unknown");
  if (post.publishedAt) {
    return (
      <span className="text-sm text-text-muted">
        {t("blog.byOn", { author, date: format.date(post.publishedAt) })}
      </span>
    );
  }
  if (post.scheduledAt) {
    return (
      <span className="text-sm text-text-muted">
        {t("blog.byScheduled", { author, date: format.dateTime(post.scheduledAt) })}
      </span>
    );
  }
  return <span className="text-sm text-text-muted">{t("blog.byDraft", { author })}</span>;
}

export function PostBadges({ post, level }: { post: BlogPost; level: "space" | "organization" }) {
  const { t } = useTranslation();
  const pinned = level === "space" ? post.pinnedInSpace : post.pinnedInOrganization;
  return (
    <>
      {pinned ? (
        <Badge variant="accent" icon={Pin}>
          {t("blog.pinned")}
        </Badge>
      ) : null}
      {!post.published && post.held ? (
        <Badge variant="danger" icon={CircleAlert}>
          {t("blog.held")}
        </Badge>
      ) : null}
      {!post.published && post.scheduledAt && !post.held ? (
        <Badge variant="warning" icon={Clock}>
          {t("blog.scheduled")}
        </Badge>
      ) : null}
      {!post.published && !post.scheduledAt ? (
        <Badge variant="neutral" icon={FilePen}>
          {t("blog.draft")}
        </Badge>
      ) : null}
    </>
  );
}

export function BlogList({
  posts,
  level,
  showSpace,
  canPin,
  onPin,
  hasMore,
  loadingMore,
  onMore,
}: {
  posts: readonly BlogPost[];
  level: "space" | "organization";
  showSpace: boolean;
  canPin: boolean;
  onPin: (post: BlogPost, pinned: boolean) => Promise<void>;
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const pin = async (post: BlogPost, pinned: boolean) => {
    try {
      await onPin(post, pinned);
      toast({
        title: pinned
          ? t("blog.pinnedToast", { title: post.title })
          : t("blog.unpinnedToast", { title: post.title }),
      });
    } catch (error) {
      toast({
        variant: "error",
        title: pinned ? t("blog.pinFailed") : t("blog.unpinFailed"),
        description: problemMessage(t, error),
      });
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {posts.map((post) => {
          const pinned = level === "space" ? post.pinnedInSpace : post.pinnedInOrganization;
          return (
            <li key={post.id} className="flex items-start gap-3 p-4">
              <article className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={postHref(post)}
                    className="min-w-0 text-base font-semibold hover:underline focus-visible:focus-ring"
                    title={post.title}
                  >
                    {post.title}
                  </Link>
                  <PostBadges post={post} level={level} />
                </div>
                <span className="flex flex-wrap gap-x-2">
                  <PostMeta post={post} />
                  {showSpace ? <span className="text-sm text-text-muted">· {post.spaceName}</span> : null}
                </span>
                {post.excerpt ? <p className="text-text">{post.excerpt}</p> : null}
              </article>
              {post.cover ? (
                <CoverImage
                  cover={post.cover}
                  alt=""
                  className="hidden aspect-video w-1/4 shrink-0 rounded-md sm:block"
                />
              ) : null}
              {canPin && post.published ? (
                <IconButton
                  label={
                    pinned ? t("blog.unpin", { title: post.title }) : t("blog.pin", { title: post.title })
                  }
                  icon={pinned ? PinOff : Pin}
                  aria-pressed={pinned}
                  onClick={() => void pin(post, !pinned)}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      {hasMore ? (
        <Button variant="secondary" loading={loadingMore} onClick={onMore} className="self-center">
          {t("blog.loadMore")}
        </Button>
      ) : null}
    </div>
  );
}
