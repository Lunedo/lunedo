import { Button, Drawer, IconButton, Menu, Notice, Skeleton } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link, Outlet, useLocation, useNavigate, useParams } from "@tanstack/react-router";
import {
  BookOpen,
  ChartColumn,
  FileArchive,
  FileInput,
  FilePlus,
  Folder,
  Home,
  LayoutTemplate,
  Link2,
  ListTree,
  Lock,
  MoreVertical,
  Newspaper,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Presentation,
  Repeat,
  Settings,
  Shield,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { isApiError } from "../api/request.js";
import { StarButton } from "../collaboration/content-collaboration.js";
import { LoadError } from "../errors/failure.js";
import { SpaceExportDialog } from "../exports/space-export.js";
import { KnowledgeBaseScreen } from "../knowledge-bases/knowledge-base-screen.js";
import { PortalLink } from "../knowledge-bases/portal-link.js";
import { isKnowledgeBase } from "../knowledge-bases/queries.js";
import { ReviewNavLink } from "../knowledge-bases/reviews/home-reviews.js";
import { CreateSeriesDialog } from "../meetings/create-series-dialog.js";
import { seriesPath, spaceSeriesQuery } from "../meetings/queries.js";
import { WatchMenu } from "../notifications/watch-menu.js";
import { NoPageAccess } from "../sharing/access-requests.js";
import { useShell } from "../shell/shell.js";
import { ArchiveSection } from "./archive/archive-section.js";
import { itemHref, itemSlug } from "./item-paths.js";
import { Redirect } from "./redirect.js";
import { SidebarShortcuts } from "./shortcuts/sidebar-shortcuts.js";
import { SpaceBadge, spaceDisplayName } from "./space-badge.js";
import { SpaceContext, type SpaceContextValue } from "./space-context.js";
import { itemQuery, type SpaceWithRole, sharedPath, spaceByKeyQuery } from "./space-queries.js";
import { type CreatableKind, creatableKinds } from "./space-types.js";
import { TemplateGallery } from "./templates/template-gallery.js";
import { CopyDialog } from "./tree/copy-dialog.js";
import { type CreatedKind, CreateItemDialog } from "./tree/create-item-dialog.js";
import { MoveDialog } from "./tree/move-dialog.js";
import { PageTree } from "./tree/page-tree.js";

const route = getRouteApi("/app/spaces/$spaceKey");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string | undefined): value is string {
  return value !== undefined && UUID.test(value);
}

export function SpaceLayout() {
  const { t } = useTranslation();
  const { spaceKey } = route.useParams();
  const location = useLocation();
  const [, root, pathKey = "", ...rest] = location.pathname.split("/");
  const currentKey = root === "spaces" ? pathKey : spaceKey;
  const urlItemId =
    (rest[0] === "pages" || rest[0] === "folders" || rest[0] === "blog") && isUuid(rest[1]) ? rest[1] : null;
  const addressed = useQuery({
    ...itemQuery(urlItemId ?? ""),
    enabled: urlItemId !== null,
    retry: false,
    throwOnError: false,
  });
  const redirectByItem =
    urlItemId !== null &&
    (addressed.isPending || (addressed.data !== undefined && addressed.data.spaceKey !== currentKey));
  const resolved = useQuery({
    ...spaceByKeyQuery(spaceKey),
    retry: false,
    enabled: !redirectByItem,
    throwOnError: false,
  });

  if (redirectByItem && addressed.data && !addressed.data.spaceKey && addressed.data.kind !== "folder") {
    return (
      <Redirect to={sharedPath(addressed.data.id, itemSlug(addressed.data.title))} search={location.search} />
    );
  }
  if (redirectByItem && addressed.data) {
    return (
      <Redirect to={["", "spaces", addressed.data.spaceKey, ...rest].join("/")} search={location.search} />
    );
  }
  if (redirectByItem) {
    return (
      <div className="flex flex-1 gap-4 p-6">
        <Skeleton className="hidden h-field w-sidebar md:block" />
        <Skeleton className="h-field flex-1" />
      </div>
    );
  }
  if (resolved.isPending) {
    return (
      <div className="flex flex-1 gap-4 p-6">
        <Skeleton className="hidden h-field w-sidebar md:block" />
        <Skeleton className="h-field flex-1" />
      </div>
    );
  }
  if (resolved.isError) {
    if (isApiError(resolved.error, "notFound") && urlItemId && rest[0] !== "folders") {
      return <NoPageAccess pageId={urlItemId} />;
    }
    return (
      <main id="main" tabIndex={-1} className="flex-1 p-6 outline-none">
        {isApiError(resolved.error, "notFound") ? (
          <Notice variant="warning" title={t("spaces.notFound.title")}>
            <p>{t("spaces.notFound.description", { key: spaceKey })}</p>
            <p className="mt-2">
              <Link to="/spaces" className="text-accent underline">
                {t("spaces.notFound.back")}
              </Link>
            </p>
          </Notice>
        ) : (
          <LoadError
            what={t("spaces.loadFailed")}
            error={resolved.error}
            onRetry={() => resolved.refetch()}
          />
        )}
      </main>
    );
  }
  const space = resolved.data.space;
  if (currentKey !== space.key) {
    const target: string = ["", "spaces", space.key, ...rest].join("/");
    return <Redirect to={target} search={location.search} />;
  }
  return <SpaceFrame space={space} />;
}

