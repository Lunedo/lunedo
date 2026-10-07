import { Button, IconButton, Menu, PageHeader, SegmentedControl, Skeleton } from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRightLeft, Check, FilePlus, FileText, MoreHorizontal, Move, Pencil } from "lucide-react";
import { lazy, Suspense, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { PageReadView } from "../editor/read-view.js";
import { LoadError } from "../errors/failure.js";
import { useDocumentTitle } from "../screens/settings/settings-page.js";
import { EDIT_PAGE_EVENT } from "../shell/builtin.js";
import { InlineTitle } from "./inline-title.js";
import { itemHref, itemSlug } from "./item-paths.js";
import { PageLabels } from "./page-labels.js";
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
  const { t } = useTranslation();
  const { space, canEdit, openMove, openCreate } = useSpace();
  const search = route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const convert = useConvert();
  const editing = canEdit && search.edit === true;

  const setEditing = (next: boolean) =>
    void navigate({
      to: pagePath(space.key, page.id, itemSlug(page.title)),
      search: next ? { edit: true } : {},
      replace: true,
    });

  useEffect(() => {
    const onEdit = () => {
      if (canEdit) setEditing(true);
    };
    globalThis.addEventListener(EDIT_PAGE_EVENT, onEdit);
    return () => globalThis.removeEventListener(EDIT_PAGE_EVENT, onEdit);
  });

  const save = async (changes: { title?: string; width?: "fixed" | "full" }) => {
    await request(() =>
      api.PATCH("/api/v1/items/{itemId}", { params: { path: { itemId: page.id } }, body: changes }),
    );
    await queryClient.invalidateQueries({ queryKey: spaceKeys.item(page.id) });
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

  return (
    <article
      className={`mx-auto flex w-full flex-col gap-4 px-4 pt-6 pb-12 md:px-8 ${width === "full" ? "max-w-none" : "max-w-content"}`}
    >
      <PageHeader
        title={
          canEdit ? (
            <InlineTitle
              value={page.title}
              label={t("page.titleLabel")}
              autoFocus={editing && page.title === t("tree.untitledPage")}
              onSave={async (title) => {
                await save({ title });
                await navigate({ to: pagePath(space.key, page.id, itemSlug(title)), search, replace: true });
              }}
            />
          ) : (
            page.title
          )
        }
        icon={FileText}
        breadcrumbs={breadcrumbs}
        actions={
          <>
            {canEdit ? (
              editing ? (
                <Button variant="primary" icon={Check} onClick={() => setEditing(false)}>
                  {t("page.done")}
                </Button>
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
            {canEdit ? (
              <Menu
                trigger={<IconButton label={t("page.more")} icon={MoreHorizontal} />}
                items={[
                  {
                    label: t("tree.newPageInside"),
                    icon: FilePlus,
                    onSelect: () => openCreate("page", page.id),
                  },
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
                ]}
              />
            ) : null}
          </>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageLabels pageId={page.id} />
        {canEdit ? (
          <SegmentedControl
            label={t("page.width")}
            value={width}
            onValueChange={(value) => void save({ width: value as "fixed" | "full" })}
            options={[
              { value: "fixed", label: t("page.widthFixed") },
              { value: "full", label: t("page.widthFull") },
            ]}
          />
        ) : null}
      </div>
      {editing ? (
        <Suspense fallback={<Skeleton className="h-field w-full" />}>
          <PageEditor pageId={page.id} spaceId={space.id} spaceKey={space.key} />
        </Suspense>
      ) : (
        <PageContent pageId={page.id} />
      )}
      <Backlinks pageId={page.id} />
    </article>
  );
}

function PageContent({ pageId }: { pageId: string }) {
  const { t } = useTranslation();
  const content = useQuery(contentQuery(pageId));
  if (content.isPending) return <Skeleton className="h-field w-full" />;
  if (content.isError) {
    return (
      <LoadError what={t("page.contentFailed")} error={content.error} onRetry={() => content.refetch()} />
    );
  }
  return (
    <PageReadView pageId={pageId} document={content.data.document} references={content.data.references} />
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
