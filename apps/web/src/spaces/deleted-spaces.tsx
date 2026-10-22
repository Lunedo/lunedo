import { Button, EmptyState, useToast } from "@lunedo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { LoadError } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import type { TrashEntry } from "./content-queries.js";
import { spaceKeys } from "./space-queries.js";
import { TrashTable } from "./trash/trash-table.js";

export const deletedSpacesKey = ["spaces", "deleted"] as const;

export function DeletedSpaces({
  search,
  onClearSearch,
  onShowActive,
}: {
  search: string;
  onClearSearch: () => void;
  onShowActive: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const deleted = useQuery({
    queryKey: deletedSpacesKey,
    queryFn: () => request(() => api.GET("/api/v1/deleted-spaces")),
  });
  const restore = useMutation({
    mutationFn: (entry: TrashEntry) =>
      request(() =>
        api.POST("/api/v1/deleted-spaces/{entryId}/restore", { params: { path: { entryId: entry.id } } }),
      ),
    onSuccess: (_result, entry) => {
      toast({ title: t("spaces.deleted.restored", { name: entry.title }), variant: "success" });
      void queryClient.invalidateQueries({ queryKey: spaceKeys.all });
    },
    onError: (failure) =>
      toast({
        title: t("spaces.deleted.restoreFailed"),
        description: problemMessage(t, failure),
        variant: "error",
      }),
  });
  if (deleted.isError) {
    return (
      <LoadError
        what={t("spaces.deleted.loadFailed")}
        error={deleted.error}
        onRetry={() => deleted.refetch()}
      />
    );
  }
  const needle = search.toLowerCase();
  const entries = deleted.data?.filter(
    (entry) =>
      needle === "" ||
      entry.title.toLowerCase().includes(needle) ||
      entry.spaceKey.toLowerCase().includes(needle),
  );
  return (
    <section aria-labelledby="deleted-spaces" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="deleted-spaces" className="text-lg font-semibold">
          {t("spaces.deleted.title")}
        </h2>
        <p className="text-sm text-text-muted">{t("spaces.deleted.description")}</p>
      </div>
      <TrashTable
        entries={entries}
        caption={t("spaces.deleted.title")}
        loading={deleted.isPending}
        empty={
          <EmptyState
            icon={Trash2}
            title={needle ? t("spaces.list.noMatch") : t("spaces.deleted.none")}
            description={
              needle ? t("spaces.deleted.noMatchDescription") : t("spaces.deleted.noneDescription")
            }
            action={
              <Button variant="secondary" onClick={needle ? onClearSearch : onShowActive}>
                {needle ? t("spaces.list.clearFilters") : t("spaces.deleted.showActive")}
              </Button>
            }
          />
        }
        actions={(entry) => (
          <Button
            size="sm"
            variant="secondary"
            loading={restore.isPending && restore.variables?.id === entry.id}
            aria-label={t("spaces.deleted.restoreNamed", { name: entry.title })}
            onClick={() => restore.mutate(entry)}
          >
            {t("trash.restore")}
          </Button>
        )}
      />
    </section>
  );
}
