import { Button, IconButton, Menu, type MenuItem, Notice, Skeleton } from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link, Outlet, useLocation, useNavigate, useParams } from "@tanstack/react-router";
import {
  BookOpen,
  CalendarDays,
  ChartColumn,
  FileArchive,
  FilePlus,
  Folder,
  Layers,
  LayoutGrid,
  LayoutTemplate,
  Link2,
  MoreHorizontal,
  Newspaper,
  Plus,
  Presentation,
  Settings,
  Shield,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { isApiError } from "../api/request.js";
import { CreatePostDialog } from "../collaboration/blog/space-blog-screen.js";
import { useStar } from "../collaboration/star.js";
import { LoadError } from "../errors/failure.js";
import { SpaceExportDialog } from "../exports/space-export.js";
import { KnowledgeBaseScreen } from "../knowledge-bases/knowledge-base-screen.js";
import { PortalLink } from "../knowledge-bases/portal-link.js";
import { isKnowledgeBase } from "../knowledge-bases/queries.js";
import { ReviewNavLink } from "../knowledge-bases/reviews/home-reviews.js";
import { CreateSeriesDialog } from "../meetings/create-series-dialog.js";
import { seriesPath, spaceSeriesQuery } from "../meetings/queries.js";
import { useWatchEntries } from "../notifications/watch-menu.js";
import { NoPageAccess } from "../sharing/access-requests.js";
import { SidebarEntry } from "../shell/app-sidebar.js";
import { type CreateKind, useShell } from "../shell/shell.js";
import { SidebarContent } from "../shell/sidebar-slot.js";
import { ArchiveSection } from "./archive/archive-section.js";
import { itemHref, itemSlug } from "./item-paths.js";
import { Redirect } from "./redirect.js";
import { SidebarShortcuts } from "./shortcuts/sidebar-shortcuts.js";
import { SpaceBadge, useSpaceDisplayName } from "./space-badge.js";
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
  if (redirectByItem || resolved.isPending) return <SpaceLoading />;
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

const TREE_PLACEHOLDERS = ["w-3/4", "w-2/3", "w-4/5", "w-1/2", "w-3/5"];

function SpaceLoading() {
  const shell = useShell();
  const collapsed = shell.sidebarCollapsed && !shell.mobileSidebarOpen;
  const middle = collapsed ? (
    <Skeleton className="size-8 rounded-md" />
  ) : (
    <div aria-hidden="true" className="flex flex-col gap-2 pt-3">
      <div className="flex items-center gap-2 pb-2">
        <Skeleton className="size-8 rounded-md" />
        <div className="flex flex-1 flex-col gap-1">
          <Skeleton className="w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      {TREE_PLACEHOLDERS.map((width) => (
        <Skeleton key={width} className={`my-1 ${width}`} />
      ))}
    </div>
  );
  return (
    <>
      <SidebarContent middle={middle} bottom={null} />
      <div aria-busy="true" className="flex-1" />
    </>
  );
}

