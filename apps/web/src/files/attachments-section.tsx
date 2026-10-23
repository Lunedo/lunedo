import { Badge, Button, IconButton, Menu, useToast } from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  Eye,
  File as FileIcon,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  LocateFixed,
  MoreHorizontal,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { type DragEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { LoadError } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { type Attachment, attachmentKeys, attachmentsQuery, contentUrl } from "./attachments-api.js";
import { blockSelector, type DiagramFile, diagramFile, diagramPositions } from "./diagram-files.js";
import { typeLabel } from "./file-preview.js";
import { useAttachmentPreview } from "./preview-host.js";
import { type UploadItem, useUploads } from "./uploads.js";

function kindIcon(preview: Attachment["preview"]) {
  if (preview === "image" || preview === "svg") return FileImage;
  if (preview === "video" || preview === "audio") return FileVideo;
  if (preview === "excel" || preview === "csv") return FileSpreadsheet;
  if (preview === "none") return FileIcon;
  return FileText;
}

export function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

export function PageDropZone({
  enabled,
  title,
  children,
}: {
  enabled: boolean;
  title: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const uploads = useUploads();
  const [active, setActive] = useState(false);
  const depth = useRef(0);
  if (!enabled || !uploads) return <>{children}</>;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: dropping files is an addition to the upload button
    <div
      className="relative flex min-h-full flex-1 flex-col"
      onDragEnter={(event) => {
        if (!hasFiles(event)) return;
        depth.current += 1;
        setActive(true);
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setActive(false);
      }}
      onDragOver={(event) => {
        if (hasFiles(event)) event.preventDefault();
      }}
      onDrop={(event) => {
        depth.current = 0;
        setActive(false);
        if (event.defaultPrevented || !hasFiles(event)) return;
        event.preventDefault();
        uploads.start(Array.from(event.dataTransfer.files));
      }}
    >
      {children}
      {active ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-accent-soft/80"
        >
          <p className="flex items-center gap-2 font-semibold text-accent">
            <Upload className="size-icon-lg" />
            {t("files.dropToAttach", { title })}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function UploadRow({ item }: { item: UploadItem }) {
  const { t } = useTranslation();
  const format = useFormat();
  const uploads = useUploads();
  const percent = item.total > 0 ? Math.round((item.loaded / item.total) * 100) : 0;
  return (
    <li className="flex flex-col gap-2 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Upload aria-hidden="true" className="size-icon-md text-text-muted" />
        <span className="min-w-0 flex-1 truncate font-medium" title={item.file.name}>
          {item.file.name}
        </span>
        <span className="text-sm text-text-muted tabular-nums">
          {item.state === "uploading"
            ? t("files.uploading", { loaded: format.bytes(item.loaded), total: format.bytes(item.total) })
            : format.bytes(item.file.size)}
        </span>
        {item.state === "uploading" ? (
          <IconButton
            label={t("files.cancelUpload", { name: item.file.name })}
            icon={X}
            onClick={() => uploads?.cancel(item.id)}
          />
        ) : null}
        {item.state === "failed" ? (
          <>
            <Button size="sm" variant="secondary" icon={RotateCcw} onClick={() => uploads?.retry(item.id)}>
              {t("files.retry")}
            </Button>
            <IconButton
              label={t("files.dismissUpload", { name: item.file.name })}
              icon={X}
              onClick={() => uploads?.dismiss(item.id)}
            />
          </>
        ) : null}
      </div>
      {item.state === "uploading" ? (
        <div
          role="progressbar"
          aria-label={t("files.progress", { name: item.file.name })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1 overflow-hidden rounded-full bg-surface-sunken"
        >
          <div
            className="h-full bg-accent transition-[width] motion-reduce:transition-none"
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : null}
      {item.state === "failed" ? (
        <p role="alert" className="text-sm text-danger">
          {t("files.uploadFailed", { name: item.file.name, reason: problemMessage(t, item.error) })}
        </p>
      ) : null}
    </li>
  );
}

export function AttachmentsSection({ pageId, canEdit }: { pageId: string; canEdit: boolean }) {
  const { t } = useTranslation();
  const format = useFormat();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const uploads = useUploads();
  const attachments = useQuery({ ...attachmentsQuery(pageId), throwOnError: false });
  const input = useRef<HTMLInputElement>(null);
  const preview = useAttachmentPreview();
  const pending = (uploads?.items ?? []).filter((item) => item.state !== "done");

  const undelete = (attachment: Attachment) =>
    request(() =>
      api.POST("/api/v1/pages/{pageId}/attachments/{attachmentId}/restore", {
        params: { path: { pageId, attachmentId: attachment.id } },
      }),
    )
      .then(() => queryClient.invalidateQueries({ queryKey: attachmentKeys.list(pageId) }))
      .catch((error: unknown) =>
        toast({
          title: t("files.restoreFailed"),
          description: problemMessage(t, error),
          variant: "error",
        }),
      );

  const remove = async (attachment: Attachment) => {
    try {
      await request(() =>
        api.DELETE("/api/v1/attachments/{attachmentId}", {
          params: { path: { attachmentId: attachment.id } },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: attachmentKeys.list(pageId) });
      toast({
        title: t("files.deleted", { name: attachment.name }),
        undo: {
          onUndo: () => void undelete(attachment),
        },
      });
    } catch (error) {
      toast({ title: t("files.deleteFailed"), description: problemMessage(t, error), variant: "error" });
    }
  };

  const all = attachments.data;
  const diagrams = useMemo(
    () =>
      (all ?? []).flatMap((attachment) => {
        const diagram = diagramFile(attachment.name);
        return diagram ? [{ attachment, diagram }] : [];
      }),
    [all],
  );
  const ordinary = (all ?? []).filter((attachment) => diagramFile(attachment.name) === null);
  const [positions, setPositions] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    setPositions(
      diagramPositions(
        diagrams.map(({ diagram }) => diagram),
        document,
      ),
    );
  }, [diagrams]);

  const showInPage = (diagram: DiagramFile) => {
    const block = document.querySelector<HTMLElement>(blockSelector(diagram));
    if (!block) return;
    block.scrollIntoView({ block: "center" });
    block.querySelector<HTMLElement>("button, a, [tabindex]")?.focus();
  };

  const renderRow = (attachment: Attachment, diagram: DiagramFile | null) => {
    const Icon = kindIcon(attachment.preview);
    return (
      <li key={attachment.id} className="flex items-center gap-2 py-2">
        <button
          type="button"
          onClick={() => preview?.open(attachment.id)}
          className="flex min-h-hit min-w-0 flex-1 items-center gap-3 rounded-md px-2 text-start hover:bg-hover focus-visible:focus-ring"
        >
          <Icon aria-hidden="true" className="size-icon-md shrink-0 text-text-muted" />
          <span className="flex min-w-0 flex-col">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate" title={attachment.name}>
                {diagram
                  ? t("files.diagramName", {
                      type: t(`editor.${diagram.kind}.label`),
                      number: positions.get(diagram.blockId) ?? 1,
                      part: diagram.part === "image" ? t("files.diagramImage") : t("files.diagramSource"),
                    })
                  : attachment.name}
              </span>
              {attachment.draft ? (
                <Badge variant="warning">
                  {attachment.draft === "added"
                    ? t("files.draftAdded")
                    : attachment.draft === "deleted"
                      ? t("files.draftDeleted")
                      : t("files.draftChanged")}
                </Badge>
              ) : null}
            </span>
            <span className="truncate text-xs text-text-muted">
              {t("files.rowMeta", {
                type: typeLabel(t, attachment),
                size: format.bytes(attachment.size),
                version: attachment.version,
                date: format.date(attachment.uploadedAt),
              })}
            </span>
          </span>
        </button>
        <Menu
          trigger={
            <IconButton
              label={t("files.actions", { name: attachment.name })}
              icon={MoreHorizontal}
              size="sm"
            />
          }
          items={[
            {
              label: t("files.preview.open"),
              icon: Eye,
              onSelect: () => preview?.open(attachment.id),
            },
            ...(diagram
              ? [{ label: t("files.showDiagram"), icon: LocateFixed, onSelect: () => showInPage(diagram) }]
              : []),
            {
              label: t("files.download"),
              icon: Download,
              onSelect: () => {
                globalThis.location.assign(contentUrl(attachment.id, { download: true }));
              },
            },
            ...(canEdit && attachment.draft === "deleted"
              ? [
                  {
                    label: t("files.undelete"),
                    icon: RotateCcw,
                    onSelect: () => void undelete(attachment),
                  },
                ]
              : canEdit
                ? [
                    { type: "separator" as const },
                    {
                      label: t("files.delete"),
                      icon: Trash2,
                      danger: true,
                      onSelect: () => void remove(attachment),
                    },
                  ]
                : []),
          ]}
        />
      </li>
    );
  };

  if (attachments.isPending) return null;
  if (attachments.isError) {
    return (
      <LoadError
        what={t("files.loadFailed")}
        error={attachments.error}
        onRetry={() => attachments.refetch()}
      />
    );
  }
  const list = attachments.data;
  if (list.length === 0 && pending.length === 0 && !canEdit) return null;

  return (
    <section aria-labelledby={`attachments-${pageId}`} className="mt-10 flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
        <h2 id={`attachments-${pageId}`} className="text-lg font-semibold">
          {t("files.title")}
          {list.length > 0 ? (
            <>
              {" "}
              <span className="ms-1 font-normal text-text-muted tabular-nums">{list.length}</span>
            </>
          ) : null}
        </h2>
        {canEdit ? (
          <>
            <Button variant="outline" size="sm" icon={Upload} onClick={() => input.current?.click()}>
              {t("files.upload")}
            </Button>
            <input
              ref={input}
              type="file"
              multiple
              hidden
              aria-hidden="true"
              tabIndex={-1}
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                if (files.length > 0) uploads?.start(files);
              }}
            />
          </>
        ) : null}
      </div>
      {list.length === 0 && pending.length === 0 ? (
        <p className="py-3 text-sm text-text-muted">{t("files.empty")}</p>
      ) : null}
      {pending.length > 0 ? (
        <ul
          aria-label={t("files.uploads")}
          className="flex flex-col divide-y divide-border border-b border-border"
        >
          {pending.map((item) => (
            <UploadRow key={item.id} item={item} />
          ))}
        </ul>
      ) : null}
      {ordinary.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border border-b border-border">
          {ordinary.map((attachment) => renderRow(attachment, null))}
        </ul>
      ) : null}
      {diagrams.length > 0 ? (
        <>
          <h3 className="mt-2 text-sm font-semibold">{t("files.diagramFiles")}</h3>
          <ul
            aria-label={t("files.diagramFiles")}
            className="flex flex-col divide-y divide-border border-b border-border"
          >
            {diagrams.map(({ attachment, diagram }) => renderRow(attachment, diagram))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
