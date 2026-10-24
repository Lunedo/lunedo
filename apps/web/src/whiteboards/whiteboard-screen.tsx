import { Skeleton } from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { ApiError, request } from "../api/request.js";
import { LoadError } from "../errors/failure.js";
import { useDocumentTitle } from "../screens/settings/settings-page.js";
import { NoPageAccess } from "../sharing/access-requests.js";
import { usePageSharing } from "../sharing/page-sharing.js";
import { useArchiveItem, useDeleteItem } from "../spaces/content-actions.js";
import { InlineTitle } from "../spaces/inline-title.js";
import { itemHref, itemSlug } from "../spaces/item-paths.js";
import { Redirect } from "../spaces/redirect.js";
import { spaceDisplayName } from "../spaces/space-badge.js";
import { useSpace } from "../spaces/space-context.js";
import { type ItemDetails, itemQuery, spaceKeys, whiteboardPath } from "../spaces/space-queries.js";
import { WhiteboardView, whiteboardMenu } from "./whiteboard-view.js";

const route = getRouteApi("/app/spaces/$spaceKey/whiteboards/$itemId/{-$slug}");

export function WhiteboardScreen() {
  const { t } = useTranslation();
  const { itemId, slug } = route.useParams();
  const { space } = useSpace();
  const item = useQuery(itemQuery(itemId));
  useDocumentTitle(item.data?.title ?? "");
  if (item.isPending) {
    return (
      <div className="flex w-full flex-col gap-4 px-4 pt-6 md:px-8">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-field w-full" />
      </div>
    );
  }
  if (item.isError) {
    if (item.error instanceof ApiError && item.error.status === 404) return <NoPageAccess pageId={itemId} />;
    return (
      <div className="p-6">
        <LoadError what={t("whiteboards.loadFailed")} error={item.error} onRetry={() => item.refetch()} />
      </div>
    );
  }
  const board = item.data;
  if (board.kind !== "whiteboard" || board.spaceKey !== space.key || slug !== itemSlug(board.title)) {
    const href = itemHref(board, board.spaceKey);
    if (href) return <Redirect to={href} />;
  }
  return <SpaceWhiteboard key={board.id} board={board} />;
}

function SpaceWhiteboard({ board }: { board: ItemDetails }) {
  const { t } = useTranslation();
  const { space, canEdit, openMove, openCopy } = useSpace();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const deleteItem = useDeleteItem(space);
  const { archive, unarchive } = useArchiveItem();
  const sharing = usePageSharing(
    {
      id: board.id,
      title: board.title,
      spaceId: space.id,
      organizationId: space.organizationId,
      organizationName: space.organizationName,
      confidential: space.confidential,
      viewRestriction: board.viewRestriction,
      editRestricted: board.editRestricted,
      spaceRole: space.role,
    },
    true,
  );
  const mayEdit = canEdit && sharing.canEditPage !== false;
  const writable = mayEdit && !board.archived && !space.archived;
  const rename = async (title: string) => {
    await request(() =>
      api.PATCH("/api/v1/items/{itemId}", { params: { path: { itemId: board.id } }, body: { title } }),
    );
    await queryClient.invalidateQueries({ queryKey: spaceKeys.item(board.id) });
    await queryClient.invalidateQueries({ queryKey: ["spaces", space.id, "children"] });
    await navigate({ to: whiteboardPath(space.key, board.id, itemSlug(title)), replace: true });
  };
  const breadcrumbs = [
    { label: spaceDisplayName(t, space), href: `/spaces/${space.key}` },
    ...board.ancestors.map((ancestor) => {
      const href = itemHref({ ...ancestor, link: null }, space.key);
      return href ? { label: ancestor.title, href } : { label: ancestor.title };
    }),
  ];
  return (
    <WhiteboardView
      board={{ id: board.id, title: board.title, spaceId: space.id, archived: board.archived }}
      title={
        writable ? (
          <InlineTitle value={board.title} label={t("whiteboards.titleLabel")} onSave={rename} />
        ) : (
          board.title
        )
      }
      breadcrumbs={breadcrumbs}
      editedAt={board.contentUpdatedAt}
      role={space.role}
      mayEdit={mayEdit}
      spaceArchived={space.archived}
      share={sharing.shareButton}
      restrictionNote={sharing.restrictionNote}
      dialogs={sharing.dialog}
      onHistory={() =>
        void navigate({
          to: "/spaces/$spaceKey/whiteboards/$itemId/history",
          params: { spaceKey: space.key, itemId: board.id },
        })
      }
      onUnarchive={() => void unarchive(board)}
      menuItems={whiteboardMenu(t, {
        writable,
        canEdit: canEdit && !space.archived,
        archived: board.archived,
        onMove: () => openMove(board),
        onCopy: () => openCopy(board),
        onArchive: () => void archive(board),
        onUnarchive: () => void unarchive(board),
        onDelete: () => void deleteItem(board, { leave: true }),
      })}
    />
  );
}
