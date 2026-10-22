import { Badge, type BadgeVariant, Button, Popover, useToast } from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown, Languages, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { problemMessage } from "../errors/problem-message.js";
import { contentLanguageLabel } from "../search/content-language.js";
import { itemSlug } from "../spaces/item-paths.js";
import { pagePath, spaceKeys } from "../spaces/space-queries.js";
import { knowledgeBaseKeys, type TranslationState, translationsQuery } from "./queries.js";

const STATE_BADGES: Record<TranslationState, BadgeVariant> = {
  original: "neutral",
  current: "success",
  outdated: "warning",
  unpublished: "neutral",
  missing: "warning",
};

export function TranslationsControl({
  itemId,
  spaceId,
  spaceKey,
  editable,
}: {
  itemId: string;
  spaceId: string;
  spaceKey: string;
  editable: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const translations = useQuery({ ...translationsQuery(itemId), throwOnError: false });
  const data = translations.data;
  if (!data || data.translations.length < 2) return null;
  const label = (language: string) => contentLanguageLabel(t, language, i18n.language);
  const own = data.translations.find((entry) => entry.itemId === itemId);
  const outdated = own?.state === "outdated";

  const create = async (language: string) => {
    setCreating(language);
    try {
      const created = await request(() =>
        api.POST("/api/v1/articles/{itemId}/translations", {
          params: { path: { itemId: data.sourceId } },
          body: { language },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: knowledgeBaseKeys.translations(itemId) });
      await queryClient.invalidateQueries({ queryKey: knowledgeBaseKeys.all(spaceId) });
      await queryClient.invalidateQueries({ queryKey: spaceKeys.children(spaceId, data.sourceId) });
      setOpen(false);
      toast({
        title: t("knowledgeBase.translations.created"),
        description: t("knowledgeBase.translations.createdDescription"),
        variant: "success",
      });
      await navigate({ to: pagePath(spaceKey, created.id, itemSlug(created.title)), search: { edit: true } });
    } catch (failure) {
      toast({
        title: t("knowledgeBase.translations.createFailed"),
        description: problemMessage(t, failure),
        variant: "error",
      });
    } finally {
      setCreating(null);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      label={t("knowledgeBase.translations.heading")}
      trigger={
        <button
          type="button"
          className="ld-inline-button inline-flex min-h-hit items-center gap-1 rounded-sm px-1 text-sm hover:bg-hover focus-visible:focus-ring"
          aria-label={t("knowledgeBase.translations.buttonLabel", { language: label(data.language) })}
        >
          <Languages aria-hidden="true" className="size-icon-sm" />
          {label(data.language)}
          {outdated ? (
            <Badge variant="warning">{t("knowledgeBase.translations.states.outdated")}</Badge>
          ) : null}
          <ChevronDown aria-hidden="true" className="size-icon-sm" />
        </button>
      }
    >
      <div className="flex w-popover max-w-full flex-col gap-3">
        <h2 className="font-semibold">{t("knowledgeBase.translations.heading")}</h2>
        {outdated ? (
          <p className="text-sm text-text-muted">{t("knowledgeBase.translations.outdatedHint")}</p>
        ) : null}
        <ul className="flex flex-col divide-y divide-border">
          {data.translations.map((entry) => (
            <li key={entry.language} className="flex flex-wrap items-center gap-2 py-2">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{label(entry.language)}</span>
                {entry.title ? (
                  <span className="block truncate text-sm text-text-muted" title={entry.title}>
                    {entry.title}
                  </span>
                ) : null}
                {entry.enabled ? null : (
                  <span className="block text-sm text-text-muted">
                    {t("knowledgeBase.translations.disabled")}
                  </span>
                )}
              </span>
              <Badge variant={STATE_BADGES[entry.state]}>
                {t(`knowledgeBase.translations.states.${entry.state}`)}
              </Badge>
              {entry.itemId && entry.itemId !== itemId ? (
                <Link
                  to={pagePath(spaceKey, entry.itemId, itemSlug(entry.title ?? ""))}
                  className="inline-flex min-h-hit items-center rounded-sm px-2 text-sm text-accent hover:underline focus-visible:focus-ring"
                  onClick={() => setOpen(false)}
                >
                  {t("knowledgeBase.translations.open")}
                </Link>
              ) : null}
              {entry.state === "missing" && entry.enabled && editable ? (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={Plus}
                  loading={creating === entry.language}
                  onClick={() => void create(entry.language)}
                >
                  {t("knowledgeBase.translations.create", { language: label(entry.language) })}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </Popover>
  );
}
