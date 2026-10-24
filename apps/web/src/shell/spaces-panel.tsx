import { Button, Icon, IconButton, Input, RailButton, SidebarItem, Skeleton } from "@lunedo/ui";
import { useInfiniteQuery, useQueries, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Layers, Plus, Search, X } from "lucide-react";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { StarButton } from "../collaboration/content-collaboration.js";
import { starredQuery } from "../collaboration/queries.js";
import { useDebounced } from "../components/table-state.js";
import { LoadError } from "../errors/failure.js";
import { isKnowledgeBase } from "../knowledge-bases/queries.js";
import { recentlyViewedQuery } from "../search/search-api.js";
import { CreateSpaceDialog } from "../spaces/create-space-dialog.js";
import { SpaceBadge } from "../spaces/space-badge.js";
import { spaceByKeyQuery, spaceKeys } from "../spaces/space-queries.js";
import { useOrganizationState } from "./shell-context.js";

const PAGE_SIZE = 30;
const RECENT_SHOWN = 7;
const WIDE_QUERY = "(min-width: 48rem)";

interface PanelSpace {
  id: string;
  key: string;
  name: string;
  personal: boolean;
  type: string | null;
}

function useWide(): boolean {
  const [wide, setWide] = useState(() => globalThis.matchMedia?.(WIDE_QUERY).matches ?? true);
  useEffect(() => {
    const query = globalThis.matchMedia?.(WIDE_QUERY);
    if (!query) return;
    const change = () => setWide(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  return wide;
}

function matches(space: PanelSpace, text: string): boolean {
  if (!text) return true;
  const needle = text.toLowerCase();
  return space.name.toLowerCase().includes(needle) || space.key.toLowerCase().includes(needle);
}

export function SpacesEntry({
  collapsed,
  open,
  onToggle,
  entryRef,
  panelId,
}: {
  collapsed: boolean;
  open: boolean;
  onToggle: () => void;
  entryRef: RefObject<HTMLButtonElement | null>;
  panelId: string;
}) {
  const { t } = useTranslation();
  const button = (
    <button
      ref={entryRef}
      type="button"
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      aria-haspopup="dialog"
      onClick={onToggle}
    />
  );
  if (collapsed) {
    return (
      <RailButton label={t("sidebar.spaces")} icon={<Icon icon={Layers} size="md" />} current={open} asChild>
        {button}
      </RailButton>
    );
  }
  return (
    <SidebarItem
      icon={Layers}
      label={t("sidebar.spaces")}
      current={open}
      badge={<ChevronRight aria-hidden="true" className="size-icon-sm" />}
      asChild
    >
      {button}
    </SidebarItem>
  );
}

function SpaceRow({ space, onOpen }: { space: PanelSpace; onOpen: () => void }) {
  const { t } = useTranslation();
  const name = space.name || t("spaces.personal.label");
  const kind =
    space.type === null
      ? null
      : isKnowledgeBase({ type: space.type })
        ? t("sidebar.kinds.knowledgeBase")
        : t("sidebar.kinds.space");
  return (
    <li className="flex items-center gap-1">
      <Link
        to="/spaces/$spaceKey"
        params={{ spaceKey: space.key }}
        onClick={onOpen}
        className="flex min-h-hit min-w-0 flex-1 items-center gap-3 rounded-sm px-2 hover:bg-hover focus-visible:focus-ring"
        title={name}
      >
        <SpaceBadge space={space} size="sm" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm">{name}</span>
          {kind ? <span className="truncate text-xs text-text-muted">{kind}</span> : null}
        </span>
      </Link>
      <StarButton target={{ spaceId: space.id }} title={name} size="sm" />
    </li>
  );
}

function Group({ label, spaces, onOpen }: { label: string; spaces: PanelSpace[]; onOpen: () => void }) {
  const id = useId();
  if (spaces.length === 0) return null;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1">
      <h3 id={id} className="px-2 text-2xs font-bold tracking-label text-text-muted uppercase">
        {label}
      </h3>
      <ul className="flex flex-col">
        {spaces.map((space) => (
          <SpaceRow key={space.id} space={space} onOpen={onOpen} />
        ))}
      </ul>
    </section>
  );
}

export function SpacesPanel({
  id,
  onClose,
  entryRef,
}: {
  id: string;
  onClose: (returnFocus: boolean) => void;
  entryRef: RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useTranslation();
  const wide = useWide();
  const navigate = useNavigate();
  const organization = useOrganizationState();
  const panel = useRef<HTMLDivElement>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [creating, setCreating] = useState(false);
  const query = useDebounced(text.trim(), 250);
  const starred = useQuery({ ...starredQuery(), throwOnError: false });
  const recent = useQuery({ ...recentlyViewedQuery, throwOnError: false });
  const all = useInfiniteQuery({
    queryKey: [...spaceKeys.list({ search: query, organizationId: null }), "panel"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      request(() =>
        api.GET("/api/v1/spaces", {
          params: {
            query: {
              limit: PAGE_SIZE,
              ...(query ? { q: query } : {}),
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    throwOnError: false,
  });
  const listed: PanelSpace[] = (all.data?.pages.flatMap((page) => page.items) ?? []).map((space) => ({
    id: space.id,
    key: space.key,
    name: space.name,
    personal: space.personal,
    type: space.type,
  }));
  const known = new Map(listed.map((space) => [space.id, space]));

  const favorites: PanelSpace[] = (starred.data?.spaces ?? []).map((space) => ({
    id: space.id,
    key: space.key,
    name: space.name,
    personal: space.personal,
    type: known.get(space.id)?.type ?? null,
  }));
  const favoriteIds = new Set(favorites.map((space) => space.id));
  const visited: PanelSpace[] = [];
  for (const item of recent.data ?? []) {
    if (favoriteIds.has(item.spaceId) || visited.some((space) => space.id === item.spaceId)) continue;
    visited.push({
      id: item.spaceId,
      key: item.spaceKey,
      name: item.spaceName,
      personal: false,
      type: known.get(item.spaceId)?.type ?? null,
    });
  }
  const recentSpaces = visited.slice(0, RECENT_SHOWN);
  const missing = [...favorites, ...recentSpaces].filter((space) => space.type === null);
  const details = useQueries({
    queries: missing.map((space) => ({ ...spaceByKeyQuery(space.key), throwOnError: false })),
  });
  const typeOf = new Map(
    details.flatMap((detail) =>
      detail.data ? [[detail.data.space.id, detail.data.space.type] as const] : [],
    ),
  );
  const withType = (space: PanelSpace): PanelSpace => ({
    ...space,
    type: space.type ?? typeOf.get(space.id) ?? null,
    personal: space.personal || known.get(space.id)?.personal === true,
  });

  useEffect(() => {
    searchField.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || creating) return;
      event.preventDefault();
      onClose(true);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (creating) return;
      const target = event.target as Node;
      if (panel.current?.contains(target) || entryRef.current?.contains(target)) return;
      onClose(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onClose, entryRef, creating]);

  const opened = () => onClose(false);
  const canCreate = organization.can("organization.spaces.create");

  return (
    <div
      ref={panel}
      id={id}
      role="dialog"
      aria-label={t("sidebar.spacesPanel")}
      className={
        wide
          ? "absolute inset-y-0 left-full z-30 flex w-panel flex-col border-r border-border bg-surface shadow-popover"
          : "fixed inset-0 z-50 flex flex-col bg-surface"
      }
    >
      <div className="flex items-center gap-2 border-b border-border p-3">
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-icon-sm -translate-y-1/2 text-text-muted"
          />
          <Input
            ref={searchField}
            type="search"
            aria-label={t("sidebar.searchSpaces")}
            placeholder={t("sidebar.searchSpaces")}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="ps-8"
          />
        </div>
        {wide ? null : <IconButton label={t("sidebar.closeSpaces")} icon={X} onClick={() => onClose(true)} />}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-2">
        <Group
          label={t("sidebar.favorites")}
          spaces={favorites.map(withType).filter((space) => matches(space, query))}
          onOpen={opened}
        />
        <Group
          label={t("sidebar.recentSpaces")}
          spaces={recentSpaces.map(withType).filter((space) => matches(space, query))}
          onOpen={opened}
        />
        {all.isPending ? (
          <div className="flex flex-col gap-2 px-2">
            <Skeleton className="w-2/3" />
            <Skeleton className="w-1/2" />
          </div>
        ) : null}
        {all.isError ? (
          <div className="px-2">
            <LoadError what={t("spaces.list.loadFailed")} error={all.error} onRetry={() => all.refetch()} />
          </div>
        ) : null}
        {all.data && listed.length === 0 ? (
          <p className="px-2 text-sm text-text-muted">
            {query ? t("sidebar.noSpacesFound", { query }) : t("sidebar.noSpaces")}
          </p>
        ) : null}
        <Group label={t("sidebar.allSpaces")} spaces={listed} onOpen={opened} />
        {all.hasNextPage ? (
          <div className="px-2">
            <Button
              variant="secondary"
              size="sm"
              loading={all.isFetchingNextPage}
              onClick={() => void all.fetchNextPage()}
            >
              {t("sidebar.loadMoreSpaces")}
            </Button>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border p-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onClose(false);
            void navigate({ to: "/spaces" });
          }}
        >
          {t("sidebar.showAllSpaces")}
        </Button>
        {canCreate ? (
          <Button variant="secondary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
            {t("sidebar.createSpace")}
          </Button>
        ) : null}
      </div>
      <CreateSpaceDialog
        open={creating}
        onOpenChange={(next) => {
          setCreating(next);
          if (!next) searchField.current?.focus();
        }}
      />
    </div>
  );
}
