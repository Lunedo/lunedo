import { Button, Notice, useToast } from "@pagehall/ui";
import { useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { Send, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { problemMessage } from "../../errors/problem-message.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { type BlogPost, collaborationKeys } from "../queries.js";

export function useHeldActions(post: BlogPost) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<"publish" | "cancel" | null>(null);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: collaborationKeys.blogPost(post.id) });
    await queryClient.invalidateQueries({ queryKey: collaborationKeys.spaceBlog(post.spaceId) });
    await queryClient.invalidateQueries({ queryKey: collaborationKeys.allBlogs });
  };
  const run = async (action: "publish" | "cancel") => {
    setBusy(action);
    try {
      const params = { params: { path: { postId: post.id } } };
      await request(() =>
        action === "publish"
          ? api.POST("/api/v1/blog-posts/{postId}/held/publish", params)
          : api.DELETE("/api/v1/blog-posts/{postId}/held", params),
      );
      await refresh();
      toast({
        title:
          action === "publish"
            ? t("blog.heldPublishedToast", { title: post.title })
            : t("blog.scheduleCancelled"),
      });
    } catch (error) {
      toast({
        variant: "error",
        title: action === "publish" ? t("blog.publishHeldFailed") : t("blog.cancelScheduleFailed"),
        description: problemMessage(t, error),
      });
    } finally {
      setBusy(null);
    }
  };
  return { busy, publish: () => run("publish"), cancel: () => run("cancel") };
}

export function HeldActions({ post }: { post: BlogPost }) {
  const { t } = useTranslation();
  const actions = useHeldActions(post);
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="primary"
        icon={Send}
        loading={actions.busy === "publish"}
        onClick={() => void actions.publish()}
      >
        {t("blog.publishNow")}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        icon={X}
        loading={actions.busy === "cancel"}
        onClick={() => void actions.cancel()}
      >
        {t("blog.cancelSchedule")}
      </Button>
    </div>
  );
}

export function heldReason(t: TFunction, post: BlogPost) {
  return post.scheduledBy
    ? t("blog.heldReason", { name: post.scheduledBy.name ?? t("editor.mention.unknown") })
    : t("blog.heldReasonRemoved");
}

export function HeldNotice({ post, canApprove }: { post: BlogPost; canApprove: boolean }) {
  const { t } = useTranslation();
  const format = useFormat();
  return (
    <Notice
      variant="warning"
      title={t("blog.heldNotice", {
        date: post.scheduledAt ? format.dateTime(post.scheduledAt) : "",
      })}
      action={canApprove ? <HeldActions post={post} /> : undefined}
    >
      {heldReason(t, post)} {canApprove ? t("blog.heldAdmin") : t("blog.heldOthers")}
    </Notice>
  );
}
