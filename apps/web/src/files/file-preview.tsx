import { Badge, Button, Drawer, EmptyState, Notice, Skeleton, useToast } from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { Download, FileQuestion, History, Pin, PinOff, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { LoadError } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { translateKey } from "../i18n/translate.js";
import { useFormat } from "../preferences/preferences-provider.js";
import type { FramePreviewKind } from "../preview/protocol.js";
import {
  type Attachment,
  attachmentKeys,
  contentUrl,
  fetchBytes,
  type PreviewKind,
  versionsQuery,
} from "./attachments-api.js";
import { PreviewFrame } from "./preview-frame.js";

const FRAME_LIMITS: Record<FramePreviewKind, number> = {
  pdf: 100 * 1024 * 1024,
  text: 5 * 1024 * 1024,
  code: 5 * 1024 * 1024,
  markdown: 5 * 1024 * 1024,
  csv: 20 * 1024 * 1024,
  svg: 5 * 1024 * 1024,
  word: 50 * 1024 * 1024,
  excel: 50 * 1024 * 1024,
};

export interface PreviewSource {
  url: (version?: number) => string;
  downloadUrl: (version?: number) => string;
}

export function attachmentSource(attachmentId: string): PreviewSource {
  return {
    url: (version) => contentUrl(attachmentId, version === undefined ? {} : { version }),
    downloadUrl: (version) =>
      contentUrl(attachmentId, { download: true, ...(version === undefined ? {} : { version }) }),
  };
}

function isFrameKind(kind: PreviewKind): kind is FramePreviewKind {
  return kind in FRAME_LIMITS;
}

export function typeLabel(t: TFunction, attachment: Pick<Attachment, "name" | "preview">) {
  const extension = /\.([A-Za-z0-9]{1,8})$/.exec(attachment.name)?.[1]?.toUpperCase();
  const kind = translateKey(t, `files.kinds.${attachment.preview}`);
  return extension ? t("files.typeWithExtension", { kind, extension }) : kind;
}

function FramedPreview({
  attachment,
  source,
  frame,
}: {
  attachment: Pick<Attachment, "name" | "preview" | "size" | "version">;
  source: PreviewSource;
  frame?: FrameOptions | undefined;
}) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const kind = attachment.preview as FramePreviewKind;
  const bytes = useQuery({
    queryKey: ["preview", source.url(attachment.version)],
    queryFn: ({ signal }) => fetchBytes(source.url(attachment.version), signal),
    staleTime: 0,
    gcTime: 0,
  });
  const onFailed = useCallback(() => setFailed(true), []);
  if (attachment.size > FRAME_LIMITS[kind]) {
    return (
      <Notice variant="info" title={t("files.preview.tooLargeTitle")}>
        {t("files.preview.tooLarge")}
      </Notice>
    );
  }
  if (bytes.isPending) return <Skeleton className="h-card w-full" />;
  if (bytes.isError) {
    return (
      <LoadError what={t("files.preview.loadFailed")} error={bytes.error} onRetry={() => bytes.refetch()} />
    );
  }
  if (failed) {
    return (
      <Notice variant="warning" title={t("files.preview.failedTitle")}>
        {t("files.preview.failedDescription")}
      </Notice>
    );
  }
  return (
    <PreviewFrame
      kind={kind}
      name={attachment.name}
      bytes={bytes.data}
      onFailed={onFailed}
      zoom={frame?.zoom}
      {...(frame?.className ? { className: frame.className } : {})}
    />
  );
}

export interface FrameOptions {
  zoom?: number | undefined;
  className?: string;
}

export function PreviewBody({
  attachment,
  source,
  frame,
}: {
  attachment: Pick<Attachment, "name" | "preview" | "size" | "inline" | "version">;
  source: PreviewSource;
  frame?: FrameOptions;
}) {
  const { t } = useTranslation();
  switch (attachment.preview) {
    case "image":
      return (
        <img
          src={source.url(attachment.version)}
          alt={attachment.name}
          className="mx-auto max-h-card max-w-full rounded-md"
        />
      );
    case "video":
      return (
        // biome-ignore lint/a11y/useMediaCaption: uploaded videos come without caption tracks
        <video
          src={source.url(attachment.version)}
          controls
          preload="metadata"
          className="w-full rounded-md"
        />
      );
    case "audio":
      return (
        // biome-ignore lint/a11y/useMediaCaption: uploaded audio comes without caption tracks
        <audio src={source.url(attachment.version)} controls preload="metadata" className="w-full" />
      );
    default:
      if (isFrameKind(attachment.preview)) {
        return <FramedPreview attachment={attachment} source={source} frame={frame} />;
      }
      return (
        <EmptyState
          icon={FileQuestion}
          title={t("files.preview.noneTitle")}
          description={t("files.preview.none")}
          action={
            <a href={source.downloadUrl()} className="text-accent underline" download={attachment.name}>
              {t("files.download")}
            </a>
          }
        />
      );
  }
}

