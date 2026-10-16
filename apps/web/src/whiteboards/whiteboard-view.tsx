import type { Scene } from "@pagehall/editor-schema/scene";
import {
  Button,
  IconButton,
  Menu,
  type MenuItem,
  Notice,
  PageHeader,
  Skeleton,
  useToast,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  History,
  MessageSquarePlus,
  MoreHorizontal,
  Move,
  Presentation,
  Smartphone,
  Trash2,
} from "lucide-react";
import {
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";
import type { DescribeElement } from "../collaboration/comments-panel.js";
import { StarButton, useContentCollaboration } from "../collaboration/content-collaboration.js";
import { closeCollaboration, openCollaboration, type PageCollaboration } from "../editor/collaboration.js";
import { AvatarStack, type PresenceUser, presenceColor, usePresence } from "../editor/presence.js";
import { CollaborationProblemNotice, SaveStateIndicator } from "../editor/save-indicator.js";
import { LoadError } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { translateKey } from "../i18n/translate.js";
import { WatchMenu } from "../notifications/watch-menu.js";
import { useSession } from "../shell/shell-context.js";
import type { BoardHandle } from "./excalidraw-board.js";
import type { FileStore, RefusedElement } from "./scene-sync.js";
import { loadImage, storePreview, uploadImage, whiteboardSceneQuery } from "./whiteboard-api.js";

const ExcalidrawBoard = lazy(() =>
  import("./excalidraw-board.js").then((module) => ({ default: module.ExcalidrawBoard })),
);

export const PHONE_QUERY = "(max-width: 599px)";
const ELEMENT_KINDS = [
  "rectangle",
  "diamond",
  "ellipse",
  "arrow",
  "line",
  "freedraw",
  "text",
  "image",
  "frame",
];

export function elementKind(
  element: { type: string; customData?: Record<string, unknown> | undefined } | undefined,
): string {
  if (!element) return "removed";
  if (element.type === "rectangle" && element.customData?.stickyNote === true) return "stickyNote";
  return ELEMENT_KINDS.includes(element.type) ? element.type : "other";
}
const PREVIEW_DELAY_MS = 1500;

export function useNarrowViewport(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = globalThis.matchMedia?.(PHONE_QUERY);
      query?.addEventListener("change", notify);
      return () => query?.removeEventListener("change", notify);
    },
    () => globalThis.matchMedia?.(PHONE_QUERY).matches ?? false,
  );
}

export interface WhiteboardItem {
  id: string;
  title: string;
  spaceId: string;
  archived: boolean;
}

export interface WhiteboardViewProps {
  board: WhiteboardItem;
  title: ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
  description?: ReactNode;
  role: "reader" | "commenter" | "editor" | "admin" | null;
  mayEdit: boolean;
  spaceArchived: boolean;
  share?: ReactNode;
  restrictionNote?: ReactNode;
  dialogs?: ReactNode;
  menuItems?: MenuItem[];
  onHistory?: () => void;
  onUnarchive?: () => void;
}

function useBoardFiles(itemId: string): FileStore {
  return useMemo(
    () => ({
      upload: (file) => uploadImage(itemId, file),
      load: (attachmentId, mimeType) => loadImage(attachmentId, mimeType),
    }),
    [itemId],
  );
}

function useCollaboration(itemId: string, enabled: boolean): PageCollaboration | null {
  const [collaboration, setCollaboration] = useState<PageCollaboration | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const opened = openCollaboration(itemId, { kind: "whiteboard" });
    setCollaboration(opened);
    return () => {
      closeCollaboration(opened);
      setCollaboration(null);
    };
  }, [itemId, enabled]);
  return collaboration;
}

const NO_SNAPSHOT = {
  connected: false,
  synced: false,
  loaded: false,
  problem: null,
  saveState: "offline",
} as const;

