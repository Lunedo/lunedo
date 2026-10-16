import { type MenuItem, useToast } from "@pagehall/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Archive,
  ArchiveRestore,
  ArrowRightLeft,
  FilePlus,
  FileText,
  Folder,
  Link as LinkIcon,
  Move,
  Presentation,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { problemMessage } from "../../errors/problem-message.js";
import { useArchiveItem, useDeleteItem } from "../content-actions.js";
import { itemHref } from "../item-paths.js";
import { useSpace } from "../space-context.js";
import type { SpaceWithRole, TreeItem } from "../space-queries.js";

export function useConvert() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return (item: Pick<TreeItem, "id" | "title" | "spaceId">, kind: "page" | "folder", spaceKey: string) =>
    request(() =>
      api.POST("/api/v1/items/{itemId}/convert", { params: { path: { itemId: item.id } }, body: { kind } }),
    )
      .then(async (converted) => {
        await queryClient.invalidateQueries({ queryKey: ["spaces", item.spaceId, "children"] });
        await queryClient.invalidateQueries({ queryKey: ["items", item.id] });
        toast({
          title:
            kind === "folder"
              ? t("tree.convertedToFolder", { title: item.title })
              : t("tree.convertedToPage", { title: item.title }),
          variant: "success",
        });
        const href = itemHref(converted, spaceKey);
        if (href) await navigate({ to: href, replace: true });
      })
      .catch((error: unknown) =>
        toast({ title: t("tree.convertFailed"), description: problemMessage(t, error), variant: "error" }),
      );
}

export function useItemActions(
  space: SpaceWithRole,
  item: TreeItem,
  currentId: string | null = null,
): MenuItem[] {
  const { t } = useTranslation();
  const { toast } = useToast();
  const context = useSpace();
  const convert = useConvert();
  const deleteItem = useDeleteItem(space);
  const archiving = useArchiveItem();
  const href = itemHref(item, space.key);
  const overview = space.overviewItemId === item.id;
  const items: MenuItem[] = [];
  const container = item.kind === "page" || item.kind === "folder";
  if (context.canEdit && container) {
    items.push(
      { label: t("tree.newPageInside"), icon: FilePlus, onSelect: () => context.openCreate("page", item.id) },
      {
        label: t("tree.newFolderInside"),
        icon: Folder,
        onSelect: () => context.openCreate("folder", item.id),
      },
      {
        label: t("tree.newWhiteboardInside"),
        icon: Presentation,
        onSelect: () => context.openCreate("whiteboard", item.id),
      },
      { type: "separator" },
    );
  }
  if (context.canEdit) {
    items.push({ label: t("tree.move"), icon: Move, onSelect: () => context.openMove(item) });
    if (container && !overview) {
      items.push(
        item.kind === "page"
          ? {
              label: t("tree.convertToFolder"),
              icon: ArrowRightLeft,
              onSelect: () => void convert(item, "folder", space.key),
            }
          : {
              label: t("tree.convertToPage"),
              icon: FileText,
              onSelect: () => void convert(item, "page", space.key),
            },
      );
    }
  }
  if (href) {
    items.push({
      label: t("tree.copyLink"),
      icon: LinkIcon,
      onSelect: () => {
        const absolute = new URL(href, globalThis.location.origin).toString();
        void navigator.clipboard
          .writeText(absolute)
          .then(() => toast({ title: t("tree.linkCopied"), variant: "success" }))
          .catch(() => toast({ title: t("tree.copyFailed"), variant: "error" }));
      },
    });
  }
  if (context.canEdit && !overview && item.kind !== "link") {
    items.push(
      { type: "separator" },
      item.archived
        ? {
            label: t("archive.unarchive"),
            icon: ArchiveRestore,
            onSelect: () => void archiving.unarchive(item),
          }
        : { label: t("archive.archive"), icon: Archive, onSelect: () => void archiving.archive(item) },
    );
  }
  if (context.canEdit && !overview) {
    items.push({
      label: t("trash.moveToTrash"),
      icon: Trash2,
      danger: true,
      onSelect: () => void deleteItem(item, { leave: currentId === item.id }),
    });
  }
  return items.length > 0 && items.at(-1)?.type === "separator" ? items.slice(0, -1) : items;
}
