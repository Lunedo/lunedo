import { Button, IconButton, Menu, type MenuItem, Notice, PageHeader, Skeleton } from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import {
  Archive,
  ArchiveRestore,
  ArrowRightLeft,
  Check,
  FileCheck,
  FilePlus,
  FileText,
  History,
  LayoutTemplate,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Move,
  Pencil,
  Radio,
  Trash2,
  Undo2,
} from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { ApiError, request } from "../api/request.js";
import { StarButton, useContentCollaboration } from "../collaboration/content-collaboration.js";
import { PageReactions } from "../collaboration/reaction-bar.js";
import { PageReadView, type ReadViewCollaboration } from "../editor/read-view.js";
import type { SaveState } from "../editor/save-state.js";
import { LoadError } from "../errors/failure.js";
import { AttachmentsSection, PageDropZone } from "../files/attachments-section.js";
import { AttachmentPreviewProvider } from "../files/preview-host.js";
import { UploadsProvider } from "../files/uploads.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { useDocumentTitle } from "../screens/settings/settings-page.js";
import { NoPageAccess } from "../sharing/access-requests.js";
import { type PageSharing, usePageSharing } from "../sharing/page-sharing.js";
import { EDIT_PAGE_EVENT } from "../shell/builtin.js";
import { useArchiveItem, useDeleteItem, useDiscardDraft } from "./content-actions.js";
import { draftQuery } from "./content-queries.js";
import { InlineTitle } from "./inline-title.js";
import { itemHref, itemSlug } from "./item-paths.js";
import { PageLabels } from "./page-labels.js";
import {
  DraftBanner,
  DraftStatusLine,
  ModeSwitchDialog,
  PublishButton,
  useModeSwitch,
} from "./page-publishing.js";
import { Redirect } from "./redirect.js";
import { spaceDisplayName } from "./space-badge.js";
import { useSpace } from "./space-context.js";
import {
  backlinksQuery,
  contentQuery,
  type ItemDetails,
  itemQuery,
  pagePath,
  spaceKeys,
} from "./space-queries.js";
import { SaveTemplateDialog } from "./templates/save-template-dialog.js";
import { useConvert } from "./tree/item-actions.js";

const route = getRouteApi("/app/spaces/$spaceKey/pages/$itemId/{-$slug}");

const PageEditor = lazy(() =>
  import("../editor/page-editor.js").then((module) => ({ default: module.PageEditor })),
);

export function PageScreen() {
  const { t } = useTranslation();
  const { itemId, slug } = route.useParams();
  const search = route.useSearch();
  const { space } = useSpace();
  const item = useQuery(itemQuery(itemId));
  useDocumentTitle(item.data?.title ?? "");
  if (item.isPending) {
    return (
      <div className="mx-auto flex w-full max-w-content flex-col gap-4 px-4 pt-6 md:px-8">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-field w-full" />
      </div>
    );
  }
  if (item.isError) {
    if (item.error instanceof ApiError && item.error.status === 404) return <NoPageAccess pageId={itemId} />;
    return (
      <div className="p-6">
        <LoadError what={t("page.loadFailed")} error={item.error} onRetry={() => item.refetch()} />
      </div>
    );
  }
  const page = item.data;
  if (page.kind !== "page" || page.spaceKey !== space.key || slug !== itemSlug(page.title)) {
    const href = itemHref(page, page.spaceKey);
    if (href) return <Redirect to={href} search={search} />;
  }
  return <PageView key={page.id} page={page} />;
}

function PageView({ page }: { page: ItemDetails }) {
  const { space, canEdit } = useSpace();
  const sharing = usePageSharing(
    {
      id: page.id,
      title: page.title,
      spaceId: space.id,
      organizationId: space.organizationId,
      organizationName: space.organizationName,
      viewRestriction: page.viewRestriction,
      editRestricted: page.editRestricted,
    },
    true,
  );
  const writable = canEdit && sharing.canEditPage !== false && !page.archived && !space.archived;
  return (
    <UploadsProvider pageId={page.id}>
      <AttachmentPreviewProvider canEdit={writable}>
        <PageDropZone enabled={writable} title={page.title}>
          <PageArticle page={page} sharing={sharing} />
        </PageDropZone>
      </AttachmentPreviewProvider>
    </UploadsProvider>
  );
}