function SpaceFrame({ space }: { space: SpaceWithRole }) {
  const shell = useShell();
  const location = useLocation();
  const settingsPath = `/spaces/${space.key}/settings`;
  const inSettings = location.pathname === settingsPath || location.pathname.startsWith(`${settingsPath}/`);
  const params = useParams({ strict: false }) as { itemId?: string };
  const currentId = params.itemId ?? null;
  const current = useQuery({ ...itemQuery(currentId ?? ""), enabled: currentId !== null });
  const ancestors = useMemo(
    () => current.data?.ancestors.map((ancestor) => ancestor.id) ?? [],
    [current.data],
  );
  const canEdit = (space.role === "editor" || space.role === "admin") && !space.archived;
  const knowledgeBase = isKnowledgeBase(space);
  const [moving, setMoving] = useState<Parameters<SpaceContextValue["openMove"]>[0] | null>(null);
  const [copying, setCopying] = useState<Parameters<SpaceContextValue["openCopy"]>[0] | null>(null);
  const [creating, setCreating] = useState<{ kind: CreatedKind; parentId: string | null } | null>(null);
  const [galleryParent, setGalleryParent] = useState<string | null | undefined>(undefined);
  const [galleryTitle, setGalleryTitle] = useState("");
  const [seriesTemplate, setSeriesTemplate] = useState<string | null>(null);
  const [creatingSeries, setCreatingSeries] = useState(false);
  const [writingPost, setWritingPost] = useState(false);
  const context = useMemo<SpaceContextValue>(
    () => ({
      space,
      canEdit,
      openMove: (item) => setMoving(item),
      openCopy: (item) => setCopying(item),
      openCreate: (kind, requestedParent, title) => {
        const parentId = requestedParent ?? space.overviewItemId;
        if (kind === "page") {
          setGalleryTitle(title ?? "");
          setGalleryParent(parentId);
        } else setCreating({ kind, parentId });
      },
    }),
    [space, canEdit],
  );
  const create = useCallback(
    (kind: CreateKind, title?: string) => {
      if (kind === "blogPost") setWritingPost(true);
      else if (kind === "meeting") setCreatingSeries(true);
      else context.openCreate(kind, null, title);
    },
    [context],
  );
  const name = useSpaceDisplayName()(space);
  const kinds = useMemo<CreateKind[]>(
    () =>
      canEdit ? [...creatableKinds(space), ...(knowledgeBase ? [] : (["blogPost", "meeting"] as const))] : [],
    [canEdit, space, knowledgeBase],
  );
  const { setSpaceCreateTarget, pendingCreate, clearPendingCreate } = shell;
  useEffect(() => {
    setSpaceCreateTarget({ spaceKey: space.key, name, knowledgeBase, kinds, create });
    return () => setSpaceCreateTarget(null);
  }, [setSpaceCreateTarget, space.key, name, knowledgeBase, kinds, create]);
  const pendingHere = pendingCreate?.spaceKey === space.key ? pendingCreate.kind : null;
  useEffect(() => {
    if (!pendingHere) return;
    if (kinds.includes(pendingHere)) create(pendingHere);
    else clearPendingCreate();
  }, [pendingHere, clearPendingCreate, kinds, create]);
  const finishPending = () => {
    if (pendingHere) clearPendingCreate();
  };
  return (
    <SpaceContext value={context}>
      {inSettings ? (
        <Outlet />
      ) : (
        <>
          <SpaceNavigation
            space={space}
            currentId={currentId}
            ancestors={ancestors}
            onCreate={context.openCreate}
            collapsed={shell.sidebarCollapsed && !shell.mobileSidebarOpen}
          />
          <main
            id="main"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: the content area scrolls and must be reachable by keyboard
            tabIndex={0}
            className="min-w-0 flex-1 overflow-y-auto outline-none focus-visible:focus-ring"
          >
            <SpaceNotices space={space} />
            <Outlet />
          </main>
        </>
      )}
      <MoveDialog space={space} item={moving} onOpenChange={(open) => !open && setMoving(null)} />
      <CopyDialog space={space} item={copying} onOpenChange={(open) => !open && setCopying(null)} />
      <CreateItemDialog
        space={space}
        request={creating}
        onOpenChange={(open) => {
          if (open) return;
          setCreating(null);
          finishPending();
        }}
      />
      <TemplateGallery
        space={space}
        parentId={galleryParent}
        title={galleryTitle}
        onOpenChange={(open) => {
          if (open) return;
          setGalleryParent(undefined);
          finishPending();
        }}
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
      {creatingSeries ? (
        <CreateSeriesDialog
          space={space}
          open
          onOpenChange={(open) => {
            setCreatingSeries(open);
            if (!open) finishPending();
          }}
        />
      ) : null}
      {knowledgeBase ? null : (
        <CreatePostDialog
          open={writingPost}
          onOpenChange={(open) => {
            setWritingPost(open);
            if (!open) finishPending();
          }}
        />
      )}
    </SpaceContext>
  );
}

