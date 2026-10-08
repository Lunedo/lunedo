import { Badge, Button, PageHeader, Skeleton } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { Check, FileText, Newspaper, Pencil } from "lucide-react";
import { lazy, Suspense, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/request.js";
import type { SaveState } from "../editor/save-state.js";
import { LoadError } from "../errors/failure.js";
import { AttachmentsSection, PageDropZone } from "../files/attachments-section.js";
import { AttachmentPreviewProvider } from "../files/preview-host.js";
import { UploadsProvider } from "../files/uploads.js";
import { useDocumentTitle } from "../screens/settings/settings-page.js";
import { draftQuery } from "../spaces/content-queries.js";
import { itemHref, itemSlug } from "../spaces/item-paths.js";
import { DraftStatusLine, PublishButton } from "../spaces/page-publishing.js";
import { PageContent } from "../spaces/page-screen.js";
import { Redirect } from "../spaces/redirect.js";
import { type ItemDetails, itemQuery, sharedPath } from "../spaces/space-queries.js";
import { NoPageAccess } from "./access-requests.js";
import { accessRoleLabel } from "./explanation.js";
import { myAccessQuery, sharedWithMeQuery } from "./sharing-api.js";

const route = getRouteApi("/app/shared/$itemId/{-$slug}");

const PageEditor = lazy(() =>
  import("../editor/page-editor.js").then((module) => ({ default: module.PageEditor })),
);

const EDITING = new Set(["editor", "admin"]);

function SharedBy({ page }: { page: ItemDetails }) {
  const { t } = useTranslation();
  const shared = useQuery({ ...sharedWithMeQuery(), throwOnError: false });
  const entry =
    shared.data?.find((candidate) => candidate.itemId === page.id) ??
    shared.data?.find(
      (candidate) =>
        candidate.includeDescendants && page.ancestors.some((ancestor) => ancestor.id === candidate.itemId),
    );
  const name = entry?.sharedBy?.name;
  return <>{name ? t("sharing.sharedPage.sharedBy", { name }) : t("sharing.sharedPage.shared")}</>;
}

function SharedPage({ page }: { page: ItemDetails }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = route.useSearch();
  const mine = useQuery({ ...myAccessQuery(page.id), throwOnError: false });
  const role = mine.data?.role ?? null;
  const canEdit = role !== null && EDITING.has(role) && !page.archived;
  const editing = canEdit && search.edit === true;
  const publishMode = page.mode === "publish";
  const saveState = useRef<SaveState>("saved");
  const draft = useQuery({ ...draftQuery(page.id), enabled: canEdit && publishMode, throwOnError: false });
  const setEditing = (next: boolean) =>
    void navigate({
      to: sharedPath(page.id, itemSlug(page.title)),
      search: next ? { edit: true } : {},
      replace: true,
    });
  const breadcrumbs = page.ancestors.map((ancestor) => ({
    label: ancestor.title,
    href: sharedPath(ancestor.id, itemSlug(ancestor.title)),
  }));
  return (
    <UploadsProvider pageId={page.id}>
      <AttachmentPreviewProvider canEdit={canEdit}>
        <PageDropZone enabled={canEdit} title={page.title}>
          <main id="main" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto outline-none">
            <article className="mx-auto flex w-full max-w-content flex-col gap-4 px-4 pt-6 pb-12 md:px-8">
              <PageHeader
                title={page.title}
                icon={page.kind === "blogPost" ? Newspaper : FileText}
                {...(breadcrumbs.length > 0 ? { breadcrumbs } : {})}
                description={<SharedBy page={page} />}
                actions={
                  <>
                    {role ? <Badge>{accessRoleLabel(t, role)}</Badge> : null}
                    {canEdit ? (
                      editing ? (
                        <>
                          <Button
                            variant={publishMode ? "secondary" : "primary"}
                            icon={Check}
                            onClick={() => setEditing(false)}
                          >
                            {t("page.done")}
                          </Button>
                          {publishMode ? (
                            <PublishButton page={page} draft={draft.data} saveState={saveState} />
                          ) : null}
                        </>
                      ) : (
                        <Button variant="primary" icon={Pencil} onClick={() => setEditing(true)}>
                          {t("page.edit")}
                        </Button>
                      )
                    ) : null}
                  </>
                }
              />
              {editing && publishMode ? <DraftStatusLine draft={draft.data} /> : null}
              {editing ? (
                <Suspense fallback={<Skeleton className="h-field w-full" />}>
                  <PageEditor
                    pageId={page.id}
                    spaceId={page.spaceId}
                    spaceKey=""
                    draft={publishMode}
                    onSaveStateChange={(state) => {
                      saveState.current = state;
                    }}
                  />
                </Suspense>
              ) : (
                <PageContent pageId={page.id} publishMode={publishMode} collaboration={{}} />
              )}
              <AttachmentsSection pageId={page.id} canEdit={canEdit} />
            </article>
          </main>
        </PageDropZone>
      </AttachmentPreviewProvider>
    </UploadsProvider>
  );
}

export function SharedPageScreen() {
  const { t } = useTranslation();
  const { itemId } = route.useParams();
  const search = route.useSearch();
  const item = useQuery({ ...itemQuery(itemId), throwOnError: false });
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
  if (page.spaceAccess && page.spaceKey) {
    const href = itemHref(page, page.spaceKey);
    if (href) return <Redirect to={href} search={search} />;
  }
  return <SharedPage key={page.id} page={page} />;
}