function SpaceFrame({ space }: { space: SpaceWithRole }) {
  const { t } = useTranslation();
  const shell = useShell();
  const params = useParams({ strict: false }) as { itemId?: string };
  const currentId = params.itemId ?? null;
  const current = useQuery({ ...itemQuery(currentId ?? ""), enabled: currentId !== null });
  const ancestors = useMemo(
    () => current.data?.ancestors.map((ancestor) => ancestor.id) ?? [],
    [current.data],
  );
  const canEdit = (space.role === "editor" || space.role === "admin") && !space.archived;
  const [moving, setMoving] = useState<Parameters<SpaceContextValue["openMove"]>[0] | null>(null);
  const [copying, setCopying] = useState<Parameters<SpaceContextValue["openCopy"]>[0] | null>(null);
  const [creating, setCreating] = useState<{ kind: CreatedKind; parentId: string | null } | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const [galleryParent, setGalleryParent] = useState<string | null | undefined>(undefined);
  const [galleryTitle, setGalleryTitle] = useState("");
  const [seriesTemplate, setSeriesTemplate] = useState<string | null>(null);
  const context = useMemo<SpaceContextValue>(
    () => ({
      space,
      canEdit,
      openMove: (item) => setMoving(item),
      openCopy: (item) => setCopying(item),
      openCreate: (kind, parentId, title) => {
        if (kind === "page") {
          setGalleryTitle(title ?? "");
          setGalleryParent(parentId);
        } else setCreating({ kind, parentId });
      },
    }),
    [space, canEdit],
  );
  const navigation = (
    <SpaceNavigation
      space={space}
      currentId={currentId}
      ancestors={ancestors}
      onCreate={context.openCreate}
      onNavigate={() => setTreeOpen(false)}
    />
  );
  return (
    <SpaceContext value={context}>
      <div className="flex min-w-0 flex-1">
        {shell.sidebarCollapsed ? null : (
          <nav
            aria-label={t("spaces.navigation", { space: spaceDisplayName(t, space) })}
            className="hidden w-sidebar shrink-0 flex-col overflow-y-auto border-r border-border bg-sidebar md:flex"
          >
            {navigation}
          </nav>
        )}
        <main
          id="main"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the content area scrolls and must be reachable by keyboard
          tabIndex={0}
          className="min-w-0 flex-1 overflow-y-auto outline-none focus-visible:focus-ring"
        >
          <div className="flex items-center gap-2 border-b border-border px-4 py-2 md:hidden">
            <Button variant="secondary" size="sm" icon={ListTree} onClick={() => setTreeOpen(true)}>
              {isKnowledgeBase(space) ? t("spaces.articlesButton") : t("spaces.pagesButton")}
            </Button>
            <span className="min-w-0 flex-1 truncate text-sm text-text-muted">
              {spaceDisplayName(t, space)}
            </span>
          </div>
          {shell.sidebarCollapsed ? (
            <div className="hidden px-4 pt-3 md:block">
              <IconButton
                label={t("navigation.expandSidebar")}
                icon={PanelLeftOpen}
                onClick={shell.toggleSidebar}
              />
            </div>
          ) : null}
          <Outlet />
        </main>
      </div>
      <Drawer open={treeOpen} onOpenChange={setTreeOpen} title={spaceDisplayName(t, space)} side="left">
        {navigation}
      </Drawer>
      <MoveDialog space={space} item={moving} onOpenChange={(open) => !open && setMoving(null)} />
      <CopyDialog space={space} item={copying} onOpenChange={(open) => !open && setCopying(null)} />
      <CreateItemDialog
        space={space}
        request={creating}
        onOpenChange={(open) => !open && setCreating(null)}
      />
      <TemplateGallery
        space={space}
        parentId={galleryParent}
        title={galleryTitle}
        onOpenChange={(open) => !open && setGalleryParent(undefined)}
        onSeriesTemplate={setSeriesTemplate}
      />
      {seriesTemplate ? (
        <CreateSeriesDialog
          space={space}
          open
          initialTemplateId={seriesTemplate}
          onOpenChange={(open) => !open && setSeriesTemplate(null)}
        />
      ) : null}
    </SpaceContext>
  );
}

