import {
  Button,
  ConfirmDialog,
  EmptyState,
  List,
  ListRow,
  Section,
  Skeleton,
  TruncatedText,
  useToast,
} from "@lunedo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BellOff, Newspaper } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { followKeys, useFollowBlog } from "./follow-blog.js";

type FollowedBlog = {
  spaceId: string;
  spaceKey: string;
  spaceName: string;
  personal: boolean;
  followedAt: string;
};

function UnfollowButton({ blog }: { blog: FollowedBlog }) {
  const { t } = useTranslation();
  const unfollow = useFollowBlog(blog.spaceId, blog.spaceName);
  return (
    <Button
      size="sm"
      variant="secondary"
      icon={BellOff}
      loading={unfollow.isPending}
      onClick={() => unfollow.mutate(false)}
    >
      {t("blog.unfollow")}
    </Button>
  );
}

export function FollowedBlogs() {
  const { t } = useTranslation();
  const format = useFormat();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const followed = useQuery({
    queryKey: followKeys.followed,
    throwOnError: false,
    queryFn: () => request(() => api.GET("/api/v1/account/followed-blogs")),
  });
  const removeUnavailable = useMutation({
    mutationFn: () => request(() => api.DELETE("/api/v1/account/followed-blogs/unavailable")),
    onSuccess: (result) => toast({ title: t("blog.unavailableRemoved", { count: result.removed }) }),
    onError: (error) =>
      toast({
        variant: "error",
        title: t("blog.unavailableRemoveFailed"),
        description: problemMessage(t, error),
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: followKeys.followed }),
  });

  return (
    <Section title={t("blog.followedTitle")} icon={Newspaper}>
      <p className="py-3 text-sm text-text-muted">{t("blog.followedDescription")}</p>
      {followed.isPending ? (
        <div className="py-3">
          <Skeleton className="h-field w-full" />
        </div>
      ) : null}
      {followed.isError ? (
        <div className="py-3">
          <LoadError
            what={t("blog.followedLoadFailed")}
            error={followed.error}
            onRetry={() => followed.refetch()}
          />
        </div>
      ) : null}
      {followed.data && followed.data.items.length === 0 && followed.data.unavailable === 0 ? (
        <EmptyState
          icon={Newspaper}
          title={t("blog.followedEmptyTitle")}
          description={t("blog.followedEmpty")}
        />
      ) : null}
      {followed.data && followed.data.items.length > 0 ? (
        <List label={t("blog.followedTitle")}>
          {followed.data.items.map((blog) => (
            <ListRow
              key={blog.spaceId}
              icon={Newspaper}
              title={
                <Link
                  to="/spaces/$spaceKey/blog"
                  params={{ spaceKey: blog.spaceKey }}
                  className="hover:underline focus-visible:focus-ring"
                >
                  <TruncatedText
                    text={blog.personal ? t("blog.personalBlog", { name: blog.spaceName }) : blog.spaceName}
                  />
                </Link>
              }
              description={t("blog.followedSince", { date: format.date(blog.followedAt) })}
              actions={<UnfollowButton blog={blog} />}
            />
          ))}
        </List>
      ) : null}
      {followed.data && followed.data.unavailable > 0 ? (
        <div className="flex flex-wrap items-center gap-3 py-3">
          <p className="min-w-0 flex-1 text-sm text-text-muted">
            {t("blog.unavailableFollowed", { count: followed.data.unavailable })}
          </p>
          <Button
            size="sm"
            variant="secondary"
            loading={removeUnavailable.isPending}
            onClick={() => setConfirming(true)}
          >
            {t("blog.removeUnavailable", { count: followed.data.unavailable })}
          </Button>
          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={t("blog.removeUnavailableTitle", { count: followed.data.unavailable })}
            description={t("blog.removeUnavailableDescription")}
            confirmLabel={t("blog.removeUnavailable", { count: followed.data.unavailable })}
            cancelLabel={t("blog.cancel")}
            destructive
            onConfirm={() => removeUnavailable.mutateAsync().then(() => undefined)}
          />
        </div>
      ) : null}
    </Section>
  );
}