export function WhiteboardView({
  board,
  title,
  breadcrumbs,
  description,
  role,
  mayEdit,
  spaceArchived,
  share,
  restrictionNote,
  dialogs,
  menuItems = [],
  onHistory,
  onUnarchive,
}: WhiteboardViewProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const session = useSession();
  const queryClient = useQueryClient();
  const narrow = useNarrowViewport();
  const archived = board.archived || spaceArchived;
  const writable = mayEdit && !archived;
  const editing = writable && !narrow;
  const collaboration = useCollaboration(board.id, editing);
  const snapshot = useSyncExternalStore(
    collaboration?.subscribe ?? (() => () => undefined),
    collaboration?.getSnapshot ?? (() => NO_SNAPSHOT),
  );
  const scene = useQuery({ ...whiteboardSceneQuery(board.id), enabled: !editing });
  const files = useBoardFiles(board.id);
  const handle = useRef<BoardHandle | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const changedSinceImage = useRef(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const account = session.account;
  const self = useMemo<PresenceUser | null>(
    () => (account ? { id: account.id, name: account.name, color: presenceColor(account.id) } : null),
    [account],
  );
  const others = usePresence(collaboration?.provider ?? null, self);

  const describeElement = useCallback<DescribeElement>(
    (elementId, quote) => {
      const element = handle.current?.api.getSceneElements().find((candidate) => candidate.id === elementId);
      const label = translateKey(t, `whiteboards.elements.${elementKind(element)}`);
      return quote ? t("whiteboards.elements.withText", { label, text: quote }) : label;
    },
    [t],
  );

  const comments = useContentCollaboration({
    itemId: board.id,
    spaceId: board.spaceId,
    role,
    archived,
    writable,
    describeElement,
    hint: t("whiteboards.comments.hint"),
  });

  useEffect(() => {
    const thread = comments.activeThread;
    if (!thread) return;
    const threads = queryClient.getQueryData<{ threads: { id: string; elementId: string | null }[] }>([
      "items",
      board.id,
      "comments",
    ]);
    const elementId = threads?.threads.find((candidate) => candidate.id === thread)?.elementId;
    if (elementId) handle.current?.focusElement(elementId);
  }, [comments.activeThread, queryClient, board.id]);

  useEffect(() => {
    if (!collaboration) return;
    return collaboration.subscribeSaved((revision, own) => {
      if (!own || !changedSinceImage.current) return;
      if (previewTimer.current !== null) clearTimeout(previewTimer.current);
      previewTimer.current = setTimeout(() => {
        previewTimer.current = null;
        const current = handle.current;
        if (!current) return;
        changedSinceImage.current = false;
        void current
          .exportSvg()
          .then((svg) => storePreview(board.id, revision, svg))
          .catch(() => {
            changedSinceImage.current = true;
          });
      }, PREVIEW_DELAY_MS);
    });
  }, [collaboration, board.id]);

  useEffect(
    () => () => {
      if (previewTimer.current !== null) clearTimeout(previewTimer.current);
    },
    [],
  );

  const onRefused = useCallback(
    (refused: RefusedElement[]) => {
      const embedded = refused.some(({ problems }) =>
        problems.some((problem) => problem.code === "unknownElementType"),
      );
      toast({
        variant: "error",
        title: t("whiteboards.refused.title"),
        description: embedded ? t("whiteboards.refused.embed") : t("whiteboards.refused.other"),
      });
    },
    [t, toast],
  );

  const onReady = useCallback((ready: BoardHandle) => {
    handle.current = ready;
  }, []);

  const onLocalChange = useCallback(() => {
    changedSinceImage.current = true;
  }, []);

  const onFileFailed = useCallback(
    (error: unknown) =>
      toast({ variant: "error", title: t("whiteboards.imageFailed"), description: problemMessage(t, error) }),
    [t, toast],
  );

  const selectedElement = selection.length === 1 ? selection[0] : undefined;
  const canComment = !archived && (role === "commenter" || role === "editor" || role === "admin");
  const commentButton = canComment ? (
    <Button
      variant="secondary"
      icon={MessageSquarePlus}
      onClick={() =>
        comments.commentOn(
          selectedElement
            ? { elementId: selectedElement, label: describeElement(selectedElement, "") }
            : null,
        )
      }
    >
      {selectedElement ? t("whiteboards.comments.onElement") : t("whiteboards.comments.add")}
    </Button>
  ) : null;

  const items: MenuItem[] = [
    ...(onHistory ? [{ label: t("versions.history"), icon: History, onSelect: onHistory }] : []),
    ...menuItems,
  ];

  const ready = editing ? collaboration !== null && snapshot.loaded : scene.data !== undefined;
  const emptyScene: Scene = { elements: [], files: {}, settings: { viewBackgroundColor: null } };

  return (
    <div className="flex h-full min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-col gap-2 border-b border-border px-4 py-3 md:px-6">
          <PageHeader
            title={title}
            icon={Presentation}
            {...(breadcrumbs ? { breadcrumbs } : {})}
            {...(description ? { description } : {})}
            actions={
              <>
                {editing ? <SaveStateIndicator state={snapshot.saveState} /> : null}
                {editing ? <AvatarStack self={self} others={others} /> : null}
                {commentButton}
                {share}
                <StarButton target={{ itemId: board.id }} title={board.title} />
                <WatchMenu target={{ type: "item", id: board.id }} name={board.title} />
                {comments.commentsButton}
                {onHistory ? (
                  <IconButton label={t("versions.history")} icon={History} onClick={onHistory} />
                ) : null}
                {items.length > 0 ? (
                  <Menu trigger={<IconButton label={t("page.more")} icon={MoreHorizontal} />} items={items} />
                ) : null}
              </>
            }
          />
          {restrictionNote}
          {archived ? (
            <Notice
              variant="warning"
              title={board.archived ? t("whiteboards.archivedTitle") : t("archive.spaceArchivedTitle")}
              action={
                onUnarchive && board.archived && !spaceArchived ? (
                  <Button size="sm" variant="secondary" icon={ArchiveRestore} onClick={onUnarchive}>
                    {t("archive.unarchive")}
                  </Button>
                ) : undefined
              }
            >
              {board.archived ? t("whiteboards.archivedDescription") : t("archive.spaceArchivedDescription")}
            </Notice>
          ) : null}
          {writable && narrow ? (
            <p className="flex items-center gap-2 text-sm text-text-muted">
              <Smartphone aria-hidden="true" className="size-icon shrink-0" />
              {t("whiteboards.phone")}
            </p>
          ) : null}
          {snapshot.problem ? <CollaborationProblemNotice problem={snapshot.problem} /> : null}
        </div>
        <section aria-label={t("whiteboards.canvas")} className="relative min-h-0 flex-1">
          {scene.isError ? (
            <div className="p-6">
              <LoadError
                what={t("whiteboards.loadFailed")}
                error={scene.error}
                onRetry={() => scene.refetch()}
              />
            </div>
          ) : ready ? (
            <Suspense fallback={<Skeleton className="h-full w-full" />}>
              <ExcalidrawBoard
                scene={scene.data?.scene ?? emptyScene}
                editable={editing}
                doc={editing ? (collaboration?.doc ?? null) : null}
                provider={editing ? (collaboration?.provider ?? null) : null}
                self={self}
                files={files}
                name={board.title}
                onReady={onReady}
                onSelectionChange={setSelection}
                onRefused={onRefused}
                onFileFailed={onFileFailed}
                onLocalChange={onLocalChange}
              />
            </Suspense>
          ) : (
            <Skeleton className="h-full w-full" />
          )}
        </section>
      </div>
      {comments.panel}
      {dialogs}
    </div>
  );
}

export function whiteboardMenu(
  t: (key: "tree.move" | "archive.unarchive" | "archive.archive" | "trash.moveToTrash") => string,
  options: {
    writable: boolean;
    canEdit: boolean;
    archived: boolean;
    onMove: () => void;
    onArchive: () => void;
    onUnarchive: () => void;
    onDelete: () => void;
  },
): MenuItem[] {
  const items: MenuItem[] = [];
  if (options.writable) items.push({ label: t("tree.move"), icon: Move, onSelect: options.onMove });
  if (options.canEdit) {
    items.push(
      { type: "separator" },
      options.archived
        ? { label: t("archive.unarchive"), icon: ArchiveRestore, onSelect: options.onUnarchive }
        : { label: t("archive.archive"), icon: Archive, onSelect: options.onArchive },
      { label: t("trash.moveToTrash"), icon: Trash2, danger: true, onSelect: options.onDelete },
    );
  }
  return items;
}
