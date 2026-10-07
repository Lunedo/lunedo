import { Button, Drawer, IconButton, Menu, Notice, Skeleton } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link, Outlet, useLocation, useNavigate, useParams } from "@tanstack/react-router";
import {
  FilePlus,
  Folder,
  Home,
  Link2,
  ListTree,
  MoreVertical,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Shield,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { isApiError } from "../api/request.js";
import { LoadError } from "../errors/failure.js";
import { useShell } from "../shell/shell.js";
import { itemHref } from "./item-paths.js";
import { Redirect } from "./redirect.js";
import { SpaceBadge, spaceDisplayName } from "./space-badge.js";
import { SpaceContext, type SpaceContextValue } from "./space-context.js";
import { itemQuery, type SpaceWithRole, spaceByKeyQuery } from "./space-queries.js";
import { CreateItemDialog, useCreatePage } from "./tree/create-item-dialog.js";
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
  const [, , currentKey = "", ...rest] = location.pathname.split("/");
  const urlItemId = (rest[0] === "pages" || rest[0] === "folders") && isUuid(rest[1]) ? rest[1] : null;
  const addressed = useQuery({
    ...itemQuery(urlItemId ?? ""),
    enabled: urlItemId !== null,
    retry: false,
    throwOnError: false,
  });
  const redirectByItem =
    urlItemId !== null &&
    (addressed.isPending || (addressed.data !== undefined && addressed.data.spaceKey !== currentKey));
  const resolved = useQuery({ ...spaceByKeyQuery(spaceKey), retry: false, enabled: !redirectByItem });

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
  const canEdit = space.role === "editor" || space.role === "admin";
  const [moving, setMoving] = useState<Parameters<SpaceContextValue["openMove"]>[0] | null>(null);
  const [creating, setCreating] = useState<{ kind: "folder" | "link"; parentId: string | null } | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const createPage = useCreatePage(space);
  const context = useMemo<SpaceContextValue>(
    () => ({
      space,
      canEdit,
      openMove: (item) => setMoving(item),
      openCreate: (kind, parentId) => {
        if (kind === "page") void createPage(parentId);
        else setCreating({ kind, parentId });
      },
    }),
    [space, canEdit, createPage],
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
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto outline-none">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2 md:hidden">
            <Button variant="secondary" size="sm" icon={ListTree} onClick={() => setTreeOpen(true)}>
              {t("spaces.pagesButton")}
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
      <CreateItemDialog
        space={space}
        request={creating}
        onOpenChange={(open) => !open && setCreating(null)}
      />
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
  const canEdit = space.role === "editor" || space.role === "admin";
  const name = spaceDisplayName(t, space);
  const overviewHref = space.overviewItemId
    ? itemHref({ id: space.overviewItemId, kind: "page", title: name, link: null }, space.key)
    : null;
  const settingsActive = location.pathname.startsWith(`/spaces/${space.key}/settings`);
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
        {space.role === "admin" ? (
          <Menu
            trigger={<IconButton label={t("spaces.options")} icon={MoreVertical} size="sm" />}
            items={[
              {
                label: t("spaces.settings.general"),
                icon: Settings,
                onSelect: () => shell.navigate("/spaces/$spaceKey/settings/general", { spaceKey: space.key }),
              },
              {
                label: t("spaces.settings.permissions"),
                icon: Shield,
                onSelect: () =>
                  shell.navigate("/spaces/$spaceKey/settings/permissions", { spaceKey: space.key }),
              },
            ]}
          />
        ) : null}
        <IconButton
          className="hidden md:inline-flex"
          label={t("navigation.collapseSidebar")}
          icon={PanelLeftClose}
          size="sm"
          onClick={shell.toggleSidebar}
        />
      </div>
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
      <div className="flex items-center gap-1 px-2 pt-4 pb-1">
        <h2 className="flex-1 text-xs font-semibold tracking-label text-text-muted uppercase">
          {t("tree.title")}
        </h2>
        {canEdit ? (
          <Menu
            trigger={<IconButton label={t("tree.create")} icon={Plus} size="sm" />}
            items={[
              { label: t("tree.newPage"), icon: FilePlus, onSelect: () => onCreate("page", null) },
              { label: t("tree.newFolder"), icon: Folder, onSelect: () => onCreate("folder", null) },
              { label: t("tree.newLink"), icon: Link2, onSelect: () => onCreate("link", null) },
            ]}
          />
        ) : null}
      </div>
      <PageTree space={space} currentId={currentId} ancestors={ancestors} />
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
