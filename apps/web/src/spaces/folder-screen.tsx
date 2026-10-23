import { Button, EmptyState, IconButton, Menu, type MenuItem, Skeleton, Table } from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import {
  ArrowRightLeft,
  Copy,
  FilePlus,
  Folder,
  LayoutGrid,
  Link2,
  List,
  MoreHorizontal,
  Move,
  Plus,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";

import { LoadError } from "../errors/failure.js";
import { isKnowledgeBase } from "../knowledge-bases/queries.js";
import { preferenceKeys, useUpdatePreference } from "../preferences/preferences.js";
import { useFormat, usePreferences } from "../preferences/preferences-provider.js";
import { useDocumentTitle } from "../screens/settings/settings-page.js";
import { WhiteboardPreview } from "../whiteboards/whiteboard-preview.js";
import { FolderDescription } from "./folder-description.js";
import { InlineTitle } from "./inline-title.js";
import { itemIcon } from "./item-icons.js";
import { itemKindLabel } from "./item-kinds.js";
import { itemHref, itemSlug } from "./item-paths.js";
import { TransferOwnerDialog } from "./ownership/owner-line.js";
import { PageBar } from "./page-bar.js";
import { Redirect } from "./redirect.js";
import { spaceDisplayName } from "./space-badge.js";
import { useSpace } from "./space-context.js";
import { itemQuery, spaceKeys, type TreeItem } from "./space-queries.js";
import { creatableKinds } from "./space-types.js";
import { useConvert } from "./tree/item-actions.js";
import { useChildren } from "./tree/page-tree.js";

const route = getRouteApi("/app/spaces/$spaceKey/folders/$itemId/{-$slug}");

export function FolderScreen() {
  const { t } = useTranslation();
  const { itemId, slug } = route.useParams();
  const { space, canEdit, openCreate, openMove, openCopy } = useSpace();
  const queryClient = useQueryClient();
  const item = useQuery(itemQuery(itemId));
  const convert = useConvert();
  const preferences = usePreferences();
  const updatePreference = useUpdatePreference();
  const view = preferences.folderView;
  const knowledgeBase = isKnowledgeBase(space);
  const [transferring, setTransferring] = useState(false);
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
  const newItems: MenuItem[] = [
    {
      label: knowledgeBase ? t("knowledgeBase.newArticle") : t("folder.newPage"),
      icon: FilePlus,
      onSelect: () => openCreate("page", folder.id),
    },
    {
      label: knowledgeBase ? t("knowledgeBase.newCategoryInside") : t("tree.newFolderInside"),
      icon: Folder,
      onSelect: () => openCreate("folder", folder.id),
    },
    ...(creatableKinds(space).includes("link")
      ? [{ label: t("tree.newLinkInside"), icon: Link2, onSelect: () => openCreate("link", folder.id) }]
      : []),
  ];
  const moreItems: MenuItem[] = [
    view === "list"
      ? {
          label: t("folder.showTiles"),
          icon: LayoutGrid,
          onSelect: () => updatePreference.mutate({ key: preferenceKeys.folderView, value: "tiles" }),
        }
      : {
          label: t("folder.showList"),
          icon: List,
          onSelect: () => updatePreference.mutate({ key: preferenceKeys.folderView, value: "list" }),
        },
    ...(canEdit
      ? [
          { type: "separator" as const },
          { label: t("tree.move"), icon: Move, onSelect: () => openMove(folder) },
          { label: t("tree.copy"), icon: Copy, onSelect: () => openCopy(folder) },
          ...(knowledgeBase
            ? []
            : [
                {
                  label: t("tree.convertToPage"),
                  icon: ArrowRightLeft,
                  onSelect: () => void convert(folder, "page", space.key),
                },
              ]),
        ]
      : []),
    ...(folder.ownershipTransferable
      ? [
          {
            label: folder.owner ? t("ownership.transfer") : t("ownership.assign"),
            icon: UserRound,
            onSelect: () => setTransferring(true),
          },
        ]
      : []),
  ];
  return (
    <div className="flex min-h-full flex-col">
      <PageBar
        breadcrumbs={[
          ...breadcrumbs.map((crumb) => (crumb.href ? crumb : { label: crumb.label })),
          { label: folder.title },
        ]}
      >
        {canEdit ? (
          <Menu
            align="end"
            trigger={
              <Button variant="outline" icon={Plus}>
                {t("folder.new")}
              </Button>
            }
            items={newItems}
          />
        ) : null}
        <Menu trigger={<IconButton label={t("folder.more")} icon={MoreHorizontal} />} items={moreItems} />
      </PageBar>
      <div className="mx-auto flex w-full max-w-page flex-col gap-4 px-4 pt-6 pb-12 md:px-8">
        <header className="flex flex-col gap-2">
          <h1 className="flex min-w-0 items-center gap-3 text-xl font-semibold tracking-heading">
            <Folder aria-hidden="true" className="size-icon-lg shrink-0 text-text-muted" />
            {canEdit ? (
              <InlineTitle
                value={folder.title}
                label={t("folder.titleLabel")}
                onSave={(title) => save({ title })}
              />
            ) : (
              <span className="min-w-0 truncate" title={folder.title}>
                {folder.title}
              </span>
            )}
          </h1>
          {canEdit ? (
            <FolderDescription value={folder.description} onSave={(description) => save({ description })} />
          ) : folder.description ? (
            <p className="text-text-muted">{folder.description}</p>
          ) : null}
        </header>
        <FolderContents folderId={folder.id} view={view} />
      </div>
      {transferring ? (
        <TransferOwnerDialog
          item={{ id: folder.id, spaceId: space.id, title: folder.title }}
          currentOwner={folder.owner}
          onClose={() => setTransferring(false)}
        />
      ) : null}
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
    const knowledgeBase = isKnowledgeBase(space);
    return (
      <EmptyState
        icon={Folder}
        title={knowledgeBase ? t("knowledgeBase.category.empty") : t("folder.empty")}
        description={
          knowledgeBase ? t("knowledgeBase.category.emptyDescription") : t("folder.emptyDescription")
        }
        action={
          canEdit ? (
            <Button variant="primary" icon={FilePlus} onClick={() => openCreate("page", folderId)}>
              {knowledgeBase ? t("knowledgeBase.newArticle") : t("folder.newPage")}
            </Button>
          ) : undefined
        }
      />
    );
  }
  return (
    <>
      {view === "tiles" ? (
        <ul aria-label={t("folder.contents")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <FolderTile key={item.id} item={item} />
          ))}
        </ul>
      ) : (
        <Table
          caption={t("folder.contents")}
          rows={items}
          rowKey={(item) => item.id}
          columns={[
            {
              key: "name",
              header: t("folder.columns.name"),
              grow: true,
              cell: (item) => <FolderEntryLink item={item} />,
            },
            {
              key: "kind",
              header: t("folder.columns.kind"),
              cell: (item) => <span className="text-text-muted">{itemKindLabel(t, item.kind)}</span>,
            },
            {
              key: "changed",
              header: t("folder.columns.changed"),
              hideBelow: "sm",
              cell: (item) => <ChangedAt value={item.contentUpdatedAt} />,
            },
          ]}
        />
      )}
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

function ChangedAt({ value }: { value: string }) {
  const format = useFormat();
  return (
    <time className="text-text-muted" dateTime={value} title={format.dateTime(value)}>
      {format.day(value)}
    </time>
  );
}

function FolderEntryLink({ item }: { item: TreeItem }) {
  const { t } = useTranslation();
  const { space } = useSpace();
  const href = itemHref(item, space.key);
  const Glyph = itemIcon(item.kind);
  const title = item.kind === "link" && !item.link?.accessible ? t("tree.noAccess") : item.title;
  const content = (
    <>
      <Glyph aria-hidden="true" className="size-icon-md shrink-0 text-text-muted" />
      <span className="min-w-0 truncate" title={title}>
        {title}
      </span>
    </>
  );
  const className =
    "inline-flex min-w-0 items-center gap-3 rounded-sm hover:underline focus-visible:focus-ring";
  if (!href) return <span className={className}>{content}</span>;
  return /^https?:/.test(href) ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {content}
    </a>
  ) : (
    <Link to={href} className={className}>
      {content}
    </Link>
  );
}

function FolderTile({ item }: { item: TreeItem }) {
  const { t } = useTranslation();
  const { space } = useSpace();
  const href = itemHref(item, space.key);
  const Glyph = itemIcon(item.kind);
  const title = item.kind === "link" && !item.link?.accessible ? t("tree.noAccess") : item.title;
  const content = (
    <>
      {item.kind === "whiteboard" ? (
        <WhiteboardPreview
          itemId={item.id}
          label={t("whiteboards.previewOf", { title })}
          className="aspect-video w-full"
        />
      ) : null}
      <Glyph aria-hidden="true" className="size-icon-md shrink-0 text-text-muted" />
      <span className="min-w-0 flex-1 truncate font-medium" title={title}>
        {title}
      </span>
      {item.kind === "folder" && item.description ? (
        <span className="line-clamp-2 w-full text-sm text-text-muted">{item.description}</span>
      ) : null}
    </>
  );
  const className =
    "flex h-full flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-4 hover:bg-hover focus-visible:focus-ring";
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