function SpaceNotices({ space }: { space: SpaceWithRole }) {
  const { t } = useTranslation();
  if (!space.quarantined && !space.confidential) return null;
  return (
    <div className="mx-auto flex w-full max-w-page flex-col gap-3 px-4 pt-4 md:px-8">
      {space.quarantined ? (
        <Notice variant="warning" title={t("imports.quarantine.title")}>
          {t("imports.quarantine.description")}{" "}
          {space.organizationId ? (
            <Link
              to="/settings/organizations/$organizationId/imports"
              params={{ organizationId: space.organizationId }}
              className="font-medium text-accent hover:underline focus-visible:focus-ring"
            >
              {t("imports.quarantine.open")}
            </Link>
          ) : null}
        </Notice>
      ) : null}
      {space.confidential ? (
        <Notice variant="info" title={t("confidential.badge")}>
          {t("confidential.headerNote")}
        </Notice>
      ) : null}
    </div>
  );
}

function SpaceHeader({ space, collapsed }: { space: SpaceWithRole; collapsed: boolean }) {
  const { t } = useTranslation();
  const shell = useShell();
  const name = useSpaceDisplayName()(space);
  const [exporting, setExporting] = useState(false);
  const star = useStar({ spaceId: space.id }, name);
  const watch = useWatchEntries({ type: "space", id: space.id }, name);
  const settings = (path: string) => () =>
    shell.navigate(`/spaces/$spaceKey/settings/${path}`, { spaceKey: space.key });
  const items: MenuItem[] = [
    star.menuItem,
    ...watch.items,
    { type: "separator" },
    ...(space.role === "admin"
      ? [
          { label: t("spaces.settings.general"), icon: SlidersHorizontal, onSelect: settings("general") },
          { label: t("spaces.settings.permissions"), icon: Shield, onSelect: settings("permissions") },
          { label: t("content.title"), icon: Trash2, onSelect: settings("content") },
          { label: t("templates.title"), icon: LayoutTemplate, onSelect: settings("templates") },
          { type: "separator" as const },
        ]
      : []),
    ...(space.mayExport
      ? [{ label: t("exports.space.menu"), icon: FileArchive, onSelect: () => setExporting(true) }]
      : []),
    ...(space.role === "admin"
      ? [{ label: t("spaces.settings.title"), icon: Settings, onSelect: settings("general") }]
      : []),
  ];
  while (items.at(-1)?.type === "separator") items.pop();
  if (collapsed) {
    return (
      <ul className="flex flex-col items-center gap-px pb-2">
        <SidebarEntry
          to="/spaces/$spaceKey"
          params={{ spaceKey: space.key }}
          icon={Layers}
          label={name}
          current={false}
          collapsed
        />
      </ul>
    );
  }
  return (
    <div className="sticky top-0 z-10 -mx-3 flex items-center gap-2 bg-sidebar px-3 pt-3 pb-2">
      <SpaceBadge space={space} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-semibold" title={name}>
          {name}
        </span>
        <span className="truncate text-xs text-text-muted">
          {space.personal
            ? t("spaces.personal.label")
            : isKnowledgeBase(space)
              ? t("knowledgeBase.create.knowledgeBase")
              : t("sidebar.spaceType")}
        </span>
      </div>
      <Menu
        trigger={<IconButton label={t("spaces.options")} icon={MoreHorizontal} size="sm" />}
        items={items}
      />
      {watch.dialog}
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
    </div>
  );
}