function Versions({ attachment, canEdit }: { attachment: Attachment; canEdit: boolean }) {
  const { t } = useTranslation();
  const format = useFormat();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const versions = useQuery(versionsQuery(attachment.id));
  const [restoring, setRestoring] = useState<number | null>(null);
  const [keeping, setKeeping] = useState<number | null>(null);
  if (versions.isPending) return <Skeleton className="h-12 w-full" />;
  if (versions.isError) {
    return (
      <LoadError
        what={t("files.versions.loadFailed")}
        error={versions.error}
        onRetry={() => versions.refetch()}
      />
    );
  }
  const restore = async (number: number) => {
    setRestoring(number);
    try {
      await request(() =>
        api.POST("/api/v1/attachments/{attachmentId}/versions/{number}/restore", {
          params: { path: { attachmentId: attachment.id, number } },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: attachmentKeys.versions(attachment.id) });
      await queryClient.invalidateQueries({ queryKey: attachmentKeys.list(attachment.itemId) });
      await queryClient.invalidateQueries({ queryKey: ["attachments", attachment.id] });
      toast({ title: t("files.versions.restored", { number }), variant: "success" });
    } catch (error) {
      toast({
        title: t("files.versions.restoreFailed"),
        description: problemMessage(t, error),
        variant: "error",
      });
    } finally {
      setRestoring(null);
    }
  };
  const keep = async (number: number, kept: boolean) => {
    setKeeping(number);
    try {
      await request(() =>
        api.PUT("/api/v1/attachments/{attachmentId}/versions/{number}/keep", {
          params: { path: { attachmentId: attachment.id, number } },
          body: { kept },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: attachmentKeys.versions(attachment.id) });
      toast({
        title: kept ? t("files.versions.keptDone", { number }) : t("files.versions.releasedDone", { number }),
        variant: "success",
      });
    } catch (error) {
      toast({
        title: kept ? t("files.versions.keepFailed") : t("files.versions.releaseFailed"),
        description: problemMessage(t, error),
        variant: "error",
      });
    } finally {
      setKeeping(null);
    }
  };
  return (
    <section aria-labelledby="attachment-versions" className="flex flex-col gap-2">
      <h3 id="attachment-versions" className="font-semibold">
        {t("files.versions.title")}
      </h3>
      {canEdit ? <p className="text-sm text-text-muted">{t("files.versions.keepHint")}</p> : null}
      <ul className="flex flex-col divide-y divide-border">
        {versions.data.map((version) => (
          <li key={version.id} className="flex flex-wrap items-center gap-2 py-2">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                <span>
                  {t("files.versions.number", { number: version.number })}
                  {version.number === attachment.version ? ` · ${t("files.versions.current")}` : ""}
                </span>
                {version.kept ? (
                  <Badge variant="accent" icon={Pin}>
                    {t("files.versions.kept")}
                  </Badge>
                ) : null}
              </p>
              <p className="text-sm text-text-muted">
                {t("files.versions.meta", {
                  date: format.dateTime(version.uploadedAt),
                  size: format.bytes(version.size),
                  name: version.uploadedBy?.name ?? t("files.someone"),
                })}
                {version.restoredFrom
                  ? ` · ${t("files.versions.restoredFrom", { number: version.restoredFrom })}`
                  : ""}
              </p>
            </div>
            <a
              href={contentUrl(attachment.id, { version: version.number, download: true })}
              className="inline-flex min-h-hit items-center gap-1 text-accent underline"
              download={version.name}
            >
              <Download aria-hidden="true" className="size-icon" />
              {t("files.download")}
            </a>
            {canEdit ? (
              <Button
                size="sm"
                variant="secondary"
                icon={version.kept ? PinOff : Pin}
                loading={keeping === version.number}
                onClick={() => void keep(version.number, !version.kept)}
              >
                {version.kept ? t("files.versions.release") : t("files.versions.keep")}
              </Button>
            ) : null}
            {canEdit && version.number !== attachment.version ? (
              <Button
                size="sm"
                variant="secondary"
                icon={RotateCcw}
                loading={restoring === version.number}
                onClick={() => void restore(version.number)}
              >
                {t("files.versions.restore")}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FilePreviewDrawer({
  open,
  attachment,
  error = null,
  onRetry,
  canEdit,
  onClose,
}: {
  open: boolean;
  attachment: Attachment | null;
  error?: unknown;
  onRetry?: () => void;
  canEdit: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const [showVersions, setShowVersions] = useState(false);
  useEffect(() => {
    if (!open) setShowVersions(false);
  }, [open]);
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={attachment?.name ?? t("files.preview.open")}
      size="panel"
    >
      <div className="flex flex-col gap-4 p-4">
        {error ? (
          <LoadError what={t("files.preview.fileFailed")} error={error} onRetry={() => onRetry?.()} />
        ) : null}
        {!attachment && !error ? <Skeleton className="h-card w-full" /> : null}
        {attachment ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-muted">
              {t("files.summary", {
                type: typeLabel(t, attachment),
                size: format.bytes(attachment.size),
                version: attachment.version,
              })}
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href={contentUrl(attachment.id, { download: true })}
                download={attachment.name}
                className="inline-flex min-h-hit items-center gap-2 rounded-md border border-border px-3 font-medium hover:bg-hover focus-visible:focus-ring"
              >
                <Download aria-hidden="true" className="size-icon" />
                {t("files.download")}
              </a>
              {attachment.versions > 1 || canEdit ? (
                <Button variant="secondary" icon={History} onClick={() => setShowVersions((value) => !value)}>
                  {showVersions
                    ? t("files.versions.hide")
                    : t("files.versions.show", { count: attachment.versions })}
                </Button>
              ) : null}
            </div>
            {showVersions ? <Versions attachment={attachment} canEdit={canEdit} /> : null}
            <PreviewBody attachment={attachment} source={attachmentSource(attachment.id)} />
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}
