import { Button, EmptyState, IconButton, Menu, PageHeader, SegmentedControl, Skeleton } from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import {
  ArrowRightLeft,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  Link2,
  MoreHorizontal,
  Move,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { AutoSaveTextField } from "../components/auto-save.js";
import { LoadError } from "../errors/failure.js";
import { preferenceKeys, useUpdatePreference } from "../preferences/preferences.js";
import { usePreferences } from "../preferences/preferences-provider.js";
import { useDocumentTitle } from "../screens/settings/settings-page.js";
import { InlineTitle } from "./inline-title.js";
import { itemHref, itemSlug } from "./item-paths.js";
import { Redirect } from "./redirect.js";
import { spaceDisplayName } from "./space-badge.js";
import { useSpace } from "./space-context.js";
import { itemQuery, spaceKeys, type TreeItem } from "./space-queries.js";
import { useConvert } from "./tree/item-actions.js";
import { useChildren } from "./tree/page-tree.js";

const route = getRouteApi("/app/spaces/$spaceKey/folders/$itemId/{-$slug}");

export function FolderScreen() {
  const { t } = useTranslation();
  const { itemId, slug } = route.useParams();
  const { space, canEdit, openCreate, openMove } = useSpace();
  const queryClient = useQueryClient();
  const item = useQuery(itemQuery(itemId));
  const convert = useConvert();
  const preferences = usePreferences();
  const updatePreference = useUpdatePreference();
  const view = preferences.folderView;
  useDocumentTitle(item.data?.title ?? "");

  if (item.isPending) return <Skeleton className="m-6 h-field" />;
  if (item.isError) {
    return (
      <div className="p-6">
        <LoadError what={t("folder.loadFailed")} error={item.error} onRetry={() => item.refetch()} />
      </div>
    );
  }
  const folder = item.data;
  if (folder.kind !== "folder" || folder.spaceKey !== space.key || slug !== itemSlug(folder.title)) {
    const href = itemHref(folder, folder.spaceKey);
    if (href) return <Redirect to={href} />;
  }
  const save = async (changes: { title?: string; description?: string }) => {
    await request(() => api.PATCH("/api/v1/items/{itemId}", { params: { path: { itemId } }, body: changes }));
    await queryClient.invalidateQueries({ queryKey: spaceKeys.item(itemId) });
    await queryClient.invalidateQueries({ queryKey: ["spaces", space.id, "children"] });
  };
  const breadcrumbs = [
    { label: spaceDisplayName(t, space), href: `/spaces/${space.key}` },
    ...folder.ancestors.map((ancestor) => ({
      label: ancestor.title,
      href: itemHref({ ...ancestor, link: null }, space.key) ?? undefined,
    })),
  ];
  return (
    <div className="mx-auto flex w-full max-w-page flex-col gap-6 px-4 pt-6 pb-12 md:px-8">
      <PageHeader
        title={
          canEdit ? (
            <InlineTitle
              value={folder.title}
              label={t("folder.titleLabel")}
              onSave={(title) => save({ title })}
            />
          ) : (
            folder.title
          )
        }
        icon={FolderOpen}
        breadcrumbs={breadcrumbs.map((crumb) => (crumb.href ? crumb : { label: crumb.label }))}
        actions={
          <>
            <SegmentedControl
              label={t("folder.view")}
              value={view}
              onValueChange={(value) => updatePreference.mutate({ key: preferenceKeys.folderView, value })}
              options={[
                { value: "list", label: t("folder.list") },
                { value: "tiles", label: t("folder.tiles") },
              ]}
            />
            {canEdit ? (
              <>
                <Button variant="secondary" icon={FilePlus} onClick={() => openCreate("page", folder.id)}>
                  {t("folder.newPage")}
                </Button>
                <Menu
                  trigger={<IconButton label={t("folder.more")} icon={MoreHorizontal} />}
                  items={[
                    {
                      label: t("tree.newFolderInside"),
                      icon: Folder,
                      onSelect: () => openCreate("folder", folder.id),
                    },
                    {
                      label: t("tree.newLinkInside"),
                      icon: Link2,
                      onSelect: () => openCreate("link", folder.id),
                    },
                    { type: "separator" },
                    { label: t("tree.move"), icon: Move, onSelect: () => openMove(folder) },
                    {
                      label: t("tree.convertToPage"),
                      icon: ArrowRightLeft,
                      onSelect: () => void convert(folder, "page", space.key),
                    },
                  ]}
                />
              </>
            ) : null}
          </>
        }
      />
      {canEdit ? (
        <AutoSaveTextField
          label={t("folder.description")}
          hint={t("createItem.descriptionHint")}
          value={folder.description}
          multiline
          onSave={(description) => save({ description })}
        />
      ) : folder.description ? (
        <p className="text-text-muted">{folder.description}</p>
      ) : null}
      <FolderContents folderId={folder.id} view={view} />
    </div>
  );
}

function FolderContents({ folderId, view }: { folderId: string; view: "list" | "tiles" }) {
  const { t } = useTranslation();
  const { space, canEdit, openCreate } = useSpace();
  const children = useChildren(space.id, folderId);
  const items = children.data?.pages.flatMap((page) => page.items) ?? [];
  if (children.isPending) return <Skeleton className="h-12 w-full" />;
  if (children.isError) {
    return (
      <LoadError
        what={t("folder.contentsFailed")}
        error={children.error}
        onRetry={() => children.refetch()}
      />
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Folder}
        title={t("folder.empty")}
        description={t("folder.emptyDescription")}
        action={
          canEdit ? (
            <Button variant="primary" icon={FilePlus} onClick={() => openCreate("page", folderId)}>
              {t("folder.newPage")}
            </Button>
          ) : undefined
        }
      />
    );
  }
  return (
    <>
      <ul
        aria-label={t("folder.contents")}
        className={
          view === "tiles"
            ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            : "flex flex-col divide-y divide-border rounded-md border border-border"
        }
      >
        {items.map((item) => (
          <FolderEntry key={item.id} item={item} tile={view === "tiles"} />
        ))}
      </ul>
      {children.hasNextPage ? (
        <Button
          variant="secondary"
          loading={children.isFetchingNextPage}
          onClick={() => void children.fetchNextPage()}
        >
          {t("tree.showMore")}
        </Button>
      ) : null}
    </>
  );
}