function PageArticle({ page, sharing }: { page: ItemDetails; sharing: PageSharing }) {
  const { t } = useTranslation();
  const { space, canEdit, openMove, openCreate } = useSpace();
  const search = route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const convert = useConvert();
  const deleteItem = useDeleteItem(space);
  const { archive, unarchive } = useArchiveItem();
  const discard = useDiscardDraft();
  const writable = canEdit && sharing.canEditPage !== false && !page.archived && !space.archived;
  const editing = writable && search.edit === true;
  const publishMode = page.mode === "publish";
  const draft = useQuery({ ...draftQuery(page.id), enabled: writable && publishMode, throwOnError: false });
  const saveState = useRef<SaveState>("saved");
  const [confirmingLive, setConfirmingLive] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const switchMode = useModeSwitch(page, draft.data, () => setConfirmingLive(true));
  const title = writable && publishMode && draft.data ? draft.data.title : page.title;
  const collaboration = useContentCollaboration({
    itemId: page.id,
    spaceId: space.id,
    role: space.role,
    archived: page.archived || space.archived,
    writable,
  });

  const setEditing = (next: boolean) =>
    void navigate({
      to: pagePath(space.key, page.id, itemSlug(page.title)),
      search: next ? { edit: true } : {},
      replace: true,
    });

  useEffect(() => {
    const onEdit = () => {
      if (writable) setEditing(true);
    };
    globalThis.addEventListener(EDIT_PAGE_EVENT, onEdit);
    return () => globalThis.removeEventListener(EDIT_PAGE_EVENT, onEdit);
  });

  const save = async (changes: { title?: string; width?: "fixed" | "full" }) => {
    await request(() =>
      api.PATCH("/api/v1/items/{itemId}", { params: { path: { itemId: page.id } }, body: changes }),
    );
    await queryClient.invalidateQueries({ queryKey: spaceKeys.item(page.id) });
    await queryClient.invalidateQueries({ queryKey: ["items", page.id, "draft"] });
    await queryClient.invalidateQueries({ queryKey: ["spaces", space.id, "children"] });
  };

  const breadcrumbs = [
    { label: spaceDisplayName(t, space), href: `/spaces/${space.key}` },
    ...page.ancestors.map((ancestor) => {
      const href = itemHref({ ...ancestor, link: null }, space.key);
      return href ? { label: ancestor.title, href } : { label: ancestor.title };
    }),
  ];
  const overview = space.overviewItemId === page.id;
  const width = page.width;
  const openHistory = () =>
    void navigate({
      to: "/spaces/$spaceKey/pages/$itemId/history",
      params: { spaceKey: space.key, itemId: page.id },
    });

  const menuItems: MenuItem[] = [];
  if (writable) {
    menuItems.push(
      { label: t("tree.newPageInside"), icon: FilePlus, onSelect: () => openCreate("page", page.id) },
      { label: t("tree.move"), icon: Move, onSelect: () => openMove(page) },
      ...(overview
        ? []
        : [
            {
              label: t("tree.convertToFolder"),
              icon: ArrowRightLeft,
              onSelect: () => void convert(page, "folder", space.key),
            },
          ]),
      {
        label: width === "full" ? t("page.useFixedWidth") : t("page.useFullWidth"),
        icon: width === "full" ? Minimize2 : Maximize2,
        onSelect: () => void save({ width: width === "full" ? "fixed" : "full" }),
      },
      { type: "separator" },
      {
        label: publishMode ? t("versions.switchToLive") : t("versions.switchToPublish"),
        icon: publishMode ? Radio : FileCheck,
        onSelect: () => void switchMode(),
      },
      ...(publishMode && draft.data?.hasChanges && draft.data.basedOn !== null
        ? [
            {
              label: t("versions.discardDraft"),
              icon: Undo2,
              onSelect: () => void discard(page, draft.data?.basedOn ?? null),
            },
          ]
        : []),
      {
        label: t("templates.saveAsTemplate"),
        icon: LayoutTemplate,
        onSelect: () => setSavingTemplate(true),
      },
    );
  }
  menuItems.push({ label: t("versions.history"), icon: History, onSelect: openHistory });
  if (canEdit && !space.archived && !overview) {
    menuItems.push(
      { type: "separator" },
      page.archived
        ? { label: t("archive.unarchive"), icon: ArchiveRestore, onSelect: () => void unarchive(page) }
        : { label: t("archive.archive"), icon: Archive, onSelect: () => void archive(page) },
      {
        label: t("trash.moveToTrash"),
        icon: Trash2,
        danger: true,
        onSelect: () => void deleteItem(page, { leave: true }),
      },
    );
  }

  return (
    <div className="flex min-h-full">
      <article
        className={`mx-auto flex w-full min-w-0 flex-col gap-4 px-4 pt-6 pb-12 md:px-8 ${width === "full" ? "max-w-none" : "max-w-content"}`}
      >
        <PageHeader
          title={
            writable ? (
              <InlineTitle
                value={title}
                label={t("page.titleLabel")}
                autoFocus={editing && title === t("tree.untitledPage")}
                onSave={async (next) => {
                  await save({ title: next });
                  if (!publishMode || !page.published) {
                    await navigate({
                      to: pagePath(space.key, page.id, itemSlug(next)),
                      search,
                      replace: true,
                    });
                  }
                }}
              />
            ) : (
              title
            )
          }
          icon={FileText}
          breadcrumbs={breadcrumbs}
          actions={
            <>
              {writable ? (
                editing ? (
                  publishMode ? (
                    <>
                      <Button variant="secondary" icon={Check} onClick={() => setEditing(false)}>
                        {t("page.done")}
                      </Button>
                      <PublishButton page={page} draft={draft.data} saveState={saveState} />
                    </>
                  ) : (
                    <Button variant="primary" icon={Check} onClick={() => setEditing(false)}>
                      {t("page.done")}
                    </Button>
                  )
                ) : (
                  <Button
                    variant="primary"
                    icon={Pencil}
                    onClick={() => setEditing(true)}
                    aria-keyshortcuts="E"
                  >
                    {t("page.edit")}
                  </Button>
                )
              ) : null}
              {sharing.shareButton}
              <StarButton target={{ itemId: page.id }} title={title} />
              {collaboration.commentsButton}
              <IconButton label={t("versions.history")} icon={History} onClick={openHistory} />
              <Menu trigger={<IconButton label={t("page.more")} icon={MoreHorizontal} />} items={menuItems} />
            </>
          }
        />
        {sharing.restrictionNote}
        {page.archived || space.archived ? (
          <Notice
            variant="warning"
            title={page.archived ? t("archive.pageArchivedTitle") : t("archive.spaceArchivedTitle")}
            action={
              page.archived && canEdit && !space.archived ? (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={ArchiveRestore}
                  onClick={() => void unarchive(page)}
                >
                  {t("archive.unarchive")}
                </Button>
              ) : undefined
            }
          >
            {page.archived ? t("archive.pageArchivedDescription") : t("archive.spaceArchivedDescription")}
          </Notice>
        ) : null}
        {writable && publishMode ? (
          editing ? (
            <DraftStatusLine draft={draft.data} />
          ) : (
            <DraftBanner draft={draft.data} onOpen={() => setEditing(true)} />
          )
        ) : null}
        <PageLabels pageId={page.id} />
        {editing ? (
          <Suspense fallback={<Skeleton className="h-field w-full" />}>
            <PageEditor
              pageId={page.id}
              spaceId={space.id}
              spaceKey={space.key}
              draft={publishMode}
              onSaveStateChange={(state) => {
                saveState.current = state;
              }}
              {...collaboration.editor}
            />
          </Suspense>
        ) : writable && publishMode && !page.published ? null : (
          <PageContent pageId={page.id} publishMode={publishMode} collaboration={collaboration.readView} />
        )}
        <AttachmentsSection pageId={page.id} canEdit={writable} />
        <PageReactions itemId={page.id} canReact={!page.archived && !space.archived} />
        <Backlinks pageId={page.id} />
        <ModeSwitchDialog
          page={page}
          draft={draft.data}
          open={confirmingLive}
          onOpenChange={setConfirmingLive}
        />
        {sharing.dialog}
        <SaveTemplateDialog
          spaceId={space.id}
          page={{ id: page.id, title }}
          open={savingTemplate}
          onOpenChange={setSavingTemplate}
        />
      </article>
      {collaboration.panel}
    </div>
  );
}

