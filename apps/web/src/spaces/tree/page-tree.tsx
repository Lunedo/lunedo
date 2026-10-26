import { Badge, classNames, IconButton, Menu, Spinner, Tooltip, useToast, VisuallyHidden } from "@lunedo/ui";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, ExternalLink, Languages, Lock, MoreHorizontal } from "lucide-react";
import {
  createContext,
  type DragEvent,
  type KeyboardEvent,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { problemMessage } from "../../errors/problem-message.js";
import { type CategoryAccess, CategoryIcons } from "../../knowledge-bases/category-access.js";
import { contentLanguageLabel } from "../../search/content-language.js";
import { WhiteboardPreview } from "../../whiteboards/whiteboard-preview.js";
import { itemIcon } from "../item-icons.js";
import { isExternal, itemHref } from "../item-paths.js";
import { type SpaceWithRole, spaceKeys, type TreeItem } from "../space-queries.js";
import { useItemActions } from "./item-actions.js";
import { MoveConfirmDialog, moveImpactOf, type PendingMove } from "./move-confirmation.js";

const PAGE_SIZE = 200;
const UNDO_SECONDS = 5;
const LISTED_ELSEWHERE: ReadonlySet<string> = new Set(["meetingSeries"]);

type Zone = "before" | "after" | "inside";

interface DropTarget {
  id: string;
  zone: Zone;
}

interface Placement {
  parentId: string | null;
  beforeId?: string;
  afterId?: string;
}

interface Dragged {
  item: TreeItem;
  previousId: string | null;
  nextId: string | null;
}

interface TreeState {
  space: SpaceWithRole;
  canEdit: boolean;
  currentId: string | null;
  expanded: ReadonlySet<string>;
  toggle: (id: string, open?: boolean) => void;
  focusedId: string | null;
  setFocused: (id: string) => void;
  dropTarget: DropTarget | null;
  setDropTarget: (target: DropTarget | null) => void;
  dragged: React.RefObject<Dragged | null>;
  drop: (target: TreeItem, zone: Zone) => void;
  loading: () => () => void;
  categories: CategoryView | null;
}

export interface CategoryView {
  entries: ReadonlyMap<string, CategoryAccess>;
  shown: ((item: TreeItem) => boolean) | null;
}

const TreeContext = createContext<TreeState | null>(null);

function useTree(): TreeState {
  const value = useContext(TreeContext);
  if (!value) throw new Error("useTree needs the page tree");
  return value;
}

export function useChildren(spaceId: string, parentId: string | null, enabled = true) {
  return useInfiniteQuery({
    queryKey: spaceKeys.children(spaceId, parentId),
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      request(() =>
        api.GET("/api/v1/spaces/{spaceId}/items", {
          params: {
            path: { spaceId },
            query: {
              limit: PAGE_SIZE,
              ...(parentId ? { parentId } : {}),
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 10_000,
    throwOnError: false,
  });
}

type Children = ReturnType<typeof useChildren>;

function itemsOf(children: Children, excludedId: string | null = null): TreeItem[] {
  return translationsFirst(
    (children.data?.pages.flatMap((page) => page.items) ?? []).filter(
      (item) => item.id !== excludedId && !LISTED_ELSEWHERE.has(item.kind),
    ),
  );
}

function indent(depth: number): string {
  return `calc(var(--spacing-3) * ${depth - 1} + var(--spacing-1))`;
}

function zoneOf(event: DragEvent<HTMLElement>, item: TreeItem): Zone {
  const box = event.currentTarget.getBoundingClientRect();
  const offset = (event.clientY - box.top) / Math.max(box.height, 1);
  if (item.kind === "link") return offset < 0.5 ? "before" : "after";
  if (offset < 0.25) return "before";
  if (offset > 0.75) return "after";
  return "inside";
}

export function PageTree({
  space,
  currentId,
  ancestors,
  categories = null,
}: {
  space: SpaceWithRole;
  currentId: string | null;
  ancestors: readonly string[];
  categories?: CategoryView | null;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canEdit = space.role === "editor" || space.role === "admin";
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(ancestors));
  const [focusedId, setFocusedId] = useState<string | null>(currentId);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const dragged = useRef<Dragged | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const homeId = space.overviewItemId ?? null;
  const root = useChildren(space.id, null);
  const home = useChildren(space.id, homeId, homeId !== null);
  const levels = homeId === null ? [root] : [home, root];
  const rootPending = levels.some((level) => level.isPending);
  const rootFailed = levels.filter((level) => level.isError);
  const [loadingLevels, setLoadingLevels] = useState(0);
  const loading = useCallback(() => {
    setLoadingLevels((count) => count + 1);
    return () => setLoadingLevels((count) => count - 1);
  }, []);

  useEffect(() => {
    setExpanded((current) => {
      if (ancestors.every((id) => current.has(id))) return current;
      return new Set([...current, ...ancestors]);
    });
  }, [ancestors]);

  const toggle = useCallback((id: string, open?: boolean) => {
    setExpanded((current) => {
      const next = new Set(current);
      const shouldOpen = open ?? !next.has(id);
      if (shouldOpen) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["spaces", space.id, "children"] }),
    [queryClient, space.id],
  );

  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);

  const attempt = useCallback(
    (item: TreeItem, placement: Placement, done: () => Promise<void>, failed: string) => {
      const run = (confirmation?: string) =>
        request(() =>
          api.POST("/api/v1/items/{itemId}/move", {
            params: { path: { itemId: item.id } },
            body: confirmation ? { ...placement, confirmation } : placement,
          }),
        ).then(done);
      void run().catch((error: unknown) => {
        const impact = moveImpactOf(error);
        if (impact) {
          setPendingMove({ title: item.title, impact, confirm: run });
          return;
        }
        toast({ title: failed, description: problemMessage(t, error), variant: "error" });
      });
    },
    [t, toast],
  );

  const drop = useCallback(
    (target: TreeItem, zone: Zone) => {
      const source = dragged.current;
      dragged.current = null;
      setDropTarget(null);
      if (!source || source.item.id === target.id) return;
      const placement: Placement =
        zone === "inside"
          ? { parentId: target.id }
          : zone === "before"
            ? { parentId: target.parentId, beforeId: target.id }
            : { parentId: target.parentId, afterId: target.id };
      const original: Placement = source.previousId
        ? { parentId: source.item.parentId, afterId: source.previousId }
        : source.nextId
          ? { parentId: source.item.parentId, beforeId: source.nextId }
          : { parentId: source.item.parentId };
      attempt(
        source.item,
        placement,
        async () => {
          if (zone === "inside") toggle(target.id, true);
          await refresh();
          toast({
            title: t("tree.moved", { title: source.item.title }),
            undo: {
              seconds: UNDO_SECONDS,
              onUndo: () => attempt(source.item, original, refresh, t("tree.undoFailed")),
            },
          });
        },
        t("tree.moveFailed"),
      );
    },
    [attempt, refresh, t, toast, toggle],
  );

  const state = useMemo<TreeState>(
    () => ({
      space,
      canEdit,
      currentId,
      expanded,
      toggle,
      focusedId,
      setFocused: setFocusedId,
      dropTarget,
      setDropTarget,
      dragged,
      drop,
      loading,
      categories,
    }),
    [space, canEdit, currentId, expanded, toggle, focusedId, dropTarget, drop, loading, categories],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(container.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (index === -1) return;
    const current = items[index] as HTMLElement;
    const id = current.dataset.itemId ?? "";
    const focus = (element: HTMLElement | undefined) => {
      if (!element) return;
      event.preventDefault();
      setFocusedId(element.dataset.itemId ?? "");
      element.focus();
    };
    switch (event.key) {
      case "ArrowDown":
        focus(items[index + 1]);
        break;
      case "ArrowUp":
        focus(items[index - 1]);
        break;
      case "Home":
        focus(items[0]);
        break;
      case "End":
        focus(items.at(-1));
        break;
      case "ArrowRight":
        if (current.dataset.expandable === "true") {
          event.preventDefault();
          if (current.getAttribute("aria-expanded") === "true") focus(items[index + 1]);
          else toggle(id, true);
        }
        break;
      case "ArrowLeft":
        if (current.getAttribute("aria-expanded") === "true") {
          event.preventDefault();
          toggle(id, false);
        } else focus(items.find((element) => element.dataset.itemId === current.dataset.parentId));
        break;
      case "Enter":
        event.preventDefault();
        current
          .querySelector<HTMLElement>(current.dataset.treeAction === undefined ? "a" : "button")
          ?.click();
        break;
    }
  };

  return (
    <TreeContext value={state}>
      {rootPending && rootFailed.length === 0 ? <LevelLoading depth={1} /> : null}
      {rootFailed.length > 0 ? (
        <LevelLoadFailed onRetry={() => rootFailed.forEach((level) => void level.refetch())} />
      ) : null}
      <div
        ref={container}
        role="tree"
        aria-label={t("tree.label")}
        aria-busy={rootPending || loadingLevels > 0 || undefined}
        onKeyDown={onKeyDown}
        className="flex flex-col"
      >
        {levels.every((level) => level.isSuccess) ? (
          <LevelNodes
            items={(homeId === null ? itemsOf(root) : [...itemsOf(home), ...itemsOf(root, homeId)]).filter(
              (item) => categories?.shown?.(item) ?? true,
            )}
            depth={1}
            sources={levels}
          />
        ) : null}
      </div>
      <MoveConfirmDialog pending={pendingMove} onChange={setPendingMove} />
    </TreeContext>
  );
}

function LevelLoading({ depth, hidden = false }: { depth: number; hidden?: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      role="none"
      aria-hidden={hidden || undefined}
      className="flex h-row items-center"
      style={{ paddingInlineStart: indent(depth + 1) }}
    >
      <Spinner label={t("tree.loading")} />
    </div>
  );
}

function LevelLoadFailed({ onRetry, depth }: { onRetry: () => void; depth?: number }) {
  const { t } = useTranslation();
  const inTree = depth !== undefined;
  return (
    <div
      {...(inTree
        ? {
            role: "treeitem",
            "aria-level": depth,
            "aria-label": `${t("tree.loadFailed")} ${t("ui.retry")}`,
            tabIndex: -1,
            "data-tree-action": "",
            style: { paddingInlineStart: indent(depth) },
          }
        : { role: "none" })}
      className="rounded-sm px-2 py-1 text-sm text-danger outline-none focus-visible:focus-ring"
    >
      {t("tree.loadFailed")}{" "}
      <button type="button" tabIndex={inTree ? -1 : 0} className="text-accent underline" onClick={onRetry}>
        {t("ui.retry")}
      </button>
    </div>
  );
}

function translationsFirst(items: TreeItem[]): TreeItem[] {
  return [...items.filter((item) => item.translationOf), ...items.filter((item) => !item.translationOf)];
}

function TreeLevel({ parentId, depth }: { parentId: string | null; depth: number }) {
  const tree = useTree();
  const children = useChildren(tree.space.id, parentId);
  const { loading } = tree;
  useLayoutEffect(() => (children.isPending ? loading() : undefined), [children.isPending, loading]);
  if (children.isPending) return <LevelLoading depth={depth} hidden />;
  if (children.isError) return <LevelLoadFailed depth={depth} onRetry={() => void children.refetch()} />;
  return <LevelNodes items={itemsOf(children)} depth={depth} sources={[children]} />;
}

function LevelNodes({
  items,
  depth,
  sources,
}: {
  items: TreeItem[];
  depth: number;
  sources: readonly Children[];
}) {
  const { t } = useTranslation();
  return (
    <>
      {items.map((item, index) => (
        <TreeNode
          key={item.id}
          item={item}
          depth={depth}
          position={index + 1}
          count={items.length}
          previousId={items[index - 1]?.id ?? null}
          nextId={items[index + 1]?.id ?? null}
        />
      ))}
      {sources.map((children, index) =>
        children.hasNextPage ? (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: the sources of a level never change their order
            key={index}
            role="treeitem"
            aria-level={depth}
            aria-label={children.isFetchingNextPage ? t("tree.loading") : t("tree.showMore")}
            tabIndex={-1}
            data-tree-action=""
            className="rounded-sm outline-none focus-visible:focus-ring"
            style={{ paddingInlineStart: indent(depth + 1) }}
          >
            <button
              type="button"
              tabIndex={-1}
              className="h-row rounded-sm px-2 text-sm text-accent hover:underline"
              onClick={() => void children.fetchNextPage()}
            >
              {children.isFetchingNextPage ? t("tree.loading") : t("tree.showMore")}
            </button>
          </div>
        ) : null,
      )}
    </>
  );
}

function TreeNode({
  item,
  depth,
  position,
  count,
  previousId,
  nextId,
}: {
  item: TreeItem;
  depth: number;
  position: number;
  count: number;
  previousId: string | null;
  nextId: string | null;
}) {
  const { t, i18n } = useTranslation();
  const tree = useTree();
  const navigate = useNavigate();
  const actions = useItemActions(tree.space, item, tree.currentId);
  const language = item.translationOf && item.contentLanguage ? item.contentLanguage : null;
  const languageName = language ? contentLanguageLabel(t, language, i18n.language) : null;
  const expandable = item.hasChildren;
  const open = tree.expanded.has(item.id);
  const current = tree.currentId === item.id;
  const focused = tree.focusedId === item.id || (tree.focusedId === null && position === 1 && depth === 1);
  const href = itemHref(item, tree.space.key);
  const external = href !== null && isExternal(href);
  const title = item.kind === "link" && !item.link?.accessible ? t("tree.noAccess") : item.title;
  const draft = item.kind === "page" && !item.published;
  const named =
    language && languageName
      ? t("tree.translationLabel", { title, code: language.toUpperCase(), language: languageName })
      : title;
  const label = draft ? t("tree.draftLabel", { label: named }) : named;
  const target = tree.dropTarget?.id === item.id ? tree.dropTarget.zone : null;
  const Glyph = language ? Languages : item.kind === "link" && external ? ExternalLink : itemIcon(item.kind);

  const onDragStart = (event: DragEvent<HTMLElement>) => {
    tree.dragged.current = { item, previousId, nextId };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.title);
  };
  const onDragOver = (event: DragEvent<HTMLElement>) => {
    const dragged = tree.dragged.current;
    if (!dragged || dragged.item.id === item.id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const zone = zoneOf(event, item);
    if (tree.dropTarget?.id !== item.id || tree.dropTarget.zone !== zone)
      tree.setDropTarget({ id: item.id, zone });
  };

  return (
    <>
      <div
        role="treeitem"
        aria-level={depth}
        aria-setsize={count}
        aria-posinset={position}
        aria-selected={current}
        {...(expandable ? { "aria-expanded": open } : {})}
        aria-label={label}
        data-item-id={item.id}
        data-parent-id={item.parentId ?? ""}
        data-expandable={expandable}
        tabIndex={focused ? 0 : -1}
        draggable={tree.canEdit}
        onFocus={(event) => {
          if (event.target === event.currentTarget) tree.setFocused(item.id);
        }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragLeave={() => {
          if (tree.dropTarget?.id === item.id) tree.setDropTarget(null);
        }}
        onDrop={(event) => {
          event.preventDefault();
          tree.drop(item, target ?? "after");
        }}
        onDragEnd={() => tree.setDropTarget(null)}
        onKeyDown={(event) => {
          if ((event.key === "F10" && event.shiftKey) || event.key === "ContextMenu") {
            event.preventDefault();
            event.currentTarget.querySelector<HTMLButtonElement>("[data-item-menu]")?.focus();
          }
        }}
        className={classNames(
          "group/row relative flex h-row items-center gap-1 rounded-sm pe-1 outline-none focus-visible:focus-ring",
          current ? "bg-accent text-on-accent [&_svg]:text-on-accent" : "hover:bg-hover",
          target === "inside" && "bg-accent-soft",
        )}
        style={{ paddingInlineStart: indent(depth) }}
      >
        {target === "before" ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-1 top-0 border-t-2 border-accent"
          />
        ) : null}
        {target === "after" ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-1 bottom-0 border-b-2 border-accent"
          />
        ) : null}
        {expandable ? (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className={classNames(
              "flex size-6 shrink-0 items-center justify-center rounded-sm focus-visible:focus-ring",
              current
                ? "text-on-accent hover:ring-1 hover:ring-on-accent hover:ring-inset"
                : "text-text-muted hover:bg-hover",
            )}
            onClick={() => tree.toggle(item.id)}
          >
            {open ? <ChevronDown className="size-icon-sm" /> : <ChevronRight className="size-icon-sm" />}
          </button>
        ) : (
          <span aria-hidden="true" className="size-6 shrink-0" />
        )}
        {item.kind === "whiteboard" ? (
          <Tooltip
            side="right"
            content={
              <WhiteboardPreview
                itemId={item.id}
                label={t("whiteboards.previewOf", { title })}
                className="aspect-video w-field"
              />
            }
          >
            <Glyph aria-hidden="true" className="size-icon-md shrink-0 text-text-muted" />
          </Tooltip>
        ) : (
          <Glyph aria-hidden="true" className="size-icon-md shrink-0 text-text-muted" />
        )}
        {href ? (
          <a
            href={href}
            tabIndex={-1}
            title={title}
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            onClick={(event) => {
              if (external || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
              event.preventDefault();
              void navigate({ to: href });
            }}
            className={classNames("min-w-0 flex-1 truncate text-inherit", current && "font-semibold")}
          >
            {title}
          </a>
        ) : (
          <span className="min-w-0 flex-1 truncate text-text-muted" title={title}>
            {title}
          </span>
        )}
        {/* Separates the badges for axe: https://github.com/dequelabs/axe-core/issues/5459 */}
        {language && languageName ? " " : null}
        {language && languageName ? (
          <span title={t("tree.translationInto", { language: languageName })} className="shrink-0">
            <Badge variant="neutral">{language.toUpperCase()}</Badge>
          </span>
        ) : null}
        {item.kind === "link" && !item.link?.accessible ? (
          <Lock aria-hidden="true" className="size-icon-sm shrink-0 text-text-muted" />
        ) : null}
        {item.kind !== "link" && (item.viewRestriction === "own" || item.editRestricted) ? (
          <span className="flex shrink-0 items-center text-text-muted">
            <Lock aria-hidden="true" className="size-icon-sm" />
            <VisuallyHidden>
              {item.viewRestriction === "own" ? t("tree.viewRestricted") : t("tree.editRestricted")}
            </VisuallyHidden>
          </span>
        ) : null}
        {item.kind === "folder" ? (
          <CategoryIcons entry={tree.categories?.entries.get(item.id)} canEdit={tree.canEdit} />
        ) : null}
        {draft ? " " : null}
        {draft ? <Badge variant="warning">{t("versions.draftBadge")}</Badge> : null}
        {actions.length > 0 ? (
          <span
            className={classNames(
              "shrink-0 transition-opacity motion-reduce:transition-none",
              focused || current
                ? "opacity-100"
                : "opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100",
            )}
          >
            <Menu
              trigger={
                <IconButton
                  data-item-menu=""
                  tabIndex={focused ? 0 : -1}
                  size="sm"
                  label={t("tree.actionsFor", { title })}
                  icon={MoreHorizontal}
                />
              }
              items={actions}
            />
          </span>
        ) : null}
      </div>
      {expandable && open ? <TreeLevel parentId={item.id} depth={depth + 1} /> : null}
    </>
  );
}
