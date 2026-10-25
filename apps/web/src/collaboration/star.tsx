import { IconButton, type MenuItem, useToast } from "@lunedo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Star, StarOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { problemMessage } from "../errors/problem-message.js";
import { collaborationKeys, starredQuery } from "./queries.js";

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
