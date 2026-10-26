import { Badge, Button, ConfirmDialog, EmptyState, IconButton, List, Skeleton } from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Download, FileArchive, FolderTree, Printer, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LoadError, useFailureToast } from "../errors/failure.js";
import { translateKey } from "../i18n/translate.js";
import { useFormat } from "../preferences/preferences-provider.js";
import {
  deleteExport,
  type ExportEntry,
  exportDownloadUrl,
  exportKeys,
  exportsQuery,
  isRunning,
} from "./export-queries.js";

const ERROR_CODES = new Set([
  "exportDisabled",
  "noAccess",
  "tokenRevoked",
  "notEnoughStorage",
  "renderUnavailable",
  "renderFailed",
  "renderTooLarge",
  "tooManyPagesForFile",
  "tooLargeToBuild",
  "interrupted",
  "internalError",
]);

export function ExportsList({ spaceId, emptyText }: { spaceId?: string; emptyText?: string }) {
  const { t } = useTranslation();
  const query = useQuery(exportsQuery);
  const [removing, setRemoving] = useState<ExportEntry | null>(null);
  const queryClient = useQueryClient();
  const showFailure = useFailureToast();

  if (query.isPending) return <Skeleton className="h-row w-full" />;
  if (query.isError) {
    return (
      <LoadError what={t("exports.list.loadFailed")} error={query.error} onRetry={() => query.refetch()} />
    );
  }
  const entries = spaceId ? query.data.filter((entry) => entry.spaceId === spaceId) : query.data;
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={FileArchive}
        title={t("exports.list.emptyTitle")}
        description={emptyText ?? t("exports.list.emptyDescription")}
      />
    );
  }

  const remove = async (entry: ExportEntry) => {
    try {
      await deleteExport(entry.id);
    } catch (failure) {
      showFailure(t("exports.list.deleteFailed", { name: entry.name }), failure, () => void remove(entry));
      throw failure;
    } finally {
      await queryClient.invalidateQueries({ queryKey: exportKeys.all });
    }
  };

  return (
    <>
      <List label={t("exports.list.label")}>
        {entries.map((entry) => (
          <ExportRow key={entry.id} entry={entry} onRemove={() => setRemoving(entry)} />
        ))}
      </List>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t("exports.list.deleteTitle", { name: removing?.name ?? "" })}
        description={
          removing && isRunning(removing) ? t("exports.list.deleteRunning") : t("exports.list.deleteReady")
        }
        confirmLabel={t("exports.list.deleteConfirm")}
        cancelLabel={t("exports.list.keep")}
        destructive
        onConfirm={async () => {
          if (removing) await remove(removing);
        }}
      />
    </>
  );
}

function ExportRow({ entry, onRemove }: { entry: ExportEntry; onRemove: () => void }) {
  const { t } = useTranslation();
  const format = useFormat();
  const running = isRunning(entry);
  const percent =
    entry.progress.total > 0
      ? Math.min(100, Math.round((entry.progress.done / entry.progress.total) * 100))
      : 0;
  const scope = `${translateKey(t, `exports.formats.${entry.format}`)} · ${
    entry.scope === "space" ? t("exports.list.scopeSpace") : t("exports.list.scopePages")
  }`;
  const details =
    entry.state === "ready" && entry.expiresAt
      ? t("exports.list.readyDetails", {
          size: format.bytes(entry.size ?? 0),
          date: format.dateTime(entry.expiresAt),
        })
      : entry.state === "failed"
        ? translateKey(
            t,
            `exports.errors.${entry.errorCode && ERROR_CODES.has(entry.errorCode) ? entry.errorCode : "internalError"}`,
          )
        : t("exports.list.startedAt", { date: format.dateTime(entry.createdAt) });
  const Glyph = entry.scope === "space" ? FileArchive : FolderTree;
  return (
    <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Glyph aria-hidden="true" className="mt-1 size-icon-md shrink-0 text-text-muted" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2 font-medium text-text">
            <span className="min-w-0 break-words">{entry.name}</span>
            <StateBadge entry={entry} />
          </span>
          <span className="text-sm text-text-muted">{`${scope} · ${details}`}</span>
          {running ? (
            <div
              role="progressbar"
              aria-label={t("exports.list.progress", { name: entry.name })}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className="h-2 overflow-hidden rounded-full bg-surface-sunken"
            >
              <div
                className="h-full bg-accent transition-[width] motion-reduce:transition-none"
                style={{ width: `${percent}%` }}
              />
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2 pl-8 sm:pl-0">
        {entry.state === "ready" && entry.format === "print" ? (
          <Button asChild variant="secondary">
            <Link to="/print" search={{ export: entry.id }}>
              <Printer aria-hidden="true" className="size-icon-md" />
              {t("exports.list.openPrint")}
            </Link>
          </Button>
        ) : null}
        {entry.state === "ready" ? (
          <Button asChild variant="secondary">
            <a href={exportDownloadUrl(entry.id)} download={entry.fileName ?? undefined}>
              <Download aria-hidden="true" className="size-icon-md" />
              {t("exports.list.download")}
            </a>
          </Button>
        ) : null}
        <IconButton
          label={
            running
              ? t("exports.list.cancel", { name: entry.name })
              : t("exports.list.delete", { name: entry.name })
          }
          icon={Trash2}
          onClick={onRemove}
        />
      </div>
    </li>
  );
}

function StateBadge({ entry }: { entry: ExportEntry }) {
  const { t } = useTranslation();
  switch (entry.state) {
    case "queued":
      return <Badge variant="neutral">{t("exports.states.queued")}</Badge>;
    case "running":
      return <Badge variant="info">{t("exports.states.running")}</Badge>;
    case "ready":
      return <Badge variant="success">{t("exports.states.ready")}</Badge>;
    case "failed":
      return <Badge variant="danger">{t("exports.states.failed")}</Badge>;
  }
}
