import {
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Menu,
  type MenuItem,
  Notice,
  PageHeader,
  Skeleton,
  useToast,
} from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import {
  Archive,
  ArchiveRestore,
  ArrowRightLeft,
  Copy,
  FileCheck,
  FileDown,
  FilePen,
  FilePlus,
  FileText,
  History,
  Languages,
  LayoutTemplate,
  Link2,
  ListOrdered,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Move,
  NotebookPen,
  Pencil,
  Radio,
  Trash2,
  Undo2,
  UserPlus,
} from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { ApiError, request } from "../api/request.js";
import { StarredMark, useContentCollaboration, useStar } from "../collaboration/content-collaboration.js";
import { PageReactions } from "../collaboration/reaction-bar.js";
import { isEmptyDocument } from "../editor/empty-document.js";
import type { MissingSection } from "../editor/extensions/required-sections.js";
import type { PresenceUser } from "../editor/presence.js";
import { PageReadView, type ReadViewCollaboration } from "../editor/read-view.js";
import { CollaborationProblemNotice } from "../editor/save-indicator.js";
import type { SaveState } from "../editor/save-state.js";
import { LoadError } from "../errors/failure.js";
import { ExportDialog } from "../exports/export-dialog.js";
import { AttachmentsSection, PageDropZone } from "../files/attachments-section.js";
import { AttachmentPreviewProvider } from "../files/preview-host.js";
import { UploadsProvider } from "../files/uploads.js";
import { ArticlePortalLink } from "../knowledge-bases/portal-link.js";
import { isKnowledgeBase } from "../knowledge-bases/queries.js";
import { ArticleReviewLine } from "../knowledge-bases/reviews/article-review.js";
import { MeetingHeader } from "../meetings/meeting-header.js";
import { PrivateNotesPanel } from "../meetings/private-notes-panel.js";
import { useWatchEntries } from "../notifications/watch-menu.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { useDocumentTitle } from "../screens/settings/settings-page.js";
import { NoPageAccess } from "../sharing/access-requests.js";
import { type PageSharing, usePageSharing } from "../sharing/page-sharing.js";
import { EDIT_PAGE_EVENT } from "../shell/builtin.js";
import { useArchiveItem, useDeleteItem, useDiscardDraft } from "./content-actions.js";
import { ContentLanguageDialog } from "./content-language-dialog.js";
import { draftQuery } from "./content-queries.js";
import { EditorBar } from "./editor-bar.js";
import { InlineTitle } from "./inline-title.js";
import { itemHref, itemSlug } from "./item-paths.js";
import { EditInfo, PageBar } from "./page-bar.js";
import { PageEditors } from "./page-editors.js";
import { usePageMeta } from "./page-meta.js";
import {
  DraftToggle,
  type DraftViewMode,
  ModeSwitchDialog,
  PublishButton,
  useModeSwitch,
} from "./page-publishing.js";
import { Redirect } from "./redirect.js";
import { spaceDisplayName } from "./space-badge.js";
import { useSpace } from "./space-context.js";
import { SpaceNews } from "./space-news.js";
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
import { DraftChanges } from "./versions/diff-view.js";

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
  const search = route.useSearch();
  const sharing = usePageSharing(
    {
      id: page.id,
      title: page.title,
      spaceId: space.id,
      organizationId: space.organizationId,
      organizationName: space.organizationName,
      confidential: space.confidential,
      viewRestriction: page.viewRestriction,
      editRestricted: page.editRestricted,
      spaceRole: space.role,
    },
    true,
  );
  const mayEdit = canEdit && sharing.canEditPage !== false;
  const writable = mayEdit && !page.archived && !space.archived;
  const lostEdit = useLostEditPermission(mayEdit, search.edit === true);
  return (
    <UploadsProvider pageId={page.id}>
      <AttachmentPreviewProvider canEdit={writable} requested={search.attachment}>
        <PageDropZone enabled={writable} title={page.title}>
          <PageArticle page={page} sharing={sharing} lostEdit={lostEdit} />
        </PageDropZone>
      </AttachmentPreviewProvider>
    </UploadsProvider>
  );
}

