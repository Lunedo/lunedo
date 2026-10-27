import { useToast } from "@lunedo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { problemMessage } from "../errors/problem-message.js";
import { itemHref } from "./item-paths.js";
import type { SpaceWithRole, TreeItem } from "./space-queries.js";
import { useRestoreFailure, withParentsQuery } from "./trash/restore-with-parents.js";

type Item = Pick<TreeItem, "id" | "number" | "title" | "kind" | "spaceId">;

export function useContentRefresh() {
  const queryClient = useQueryClient();
  return async (item: Pick<TreeItem, "id" | "spaceId">) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["items", item.id] }),
      queryClient.invalidateQueries({ queryKey: ["spaces", item.spaceId] }),
    ]);
  };
}

export function useDeleteItem(space: SpaceWithRole) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const refresh = useContentRefresh();
  return async (item: Item, options: { leave?: boolean } = {}) => {
    try {
      const entry = await request(() =>
        api.DELETE("/api/v1/items/{itemId}", { params: { path: { itemId: item.id } } }),
      );
      await refresh(item);
      if (options.leave) await navigate({ to: "/spaces/$spaceKey", params: { spaceKey: space.key } });
      toast({
        title: t("trash.deleted", { title: item.title }),
        description:
          entry.descendants > 0
            ? t("trash.deletedWithDescendants", { count: entry.descendants })
            : t("trash.deletedDescription"),
        undo: {
          onUndo: () =>
            void request(() =>
              api.POST("/api/v1/spaces/{spaceId}/trash/{entryId}/restore", {
                params: { path: { spaceId: space.id, entryId: entry.id } },
              }),
            )
              .then(async () => {
                await refresh(item);
                const href = options.leave ? itemHref({ ...item, link: null }, space.key) : null;
                if (href) await navigate({ to: href });
              })
              .catch((error: unknown) =>
                toast({
                  title: t("trash.restoreFailed"),
                  description: problemMessage(t, error),
                  variant: "error",
                }),
              ),
        },
      });
    } catch (error) {
      toast({ title: t("trash.deleteFailed"), description: problemMessage(t, error), variant: "error" });
    }
  };
}

export function useArchiveItem() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const refresh = useContentRefresh();
  const restoreFailed = useRestoreFailure();
  const unarchive = async (item: Item, withParents = false) => {
    const result = await request(() =>
      api.POST("/api/v1/items/{itemId}/unarchive", {
        params: { path: { itemId: item.id }, query: withParentsQuery(withParents) },
      }),
    );
    await refresh(item);
    return result;
  };
  const bringBack = async (item: Item, withParents: boolean) => {
    try {
      const result = await unarchive(item, withParents);
      toast({
        title: t("archive.unarchived", { title: item.title }),
        description:
          result.parentEntries > 0
            ? t("trash.restoredWithParents")
            : result.parentId
              ? t("archive.backAtPlace")
              : t("archive.backAtTop"),
        variant: "success",
      });
    } catch (error) {
      restoreFailed(t("archive.unarchiveFailed"), error, () => bringBack(item, true));
    }
  };
  return {
    archive: async (item: Item) => {
      try {
        await request(() =>
          api.POST("/api/v1/items/{itemId}/archive", { params: { path: { itemId: item.id } } }),
        );
        await refresh(item);
        toast({
          title: t("archive.archived", { title: item.title }),
          description: t("archive.archivedDescription"),
          undo: {
            onUndo: () =>
              void unarchive(item).catch((error: unknown) =>
                toast({
                  title: t("archive.unarchiveFailed"),
                  description: problemMessage(t, error),
                  variant: "error",
                }),
              ),
          },
        });
      } catch (error) {
        toast({ title: t("archive.archiveFailed"), description: problemMessage(t, error), variant: "error" });
      }
    },
    unarchive: (item: Item) => bringBack(item, false),
  };
}

export function useDiscardDraft() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const refresh = useContentRefresh();
  return async (item: Item, basedOn: number | null) => {
    try {
      const { discardedDraftId } = await request(() =>
        api.POST("/api/v1/pages/{pageId}/draft/discard", { params: { path: { pageId: item.id } } }),
      );
      await refresh(item);
      toast({
        title: t("versions.discarded"),
        description: t("versions.discardedDescription", { version: basedOn ?? 0 }),
        undo: {
          onUndo: () =>
            void request(() =>
              api.POST("/api/v1/pages/{pageId}/discarded-drafts/{draftId}/restore", {
                params: { path: { pageId: item.id, draftId: discardedDraftId } },
              }),
            )
              .then(() => refresh(item))
              .catch((error: unknown) =>
                toast({
                  title: t("versions.undoFailed"),
                  description: problemMessage(t, error),
                  variant: "error",
                }),
              ),
        },
      });
    } catch (error) {
      toast({ title: t("versions.discardFailed"), description: problemMessage(t, error), variant: "error" });
    }
  };
}

export async function changeMode(pageId: string, mode: "publish" | "live", confirmDraft = false) {
  await request(() =>
    api.PUT("/api/v1/pages/{pageId}/mode", {
      params: { path: { pageId } },
      body: { mode, ...(confirmDraft ? { confirmDraft: true } : {}) },
    }),
  );
}
