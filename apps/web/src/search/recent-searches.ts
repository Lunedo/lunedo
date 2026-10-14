import { useToast } from "@pagehall/ui";
import { useTranslation } from "react-i18next";
import { problemMessage } from "../errors/problem-message.js";
import { filtersOf, type RecentSearch, useForgetSearch, useRememberSearch } from "./search-api.js";

export function useClearRecentSearches(organizationId: string) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const forget = useForgetSearch(organizationId);
  const remember = useRememberSearch(organizationId);
  const clear = (entries: readonly RecentSearch[]) => {
    const oldestFirst = [...entries].reverse();
    forget.mutate(null, {
      onSuccess: () =>
        toast({
          title: t("search.recent.cleared"),
          undo: {
            onUndo: () => {
              void (async () => {
                for (const entry of oldestFirst)
                  await remember.mutateAsync({ query: entry.query, filters: filtersOf(entry.filters) });
              })();
            },
          },
        }),
      onError: (error) =>
        toast({
          title: t("search.recent.clearFailed"),
          description: problemMessage(t, error),
          variant: "error",
          action: { label: t("ui.retry"), onSelect: () => clear(entries) },
        }),
    });
  };
  return clear;
}
