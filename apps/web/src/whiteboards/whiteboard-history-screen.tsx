import { Badge, Button, EmptyState, PageHeader, Skeleton, useToast } from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { History, ImageOff, RotateCcw } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { LoadError } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { translateKey } from "../i18n/translate.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { useDocumentTitle } from "../screens/settings/settings-page.js";
import { itemSlug } from "../spaces/item-paths.js";
import { spaceDisplayName } from "../spaces/space-badge.js";
import { useSpace } from "../spaces/space-context.js";
import { type ItemDetails, itemQuery, whiteboardPath } from "../spaces/space-queries.js";
import { CopiedFrom } from "../spaces/versions/copied-from.js";
import type { FileStore } from "./scene-sync.js";
import {
  loadImage,
  previewUrl,
  restoreWhiteboardVersion,
  type WhiteboardVersion,
  whiteboardKeys,
  whiteboardVersionQuery,
  whiteboardVersionsQuery,
} from "./whiteboard-api.js";

const ExcalidrawBoard = lazy(() =>
  import("./excalidraw-board.js").then((module) => ({ default: module.ExcalidrawBoard })),
);

const route = getRouteApi("/app/spaces/$spaceKey/whiteboards/$itemId/history");

export function WhiteboardHistoryScreen() {
  const { t } = useTranslation();
  const { itemId } = route.useParams();
  const item = useQuery(itemQuery(itemId));
  useDocumentTitle(item.data ? t("versions.historyOf", { title: item.data.title }) : "");
  if (item.isPending) return <Skeleton className="m-6 h-field" />;
  if (item.isError) {
    return (
      <div className="p-6">
        <LoadError what={t("whiteboards.loadFailed")} error={item.error} onRetry={() => item.refetch()} />
      </div>
    );
  }
  return <BoardHistory key={item.data.id} board={item.data} />;
}

function reasonOf(t: TFunction, version: WhiteboardVersion): string {
  if (version.reason === "restored")
    return t("versions.reasons.restored", { number: version.restoredFrom ?? 0 });
  if (version.reason === "copied")
    return version.copiedFrom?.title
      ? t("versions.reasons.copied", { title: version.copiedFrom.title })
      : t("versions.reasons.copiedHidden");
  return translateKey(t, `versions.reasons.${version.reason}`);
}