function SpaceNavigation({
  space,
  currentId,
  ancestors,
  onCreate,
  collapsed,
}: {
  space: SpaceWithRole;
  currentId: string | null;
  ancestors: readonly string[];
  onCreate: SpaceContextValue["openCreate"];
  collapsed: boolean;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const canEdit = (space.role === "editor" || space.role === "admin") && !space.archived;
  const name = useSpaceDisplayName()(space);
  const path = location.pathname.replace(/\/$/, "");
  const base = `/spaces/${space.key}`;
  const knowledgeBase = isKnowledgeBase(space);
  const overviewActive = space.overviewItemId !== null && currentId === space.overviewItemId;
  const series = useQuery({ ...spaceSeriesQuery(space.id), throwOnError: false, enabled: !knowledgeBase });
  const runningSeries = (series.data ?? []).filter((entry) => !entry.archived);
  const overviewHref = space.overviewItemId
    ? itemHref({ id: space.overviewItemId, kind: "page", title: name, link: null }, space.key)
    : null;
  const createItem = (kind: CreatableKind): MenuItem => {
    const entries = {
      page: { label: knowledgeBase ? t("knowledgeBase.newArticle") : t("tree.newPage"), icon: FilePlus },
      folder: { label: knowledgeBase ? t("knowledgeBase.newCategory") : t("tree.newFolder"), icon: Folder },
      whiteboard: { label: t("tree.newWhiteboard"), icon: Presentation },
      link: { label: t("tree.newLink"), icon: Link2 },
    } as const;
    return { ...entries[kind], onSelect: () => onCreate(kind, null) };
  };
  const listClass = collapsed ? "flex flex-col items-center gap-px" : "flex flex-col gap-px";
  const middle = (
    <>
      <SpaceHeader space={space} collapsed={collapsed} />
      <ul className={listClass}>
        {overviewHref ? (
          <SidebarEntry
            to={overviewHref}
            icon={LayoutGrid}
            label={t("spaces.overview")}
            current={overviewActive}
            collapsed={collapsed}
          />
        ) : null}
        {knowledgeBase ? (
          <>
            <SidebarEntry
              to="/spaces/$spaceKey"
              params={{ spaceKey: space.key }}
              icon={BookOpen}
              label={t("knowledgeBase.articles")}
              current={path === base}
              collapsed={collapsed}
            />
            {canEdit ? (
              <>
                <ReviewNavLink
                  spaceId={space.id}
                  spaceKey={space.key}
                  active={path === `${base}/reviews`}
                  collapsed={collapsed}
                />
                <SidebarEntry
                  to="/spaces/$spaceKey/statistics"
                  params={{ spaceKey: space.key }}
                  icon={ChartColumn}
                  label={t("statistics.title")}
                  current={path === `${base}/statistics`}
                  collapsed={collapsed}
                />
              </>
            ) : null}
          </>
        ) : (
          <>
            <SidebarEntry
              to="/spaces/$spaceKey/blog"
              params={{ spaceKey: space.key }}
              icon={Newspaper}
              label={t("blog.title")}
              current={path.startsWith(`${base}/blog`)}
              collapsed={collapsed}
            />
            <SidebarEntry
              to="/spaces/$spaceKey/meetings"
              params={{ spaceKey: space.key }}
              icon={CalendarDays}
              label={t("meetings.title")}
              current={path === `${base}/meetings`}
              collapsed={collapsed}
            />
            {!collapsed && runningSeries.length > 0 ? (
              <li>
                <ul aria-label={t("meetings.sidebar.series")} className="flex flex-col gap-px pl-6">
                  {runningSeries.map((entry) => {
                    const href = seriesPath(space.key, entry.id);
                    const active = path === href;
                    return (
                      <li key={entry.id}>
                        <Link
                          to={href}
                          aria-current={active ? "page" : undefined}
                          title={entry.title}
                          className={`flex h-row items-center rounded-sm px-2 focus-visible:focus-ring ${active ? "bg-accent font-semibold text-on-accent" : "text-text hover:bg-hover"}`}
                        >
                          <span className="truncate">{entry.title}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ) : null}
          </>
        )}
      </ul>
      {collapsed ? null : (
        <>
          {knowledgeBase ? (
            <div className="px-2 pt-2">
              <PortalLink compact />
            </div>
          ) : null}
          <SidebarShortcuts spaceId={space.id} />
          <div className="flex items-center gap-1 px-2 pt-4 pb-1">
            <h2 className="flex-1 text-2xs font-bold tracking-label text-text-muted uppercase">
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
        </>
      )}
    </>
  );
  const bottom = (
    <ul className={listClass}>
      {canEdit ? (
        <SidebarEntry
          to="/spaces/$spaceKey/trash"
          params={{ spaceKey: space.key }}
          icon={Trash2}
          label={t("trash.sidebarLink")}
          current={path === `${base}/trash`}
          collapsed={collapsed}
        />
      ) : null}
      {space.role === "admin" ? (
        <SidebarEntry
          to="/spaces/$spaceKey/settings/general"
          params={{ spaceKey: space.key }}
          icon={Settings}
          label={t("spaces.settings.title")}
          current={path.startsWith(`${base}/settings`)}
          collapsed={collapsed}
        />
      ) : null}
    </ul>
  );
  return <SidebarContent middle={middle} bottom={bottom} />;
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