function SpaceNavigation({
  space,
  currentId,
  ancestors,
  onCreate,
  onNavigate,
}: {
  space: SpaceWithRole;
  currentId: string | null;
  ancestors: readonly string[];
  onCreate: SpaceContextValue["openCreate"];
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const shell = useShell();
  const location = useLocation();
  const canEdit = (space.role === "editor" || space.role === "admin") && !space.archived;
  const name = spaceDisplayName(t, space);
  const overviewHref = space.overviewItemId
    ? itemHref({ id: space.overviewItemId, kind: "page", title: name, link: null }, space.key)
    : null;
  const settingsActive = location.pathname.startsWith(`/spaces/${space.key}/settings`);
  const trashActive = location.pathname === `/spaces/${space.key}/trash`;
  const blogActive = location.pathname.startsWith(`/spaces/${space.key}/blog`);
  const meetingsActive = location.pathname === `/spaces/${space.key}/meetings`;
  const knowledgeBase = isKnowledgeBase(space);
  const articlesActive = knowledgeBase && location.pathname.replace(/\/$/, "") === `/spaces/${space.key}`;
  const reviewsActive = location.pathname === `/spaces/${space.key}/reviews`;
  const statisticsActive = location.pathname === `/spaces/${space.key}/statistics`;
  const series = useQuery({ ...spaceSeriesQuery(space.id), throwOnError: false, enabled: !knowledgeBase });
  const runningSeries = (series.data ?? []).filter((entry) => !entry.archived);
  const [exporting, setExporting] = useState(false);
  const createItem = (kind: CreatableKind) => {
    const entries = {
      page: { label: knowledgeBase ? t("knowledgeBase.newArticle") : t("tree.newPage"), icon: FilePlus },
      folder: { label: knowledgeBase ? t("knowledgeBase.newCategory") : t("tree.newFolder"), icon: Folder },
      whiteboard: { label: t("tree.newWhiteboard"), icon: Presentation },
      link: { label: t("tree.newLink"), icon: Link2 },
    } as const;
    return { ...entries[kind], onSelect: () => onCreate(kind, null) };
  };
  return (
    <div
      className="flex flex-col gap-1 px-2 py-4"
      onClickCapture={(event) => {
        if ((event.target as HTMLElement).closest("a")) onNavigate();
      }}
    >
      <div className="flex items-center gap-2 px-2 pb-2">
        <SpaceBadge space={space} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-semibold" title={name}>
            {name}
          </span>
          <span className="truncate text-xs text-text-muted">
            {space.personal
              ? t("spaces.personal.label")
              : t("spaces.inOrganization", { organization: space.organizationName ?? "" })}
          </span>
        </div>
        <Menu
          trigger={<IconButton label={t("spaces.options")} icon={MoreVertical} size="sm" />}
          items={[
            ...(space.role === "admin"
              ? [
                  {
                    label: t("spaces.settings.general"),
                    icon: Settings,
                    onSelect: () =>
                      shell.navigate("/spaces/$spaceKey/settings/general", { spaceKey: space.key }),
                  },
                  {
                    label: t("spaces.settings.permissions"),
                    icon: Shield,
                    onSelect: () =>
                      shell.navigate("/spaces/$spaceKey/settings/permissions", { spaceKey: space.key }),
                  },
                  {
                    label: t("content.title"),
                    icon: Trash2,
                    onSelect: () =>
                      shell.navigate("/spaces/$spaceKey/settings/content", { spaceKey: space.key }),
                  },
                  {
                    label: t("templates.title"),
                    icon: LayoutTemplate,
                    onSelect: () =>
                      shell.navigate("/spaces/$spaceKey/settings/templates", { spaceKey: space.key }),
                  },
                  { type: "separator" as const },
                ]
              : []),
            ...(space.mayExport
              ? [{ label: t("exports.space.menu"), icon: FileArchive, onSelect: () => setExporting(true) }]
              : []),
          ]}
        />
        <SpaceExportDialog
          space={{
            id: space.id,
            key: space.key,
            name,
            exportEnabled: space.exportEnabled,
            admin: space.role === "admin",
            knowledgeBase: isKnowledgeBase(space),
          }}
          open={exporting}
          onOpenChange={setExporting}
        />
        <StarButton target={{ spaceId: space.id }} title={name} />
        <WatchMenu target={{ type: "space", id: space.id }} name={name} />
        <IconButton
          className="hidden md:inline-flex"
          label={t("navigation.collapseSidebar")}
          icon={PanelLeftClose}
          size="sm"
          onClick={shell.toggleSidebar}
        />
      </div>
      {space.quarantined ? (
        <div className="mx-2 mb-2 flex items-start gap-2 rounded-sm bg-warning-soft px-2 py-1 text-xs">
          <FileInput aria-hidden="true" className="size-icon-sm shrink-0" />
          <span className="flex flex-col gap-1">
            <span>
              <span className="font-semibold">{t("imports.quarantine.title")}</span> ·{" "}
              {t("imports.quarantine.description")}
            </span>
            {space.organizationId ? (
              <Link
                to="/settings/organizations/$organizationId/imports"
                params={{ organizationId: space.organizationId }}
                className="font-medium text-accent hover:underline focus-visible:focus-ring"
              >
                {t("imports.quarantine.open")}
              </Link>
            ) : null}
          </span>
        </div>
      ) : null}
      {space.confidential ? (
        <p className="mx-2 mb-2 flex items-start gap-2 rounded-sm bg-accent-soft px-2 py-1 text-xs">
          <Lock aria-hidden="true" className="size-icon-sm shrink-0" />
          <span>
            <span className="font-semibold">{t("confidential.badge")}</span> · {t("confidential.headerNote")}
          </span>
        </p>
      ) : null}
      <ul className="flex flex-col gap-px">
        {overviewHref ? (
          <li>
            <Link
              to={overviewHref}
              className="flex h-row items-center gap-2 rounded-sm px-2 hover:bg-hover focus-visible:focus-ring"
            >
              <Home aria-hidden="true" className="size-icon text-text-muted" />
              {t("spaces.overview")}
            </Link>
          </li>
        ) : null}
        {knowledgeBase ? (
          <li className="flex flex-col gap-2">
            <Link
              to="/spaces/$spaceKey"
              params={{ spaceKey: space.key }}
              aria-current={articlesActive ? "page" : undefined}
              className={`flex h-row items-center gap-2 rounded-sm px-2 focus-visible:focus-ring ${articlesActive ? "bg-selected font-semibold text-selected-text" : "hover:bg-hover"}`}
            >
              <BookOpen aria-hidden="true" className="size-icon text-text-muted" />
              {t("knowledgeBase.articles")}
            </Link>
            {canEdit ? (
              <>
                <ReviewNavLink spaceId={space.id} spaceKey={space.key} active={reviewsActive} />
                <Link
                  to="/spaces/$spaceKey/statistics"
                  params={{ spaceKey: space.key }}
                  aria-current={statisticsActive ? "page" : undefined}
                  className={`flex h-row items-center gap-2 rounded-sm px-2 focus-visible:focus-ring ${statisticsActive ? "bg-selected font-semibold text-selected-text" : "hover:bg-hover"}`}
                >
                  <ChartColumn aria-hidden="true" className="size-icon text-text-muted" />
                  <span className="min-w-0 flex-1 truncate">{t("statistics.title")}</span>
                </Link>
              </>
            ) : null}
            <span className="px-2">
              <PortalLink compact />
            </span>
          </li>
        ) : null}
        {knowledgeBase ? null : (
          <>
            <li>
              <Link
                to="/spaces/$spaceKey/blog"
                params={{ spaceKey: space.key }}
                aria-current={blogActive ? "page" : undefined}
                className={`flex h-row items-center gap-2 rounded-sm px-2 focus-visible:focus-ring ${blogActive ? "bg-selected font-semibold text-selected-text" : "hover:bg-hover"}`}
              >
                <Newspaper aria-hidden="true" className="size-icon text-text-muted" />
                {t("blog.title")}
              </Link>
            </li>
            <li>
              <Link
                to="/spaces/$spaceKey/meetings"
                params={{ spaceKey: space.key }}
                aria-current={meetingsActive ? "page" : undefined}
                className={`flex h-row items-center gap-2 rounded-sm px-2 focus-visible:focus-ring ${meetingsActive ? "bg-selected font-semibold text-selected-text" : "hover:bg-hover"}`}
              >
                <Repeat aria-hidden="true" className="size-icon text-text-muted" />
                {t("meetings.title")}
              </Link>
              {runningSeries.length > 0 ? (
                <ul aria-label={t("meetings.sidebar.series")} className="flex flex-col gap-px pl-6">
                  {runningSeries.map((entry) => {
                    const href = seriesPath(space.key, entry.id);
                    const active = location.pathname === href;
                    return (
                      <li key={entry.id}>
                        <Link
                          to={href}
                          aria-current={active ? "page" : undefined}
                          title={entry.title}
                          className={`flex h-row items-center rounded-sm px-2 text-sm focus-visible:focus-ring ${active ? "bg-selected font-semibold text-selected-text" : "hover:bg-hover"}`}
                        >
                          <span className="truncate">{entry.title}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          </>
        )}
        {canEdit ? (
          <li>
            <Link
              to="/spaces/$spaceKey/trash"
              params={{ spaceKey: space.key }}
              aria-current={trashActive ? "page" : undefined}
              className={`flex h-row items-center gap-2 rounded-sm px-2 focus-visible:focus-ring ${trashActive ? "bg-selected font-semibold text-selected-text" : "hover:bg-hover"}`}
            >
              <Trash2 aria-hidden="true" className="size-icon text-text-muted" />
              {t("trash.sidebarLink")}
            </Link>
          </li>
        ) : null}
        {space.role === "admin" ? (
          <li>
            <Link
              to="/spaces/$spaceKey/settings/general"
              params={{ spaceKey: space.key }}
              aria-current={settingsActive ? "page" : undefined}
              className={`flex h-row items-center gap-2 rounded-sm px-2 focus-visible:focus-ring ${settingsActive ? "bg-selected font-semibold text-selected-text" : "hover:bg-hover"}`}
            >
              <Settings aria-hidden="true" className="size-icon text-text-muted" />
              {t("spaces.settings.title")}
            </Link>
          </li>
        ) : null}
      </ul>
      <SidebarShortcuts spaceId={space.id} />
      <div className="flex items-center gap-1 px-2 pt-4 pb-1">
        <h2 className="flex-1 text-xs font-semibold tracking-label text-text-muted uppercase">
          {knowledgeBase ? t("knowledgeBase.treeTitle") : t("tree.title")}
        </h2>
        {canEdit ? (
          <Menu
            trigger={<IconButton label={t("tree.create")} icon={Plus} size="sm" />}
            items={creatableKinds(space).map((kind) => createItem(kind))}
          />
        ) : null}
      </div>
      <PageTree space={space} currentId={currentId} ancestors={ancestors} />
      <ArchiveSection space={space} currentId={currentId} />
    </div>
  );
}

export function SpaceOverviewRedirect() {
  const { t } = useTranslation();
  const { spaceKey } = route.useParams();
  const navigate = useNavigate();
  const resolved = useQuery(spaceByKeyQuery(spaceKey));
  const space = resolved.data?.space;
  if (!space) return <Skeleton className="m-6 h-field" />;
  if (isKnowledgeBase(space)) return <KnowledgeBaseScreen />;
  if (space.overviewItemId) {
    const href = itemHref(
      { id: space.overviewItemId, kind: "page", title: space.name || t("spaces.overview"), link: null },
      space.key,
    );
    if (href) return <Redirect to={href} />;
  }
  return (
    <div className="p-6">
      <Notice variant="info" title={t("spaces.noOverview.title")}>
        <p>{t("spaces.noOverview.description")}</p>
        <Button className="mt-2" variant="secondary" onClick={() => void navigate({ to: "/spaces" })}>
          {t("spaces.notFound.back")}
        </Button>
      </Notice>
    </div>
  );
}