function BoardHistory({ board }: { board: ItemDetails }) {
  const { t } = useTranslation();
  const format = useFormat();
  const { toast } = useToast();
  const { space, canEdit } = useSpace();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = route.useSearch();
  const writable = canEdit && !board.archived && !space.archived;
  const versions = useQuery(whiteboardVersionsQuery(board.id));
  const selected = search.version ?? versions.data?.[0]?.number;
  const content = useQuery({
    ...whiteboardVersionQuery(board.id, selected ?? 1),
    enabled: selected !== undefined,
  });
  const [viewing, setViewing] = useState(false);
  const files = useMemo<FileStore>(
    () => ({
      upload: () => Promise.reject(new Error("read only")),
      load: (attachmentId, mimeType) => loadImage(attachmentId, mimeType),
    }),
    [],
  );
  const boardPath = whiteboardPath(space.key, board.id, itemSlug(board.title));
  const select = (number: number) => {
    setViewing(false);
    void navigate({
      to: "/spaces/$spaceKey/whiteboards/$itemId/history",
      params: { spaceKey: space.key, itemId: board.id },
      search: { version: number },
      replace: true,
    });
  };
  const restore = async (number: number) => {
    const latest = versions.data?.[0]?.number;
    try {
      const result = await restoreWhiteboardVersion(board.id, number);
      await queryClient.invalidateQueries({ queryKey: whiteboardKeys.scene(board.id) });
      select(result.version);
      toast({
        title: t("whiteboards.history.restored", { number }),
        ...(latest
          ? {
              undo: {
                seconds: 10,
                onUndo: () =>
                  void restoreWhiteboardVersion(board.id, latest)
                    .then(() => queryClient.invalidateQueries({ queryKey: whiteboardKeys.scene(board.id) }))
                    .catch((error: unknown) =>
                      toast({
                        variant: "error",
                        title: t("whiteboards.history.restoreFailed"),
                        description: problemMessage(t, error),
                      }),
                    ),
              },
            }
          : {}),
      });
    } catch (error) {
      toast({
        variant: "error",
        title: t("whiteboards.history.restoreFailed"),
        description: problemMessage(t, error),
      });
    }
  };
  const breadcrumbs = [
    { label: spaceDisplayName(t, space), href: `/spaces/${space.key}` },
    { label: board.title, href: boardPath },
  ];
  return (
    <div className="flex w-full flex-col gap-4 px-4 pt-6 pb-12 md:px-8">
      <PageHeader
        title={t("versions.historyTitle")}
        icon={History}
        breadcrumbs={breadcrumbs}
        description={t("versions.historyHint")}
      />
      {versions.isPending ? <Skeleton className="h-field w-full" /> : null}
      {versions.isError ? (
        <LoadError
          what={t("versions.loadFailed")}
          error={versions.error}
          onRetry={() => versions.refetch()}
        />
      ) : null}
      {versions.data && versions.data.length === 0 ? (
        <EmptyState icon={History} title={t("versions.emptyTitle")} description={t("versions.emptyLive")} />
      ) : null}
      {versions.data && versions.data.length > 0 ? (
        <div className="flex flex-col gap-4 lg:flex-row">
          <nav aria-label={t("versions.list")} className="lg:w-panel lg:shrink-0">
            <ol className="flex flex-col gap-1">
              {versions.data.map((version) => {
                const people = version.contributors.map(
                  (person) => person.name ?? t("versions.formerPerson"),
                );
                const active = version.number === selected;
                return (
                  <li key={version.number}>
                    <button
                      type="button"
                      aria-current={active ? "true" : undefined}
                      onClick={() => select(version.number)}
                      className={`flex w-full min-w-0 flex-col items-start gap-1 rounded-md border px-3 py-2 text-start focus-visible:focus-ring ${active ? "border-accent bg-selected" : "border-border hover:bg-hover"}`}
                    >
                      <span className="flex w-full items-center gap-2">
                        <span className="font-semibold">
                          {t("versions.versionNumber", { number: version.number })}
                        </span>
                        <time className="text-xs text-text-muted" dateTime={version.createdAt}>
                          {format.dateTime(version.createdAt)}
                        </time>
                      </span>
                      <span className="text-sm text-text-muted">{reasonOf(t, version)}</span>
                      {people.length > 0 ? (
                        <span className="w-full truncate text-sm" title={people.join(", ")}>
                          {people.join(", ")}
                        </span>
                      ) : null}
                    </button>
                    <CopiedFrom source={version.copiedFrom} />
                  </li>
                );
              })}
            </ol>
          </nav>
          {selected !== undefined ? (
            <section
              aria-label={t("versions.versionNumber", { number: selected })}
              className="flex min-w-0 flex-1 flex-col gap-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">{t("versions.versionNumber", { number: selected })}</h2>
                {selected === versions.data[0]?.number ? (
                  <Badge>{t("whiteboards.history.latest")}</Badge>
                ) : null}
                <span className="flex-1" />
                <Button variant="secondary" onClick={() => setViewing(!viewing)} aria-pressed={viewing}>
                  {viewing ? t("whiteboards.history.showImage") : t("whiteboards.history.explore")}
                </Button>
                {writable && selected !== versions.data[0]?.number ? (
                  <Button variant="primary" icon={RotateCcw} onClick={() => void restore(selected)}>
                    {t("whiteboards.history.restore", { number: selected })}
                  </Button>
                ) : null}
              </div>
              {viewing ? (
                content.data ? (
                  <div className="aspect-video w-full overflow-hidden rounded-md border border-border">
                    <Suspense fallback={<Skeleton className="h-full w-full" />}>
                      <ExcalidrawBoard
                        scene={content.data.scene as never}
                        editable={false}
                        files={files}
                        name={board.title}
                      />
                    </Suspense>
                  </div>
                ) : content.isError ? (
                  <LoadError
                    what={t("whiteboards.history.loadFailed")}
                    error={content.error}
                    onRetry={() => content.refetch()}
                  />
                ) : (
                  <Skeleton className="aspect-video w-full" />
                )
              ) : versions.data.find((version) => version.number === selected)?.preview ? (
                <img
                  src={previewUrl(board.id, selected)}
                  alt={t("whiteboards.history.imageOf", { number: selected })}
                  className="aspect-video w-full rounded-md border border-border bg-surface object-contain"
                />
              ) : (
                <EmptyState
                  icon={ImageOff}
                  title={t("whiteboards.history.noImage")}
                  description={t("whiteboards.history.noImageDescription")}
                />
              )}
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
