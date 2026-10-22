import { Button, useToast } from "@lunedo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellPlus, BellRing } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { problemMessage } from "../../errors/problem-message.js";

export const followKeys = {
  subscription: (spaceId: string) => ["blog", spaceId, "subscription"] as const,
  followed: ["account", "followedBlogs"] as const,
};

export function useFollowBlog(spaceId: string, spaceName: string) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const settle = async () => {
    await queryClient.invalidateQueries({ queryKey: followKeys.subscription(spaceId) });
    await queryClient.invalidateQueries({ queryKey: followKeys.followed });
  };
  const change = async (follow: boolean) => {
    const params = { params: { path: { spaceId } } };
    await request(() =>
      follow
        ? api.PUT("/api/v1/spaces/{spaceId}/blog/subscription", params)
        : api.DELETE("/api/v1/spaces/{spaceId}/blog/subscription", params),
    );
  };
  return useMutation({
    mutationFn: change,
    onMutate: (follow) => {
      queryClient.setQueryData(followKeys.subscription(spaceId), { following: follow });
    },
    onSuccess: (_result, follow) =>
      toast(
        follow
          ? { variant: "success", title: t("blog.followed", { space: spaceName }) }
          : {
              title: t("blog.unfollowed", { space: spaceName }),
              undo: {
                onUndo: () => {
                  void change(true).finally(() => void settle());
                },
              },
            },
      ),
    onError: (error, follow) =>
      toast({
        variant: "error",
        title: follow ? t("blog.followFailed") : t("blog.unfollowFailed"),
        description: problemMessage(t, error),
      }),
    onSettled: settle,
  });
}

export function FollowBlogButton({ spaceId, spaceName }: { spaceId: string; spaceName: string }) {
  const { t } = useTranslation();
  const subscription = useQuery({
    queryKey: followKeys.subscription(spaceId),
    throwOnError: false,
    queryFn: () =>
      request(() => api.GET("/api/v1/spaces/{spaceId}/blog/subscription", { params: { path: { spaceId } } })),
  });
  const toggle = useFollowBlog(spaceId, spaceName);
  if (!subscription.data) return null;
  const following = subscription.data.following;
  return (
    <Button
      variant="secondary"
      icon={following ? BellRing : BellPlus}
      aria-pressed={following}
      title={following ? t("blog.followingHint") : t("blog.followHint")}
      loading={toggle.isPending}
      onClick={() => toggle.mutate(!following)}
    >
      {following ? t("blog.following") : t("blog.follow")}
    </Button>
  );
}
