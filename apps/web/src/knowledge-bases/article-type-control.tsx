import { Menu, useToast } from "@lunedo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { problemMessage } from "../errors/problem-message.js";
import { spaceKeys } from "../spaces/space-queries.js";
import { ARTICLE_TYPES, articleTypeIcon, articleTypeLabel } from "./article-types.js";
import { type ArticleType, knowledgeBaseKeys } from "./queries.js";

export function ArticleTypeControl({
  itemId,
  spaceId,
  type,
  editable,
}: {
  itemId: string;
  spaceId: string;
  type: string | null;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const Icon = articleTypeIcon(type);
  const label = articleTypeLabel(t, type);
  if (!editable) {
    return type ? (
      <span className="inline-flex items-center gap-1 text-sm text-text-muted">
        <Icon aria-hidden="true" className="size-icon-sm" />
        {label}
      </span>
    ) : null;
  }
  const change = async (next: ArticleType | null) => {
    try {
      await request(() =>
        api.PUT("/api/v1/articles/{itemId}/type", { params: { path: { itemId } }, body: { type: next } }),
      );
      await queryClient.invalidateQueries({ queryKey: spaceKeys.item(itemId) });
      await queryClient.invalidateQueries({ queryKey: knowledgeBaseKeys.all(spaceId) });
      toast({
        title: t("knowledgeBase.articleTypes.changed", { type: articleTypeLabel(t, next) }),
        variant: "success",
      });
    } catch (error) {
      toast({
        title: t("knowledgeBase.articleTypes.changeFailed"),
        description: problemMessage(t, error),
        variant: "error",
      });
    }
  };
  return (
    <Menu
      align="start"
      trigger={
        <button
          type="button"
          className="ld-inline-button inline-flex min-h-hit items-center gap-1 rounded-sm px-1 text-sm hover:bg-hover focus-visible:focus-ring"
          aria-label={t("knowledgeBase.articleTypes.change", { type: label })}
        >
          <Icon aria-hidden="true" className="size-icon-sm" />
          {label}
          <ChevronDown aria-hidden="true" className="size-icon-sm" />
        </button>
      }
      items={[
        ...ARTICLE_TYPES.map((value) => ({
          label: articleTypeLabel(t, value),
          icon: articleTypeIcon(value),
          onSelect: () => void change(value),
        })),
        { label: articleTypeLabel(t, null), onSelect: () => void change(null) },
      ]}
    />
  );
}