function FolderEntry({ item, tile }: { item: TreeItem; tile: boolean }) {
  const { t } = useTranslation();
  const { space } = useSpace();
  const href = itemHref(item, space.key);
  const Glyph = item.kind === "folder" ? Folder : item.kind === "link" ? Link2 : FileText;
  const title = item.kind === "link" && !item.link?.accessible ? t("tree.noAccess") : item.title;
  const content = (
    <>
      <Glyph aria-hidden="true" className="size-icon shrink-0 text-text-muted" />
      <span className="min-w-0 flex-1 truncate font-medium" title={title}>
        {title}
      </span>
      {item.kind === "folder" && item.description ? (
        <span
          className={
            tile
              ? "line-clamp-2 w-full text-sm text-text-muted"
              : "hidden truncate text-sm text-text-muted sm:block sm:max-w-content"
          }
        >
          {item.description}
        </span>
      ) : null}
    </>
  );
  const className = tile
    ? "flex h-full flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-4 hover:bg-hover focus-visible:focus-ring"
    : "flex min-h-hit items-center gap-3 px-4 py-3 hover:bg-hover focus-visible:focus-ring";
  if (!href) {
    return (
      <li>
        <span className={className}>{content}</span>
      </li>
    );
  }
  return (
    <li>
      {/^https?:/.test(href) ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
          {content}
        </a>
      ) : (
        <Link to={href} className={className}>
          {content}
        </Link>
      )}
    </li>
  );
}