function PageArticle({
  page,
  sharing,
  lostEdit,
}: {
  page: ItemDetails;
  sharing: PageSharing;
  lostEdit: boolean;
}) {
  const { t } = useTranslation();
  const { space, canEdit, openMove, openCopy, openCreate } = useSpace();
  const search = route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const convert = useConvert();
  const deleteItem = useDeleteItem(space);
  const { archive, unarchive } = useArchiveItem();
  const discard = useDiscardDraft();
  const { toast } = useToast();
  const [draftView, setDraftView] = useState<DraftViewMode>("published");
  const writable = canEdit && sharing.canEditPage !== false && !page.archived && !space.archived;
  const editing = writable && search.edit === true;
  const meeting = page.ancestors.at(-1)?.kind === "meetingSeries";
  const [notesOpen, setNotesOpen] = useState(meeting && search.notes === true);
  const notesToggle = useRef<HTMLButtonElement>(null);
  const publishMode = page.mode === "publish";
  const knowledgeBase = isKnowledgeBase(space);
  const [missingSections, setMissingSections] = useState<MissingSection[]>([]);
  const draft = useQuery({ ...draftQuery(page.id), enabled: writable && publishMode, throwOnError: false });
  const saveState = useRef<SaveState>("saved");
  const [shownSaveState, setShownSaveState] = useState<SaveState>("saved");
  const [coEditors, setCoEditors] = useState<PresenceUser[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  const [confirmingLive, setConfirmingLive] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [choosingLanguage, setChoosingLanguage] = useState(false);
  const switchMode = useModeSwitch(page, draft.data, () => setConfirmingLive(true));
  const title = writable && publishMode && draft.data ? draft.data.title : page.title;
  const collaboration = useContentCollaboration({
    itemId: page.id,
    spaceId: space.id,
    role: space.role,
    archived: page.archived || space.archived,
    writable,
    layout: "inline",
    highlight: search.comment ?? null,
  });

  const setEditing = (next: boolean) =>
    void navigate({
      to: pagePath(space.key, page.id, itemSlug(page.title)),
      search: next ? { edit: true } : {},
      replace: true,
    });

  useEffect(() => {
    if (!editing) setPreviewing(false);
  }, [editing]);

  useEffect(() => {
    const onEdit = () => {
      if (writable) setEditing(true);
    };
    globalThis.addEventListener(EDIT_PAGE_EVENT, onEdit);
    return () => globalThis.removeEventListener(EDIT_PAGE_EVENT, onEdit);
  });

  const save = async (changes: { title?: string; width?: "fixed" | "full"; numberHeadings?: boolean }) => {
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

  const star = useStar({ itemId: page.id }, title);
  const watch = useWatchEntries({ type: "item", id: page.id }, title);
  const meta = usePageMeta({ page, writable });
  const copyLink = async () => {
    const url = new URL(pagePath(space.key, page.id, itemSlug(page.title)), globalThis.location.origin);
    try {
      await navigator.clipboard.writeText(url.toString());
      toast({ title: t("page.linkCopied") });
    } catch {
      toast({
        variant: "error",
        title: t("page.linkCopyFailed"),
        description: t("page.copyManually", { url: url.toString() }),
      });
    }
  };
  const menuItems: MenuItem[] = [
    star.menuItem,
    ...watch.items,
    { type: "separator" },
    { label: t("versions.history"), icon: History, onSelect: openHistory },
    ...meta.menuItems,
    { type: "separator" },
  ];
  if (writable && !meeting && !knowledgeBase) {
    menuItems.push({
      label: t("tree.newPageInside"),
      icon: FilePlus,
      onSelect: () => openCreate("page", page.id),
    });
  }
  if (!meeting && page.kind === "page") {
    menuItems.push({ label: t("tree.copy"), icon: Copy, onSelect: () => openCopy(page) });
  }
  if (writable && !meeting) {
    menuItems.push({ label: t("tree.move"), icon: Move, onSelect: () => openMove(page) });
  }
  menuItems.push(
    { label: t("exports.page.menu"), icon: FileDown, onSelect: () => setExporting(true) },
    { label: t("page.copyLink"), icon: Link2, onSelect: () => void copyLink() },
  );
  if (writable) {
    menuItems.push(
      { type: "separator" },
      ...(overview || meeting || knowledgeBase
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
      {
        label: page.numberHeadings ? t("page.stopNumberingHeadings") : t("page.numberHeadings"),
        icon: ListOrdered,
        onSelect: () => void save({ numberHeadings: !page.numberHeadings }),
      },
      ...(knowledgeBase
        ? []
        : [
            {
              label: publishMode ? t("versions.switchToLive") : t("versions.switchToPublish"),
              icon: publishMode ? Radio : FileCheck,
              onSelect: () => void switchMode(),
            },
            {
              label: t("contentLanguage.menu"),
              icon: Languages,
              onSelect: () => setChoosingLanguage(true),
            },
          ]),
      {
        label: t("templates.saveAsTemplate"),
        icon: LayoutTemplate,
        onSelect: () => setSavingTemplate(true),
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
    );
  }
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
  const showingDraft =
    writable &&
    publishMode &&
    draftView === "draft" &&
    draft.data?.hasChanges === true &&
    draft.data.basedOn !== null;

  const discardable = publishMode && draft.data?.hasChanges === true && draft.data.basedOn !== null;
  const editorMenuItems: MenuItem[] = [
    { label: t("versions.history"), icon: History, onSelect: openHistory },
    ...(sharing.open ? [{ label: t("sharing.share"), icon: UserPlus, onSelect: sharing.open }] : []),
  ];
  const editorDangerItems: MenuItem[] = [
    ...(discardable
      ? [
          { type: "separator" as const },
          {
            label: t("versions.discardDraft"),
            icon: Undo2,
            danger: true,
            onSelect: () => setConfirmingDiscard(true),
          },
        ]
      : []),
  ];
  const preview = async () => {
    if (previewing) {
      setPreviewing(false);
      return;
    }
    await queryClient.refetchQueries({
      queryKey: publishMode ? ["items", page.id, "draft"] : spaceKeys.content(page.id),
    });
    setPreviewing(true);
  };
  const notesButton = meeting ? (
    <IconButton
      ref={notesToggle}
      label={t("meetings.notes.toggle")}
      icon={NotebookPen}
      aria-pressed={notesOpen}
      aria-expanded={notesOpen}
      onClick={() => setNotesOpen(!notesOpen)}
    />
  ) : null;

  const pageActions = (
    <>
      {writable ? (
        showingDraft ? (
          <>
            <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)} aria-keyshortcuts="E">
              {t("versions.continueEditing")}
            </Button>
            <PublishButton page={page} draft={draft.data} saveState={saveState} article={knowledgeBase} />
          </>
        ) : (
          <Button variant="primary" icon={Pencil} onClick={() => setEditing(true)} aria-keyshortcuts="E">
            {t("page.edit")}
          </Button>
        )
      ) : null}
      {sharing.shareButton}
      {notesButton}
      <Menu trigger={<IconButton label={t("page.more")} icon={MoreHorizontal} />} items={menuItems} />
      {watch.dialog}
    </>
  );

  return (
    <div className="flex min-h-full flex-col">
      {editing ? (
        <EditorBar
          breadcrumbs={breadcrumbs}
          draft={publishMode}
          saveState={shownSaveState}
          others={coEditors}
          previewing={previewing}
          onPreview={() => void preview()}
          onClose={() => setEditing(false)}
          primary={
            publishMode ? (
              <PublishButton
                page={page}
                draft={draft.data}
                saveState={saveState}
                onMissingSections={setMissingSections}
                article={knowledgeBase}
              />
            ) : null
          }
          extra={notesButton}
          menuItems={editorMenuItems}
          dangerItems={editorDangerItems}
          toolbarRef={setToolbarHost}
        />
      ) : (
        <PageBar breadcrumbs={breadcrumbs}>
          {writable && publishMode ? (
            <DraftToggle draft={draft.data} view={draftView} onViewChange={setDraftView} />
          ) : null}
          <PageEditors pageId={page.id} />
          <EditInfo pageId={page.id} editedAt={page.contentUpdatedAt} onOpen={openHistory} />
          {pageActions}
        </PageBar>
      )}
      <div className="flex flex-1">
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
            status={<StarredMark target={{ itemId: page.id }} />}
          />
          {editing ? knowledgeBase ? <ArticlePortalLink itemId={page.id} /> : null : meta.line}
          {knowledgeBase ? (
            <ArticleReviewLine
              itemId={page.id}
              title={page.title}
              editable={writable}
              published={page.published}
            />
          ) : null}
          {sharing.restrictionNote}
          {editing && missingSections.length > 0 ? (
            <Notice variant="warning" title={t("knowledgeBase.required.title")}>
              {t("knowledgeBase.required.description", {
                count: missingSections.length,
                sections: missingSections.map((section) => section.title).join(", "),
              })}
            </Notice>
          ) : null}
          {meeting ? (
            <MeetingHeader
              meetingId={page.id}
              spaceKey={space.key}
              writable={writable}
              onShare={sharing.open}
            />
          ) : null}
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
          {writable && publishMode && !editing && !page.published && draft.data?.hasChanges ? (
            <Notice variant="info" title={t("versions.notPublishedTitle")}>
              {t("versions.notPublishedDescription")}
            </Notice>
          ) : null}
          {lostEdit ? <CollaborationProblemNotice problem="permissionRevoked" /> : null}
          {editing && previewing ? (
            publishMode && draft.data ? (
              <PageReadView
                pageId={page.id}
                document={draft.data.document}
                references={draft.data.references}
                numberHeadings={page.numberHeadings}
              />
            ) : publishMode ? null : (
              <PageContent
                pageId={page.id}
                publishMode={false}
                meta={false}
                numberHeadings={page.numberHeadings}
                collaboration={{}}
              />
            )
          ) : null}
          {editing ? (
            <div hidden={previewing}>
              <Suspense fallback={<Skeleton className="h-field w-full" />}>
                <PageEditor
                  pageId={page.id}
                  spaceId={space.id}
                  spaceKey={space.key}
                  draft={publishMode}
                  numberHeadings={page.numberHeadings}
                  missingSections={missingSections}
                  showStatus={false}
                  toolbarContainer={toolbarHost}
                  onPresenceChange={setCoEditors}
                  onSaveStateChange={(state) => {
                    saveState.current = state;
                    setShownSaveState(state);
                  }}
                  {...collaboration.editor}
                />
              </Suspense>
            </div>
          ) : writable && publishMode && !page.published ? (
            draft.data?.hasChanges === false ? (
              <EmptyPage onEdit={() => setEditing(true)} />
            ) : draft.data ? (
              <PageReadView
                pageId={page.id}
                document={draft.data.document}
                references={draft.data.references}
                numberHeadings={page.numberHeadings}
              />
            ) : null
          ) : showingDraft && draft.data?.basedOn ? (
            <DraftChanges pageId={page.id} basedOn={draft.data.basedOn} />
          ) : (
            <PageContent
              pageId={page.id}
              publishMode={publishMode}
              meta={false}
              numberHeadings={page.numberHeadings}
              collaboration={collaboration.readView}
              {...(writable ? { onEdit: () => setEditing(true) } : {})}
            />
          )}
          {overview && !editing && space.organizationId ? (
            <SpaceNews organizationId={space.organizationId} spaceId={space.id} overviewId={page.id} />
          ) : null}
          {editing ? null : (
            <>
              <PageReactions itemId={page.id} canReact={!page.archived && !space.archived} />
              <Backlinks pageId={page.id} />
              <AttachmentsSection pageId={page.id} canEdit={writable} />
              {collaboration.section}
            </>
          )}
          {collaboration.popover}
          {meta.dialogs}
          <ConfirmDialog
            open={confirmingDiscard}
            onOpenChange={setConfirmingDiscard}
            title={t("versions.discardTitle")}
            description={t("versions.discardConfirm", {
              count: draft.data?.changes ?? 0,
              version: draft.data?.basedOn ?? 0,
            })}
            confirmLabel={t("versions.discardDraft")}
            cancelLabel={t("versions.keepDraft")}
            destructive
            onConfirm={async () => {
              await discard(page, draft.data?.basedOn ?? null);
              setEditing(false);
            }}
          />
          <ModeSwitchDialog
            page={page}
            draft={draft.data}
            open={confirmingLive}
            onOpenChange={setConfirmingLive}
          />
          {sharing.dialog}
          <ExportDialog
            page={{ id: page.id, title, publishable: !publishMode || page.published }}
            space={{
              id: space.id,
              key: space.key,
              name: space.name,
              exportEnabled: space.exportEnabled,
              admin: space.role === "admin",
              mayExportPages: space.mayExport,
            }}
            open={exporting}
            onOpenChange={setExporting}
          />
          <SaveTemplateDialog
            spaceId={space.id}
            spaceName={spaceDisplayName(t, space)}
            page={{ id: page.id, title }}
            open={savingTemplate}
            onOpenChange={setSavingTemplate}
          />
          {choosingLanguage ? (
            <ContentLanguageDialog page={page} open={choosingLanguage} onOpenChange={setChoosingLanguage} />
          ) : null}
        </article>
        {notesOpen ? (
          <div className="fixed inset-0 z-40 flex bg-surface md:sticky md:top-0 md:inset-auto md:z-auto md:h-dvh md:self-start">
            <PrivateNotesPanel
              meetingId={page.id}
              canCopy={writable}
              onClose={() => {
                setNotesOpen(false);
                notesToggle.current?.focus();
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function useLostEditPermission(mayEdit: boolean, editRequested: boolean): boolean {
  const [held, setHeld] = useState(mayEdit);
  if (mayEdit && !held) setHeld(true);
  return held && !mayEdit && editRequested;
}

function EmptyPage({ onEdit }: { onEdit?: () => void }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={FilePen}
      title={t("page.emptyTitle")}
      description={onEdit ? t("page.emptyDescription") : t("page.emptyReadOnly")}
      {...(onEdit
        ? {
            action: (
              <Button variant="primary" icon={Pencil} onClick={onEdit}>
                {t("page.startWriting")}
              </Button>
            ),
          }
        : {})}
    />
  );
}

export function PageContent({
  pageId,
  publishMode,
  collaboration,
  onEdit,
  numberHeadings = false,
  meta = true,
}: {
  pageId: string;
  publishMode: boolean;
  numberHeadings?: boolean;
  collaboration: ReadViewCollaboration;
  onEdit?: () => void;
  meta?: boolean;
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
  if (isEmptyDocument(content.data.document)) {
    return <EmptyPage {...(onEdit ? { onEdit } : {})} />;
  }
  return (
    <>
      {meta && publishMode && version !== null ? (
        <p className="text-sm text-text-muted">
          {t("versions.publishedMeta", { date: format.date(content.data.updatedAt), version })}
        </p>
      ) : null}
      <PageReadView
        pageId={pageId}
        document={content.data.document}
        references={content.data.references}
        collaboration={collaboration}
        numberHeadings={numberHeadings}
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
              <FileText aria-hidden="true" className="size-icon-md" />
              <span>{link.title}</span>
              <span className="text-sm text-text-muted">· {link.spaceName}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