export function PageContent({
  pageId,
  publishMode,
  collaboration,
}: {
  pageId: string;
  publishMode: boolean;
  collaboration: ReadViewCollaboration;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const content = useQuery(contentQuery(pageId));
  if (content.isPending) return <Skeleton className="h-field w-full" />;
  if (content.isError) {
    return (
      <LoadError what={t("page.contentFailed")} error={content.error} onRetry={() => content.refetch()} />
    );
  }
  const version = content.data.version;
  return (
    <>
      {publishMode && version !== null ? (
        <p className="text-sm text-text-muted">
          {t("versions.publishedMeta", { date: format.date(content.data.updatedAt), version })}
        </p>
      ) : null}
      <PageReadView
        pageId={pageId}
        document={content.data.document}
        references={content.data.references}
        collaboration={collaboration}
      />
    </>
  );
}

function Backlinks({ pageId }: { pageId: string }) {
  const { t } = useTranslation();
  const backlinks = useQuery(backlinksQuery(pageId));
  if (!backlinks.data || backlinks.data.length === 0) return null;
  return (
    <section aria-labelledby="backlinks" className="mt-8 flex flex-col gap-2 border-t border-border pt-4">
      <h2 id="backlinks" className="font-semibold">
        {t("page.backlinks", { count: backlinks.data.length })}
      </h2>
      <ul className="flex flex-col gap-1">
        {backlinks.data.map((link) => (
          <li key={link.itemId}>
            <Link
              to={pagePath(link.spaceKey, link.itemId, itemSlug(link.title))}
              className="inline-flex min-h-hit items-center gap-2 rounded-sm text-accent hover:underline focus-visible:focus-ring"
            >
              <FileText aria-hidden="true" className="size-icon" />
              <span>{link.title}</span>
              <span className="text-sm text-text-muted">· {link.spaceName}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
