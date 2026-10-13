import {
  Button,
  ConfirmDialog,
  DangerAction,
  DangerZone,
  EmptyState,
  Notice,
  PageHeader,
  useToast,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { useDocumentTitle } from "../../screens/settings/settings-page.js";
import { contentKeys, type TrashEntry, trashQuery } from "../content-queries.js";
import { itemHref } from "../item-paths.js";
import { spaceDisplayName } from "../space-badge.js";
import { useSpace } from "../space-context.js";
import { formerParentOf, useRestoreChoice } from "./restore-choice.js";
import { useRestoreFailure, withParentsQuery } from "./restore-with-parents.js";
import { RestoreButton, TrashTable } from "./trash-table.js";

export function TrashScreen() {
  const { t } = useTranslation();
  const { space, canEdit } = useSpace();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const trash = useQuery({ ...trashQuery(space.id), enabled: canEdit && !space.archived });
  const [emptying, setEmptying] = useState(false);
  const name = spaceDisplayName(t, space);
  useDocumentTitle(`${t("trash.title")} · ${name}`);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: contentKeys.trash(space.id) });
    await queryClient.invalidateQueries({ queryKey: ["spaces", space.id, "children"] });
  };

  const restoreFailed = useRestoreFailure();

  const restore = async (entry: TrashEntry, withParents = false) => {
    try {
      const result = await request(() =>
        api.POST("/api/v1/spaces/{spaceId}/trash/{entryId}/restore", {
          params: { path: { spaceId: space.id, entryId: entry.id }, query: withParentsQuery(withParents) },
        }),
      );
      await refresh();
      const href =
        result.itemId && entry.itemKind
          ? itemHref({ id: result.itemId, kind: entry.itemKind, title: entry.title, link: null }, space.key)
          : null;
      toast({
        title: t("trash.restored", { title: entry.title }),
        description:
          result.parentEntries > 0
            ? t("trash.restoredWithParents")
            : result.parentId
              ? t("trash.restoredAtPlace")
              : entry.formerParentEntryId
                ? t("trash.restoredParentInTrash", {
                    parent: formerParentOf(entry, trash.data)?.title ?? "",
                  })
                : t("trash.restoredAtTop"),
        variant: "success",
        ...(href ? { action: { label: t("trash.open"), onSelect: () => void navigate({ to: href }) } } : {}),
      });
    } catch (error) {
      restoreFailed(t("trash.restoreFailed"), error, () => restore(entry, true));
    }
  };

  const entries = trash.data ?? [];
  const choice = useRestoreChoice(trash.data, restore);
  return (
    <div className="mx-auto flex w-full max-w-page flex-col gap-6 px-4 pt-6 pb-12 md:px-8">
      <PageHeader
        title={t("trash.title")}
        description={t("trash.description")}
        icon={Trash2}
        breadcrumbs={[{ label: name, href: `/spaces/${space.key}` }, { label: t("trash.title") }]}
      />
      {!canEdit ? (
        <Notice variant="info">{t("trash.editorsOnly")}</Notice>
      ) : trash.isError ? (
        <LoadError what={t("trash.loadFailed")} error={trash.error} onRetry={() => trash.refetch()} />
      ) : (
        <TrashTable
          entries={trash.data}
          caption={t("trash.title")}
          loading={trash.isPending}
          empty={
            <EmptyState
              icon={Trash2}
              title={t("trash.emptyTitle")}
              description={t("trash.emptyDescription")}
            />
          }
          actions={(entry) => (
            <RestoreButton label={t("trash.restore")} onClick={() => choice.start(entry)} />
          )}
        />
      )}
      {space.role === "admin" && entries.length > 0 ? (
        <DangerZone title={t("trash.dangerZone")}>
          <DangerAction
            title={t("trash.emptyTrash")}
            description={t("trash.emptyTrashDescription", { count: entries.length })}
            action={
              <Button variant="danger" onClick={() => setEmptying(true)}>
                {t("trash.emptyTrashAction", { count: entries.length })}
              </Button>
            }
          />
        </DangerZone>
      ) : null}
      {choice.dialog}
      <ConfirmDialog
        open={emptying}
        onOpenChange={setEmptying}
        title={t("trash.emptyConfirmTitle", { count: entries.length })}
        description={t("trash.emptyConfirmDescription")}
        confirmLabel={t("trash.emptyTrashAction", { count: entries.length })}
        cancelLabel={t("trash.keepEntries")}
        destructive
        onConfirm={async () => {
          try {
            const result = await request(() =>
              api.POST("/api/v1/spaces/{spaceId}/trash/empty", { params: { path: { spaceId: space.id } } }),
            );
            await refresh();
            toast({ title: t("trash.emptied", { count: result.entries }), variant: "success" });
          } catch (error) {
            toast({ title: t("trash.emptyFailed"), description: problemMessage(t, error), variant: "error" });
          }
        }}
      />
    </div>
  );
}
