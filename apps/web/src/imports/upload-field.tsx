import { Badge, Button, classNames, ErrorState, Icon } from "@pagehall/ui";
import { CheckCircle2, FileArchive, Upload } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { problemMessage } from "../errors/problem-message.js";
import { useFormat } from "../preferences/preferences-provider.js";
import type { ImportView } from "./imports-api.js";
import { createUpload, getUpload, type UploadInfo, type UploadProgress, uploadParts } from "./upload.js";

type Status =
  | { kind: "idle" }
  | { kind: "busy"; progress: UploadProgress }
  | { kind: "failed"; error: unknown }
  | { kind: "tooLarge"; size: number };

export function UploadField({
  organizationId,
  current,
  maxBytes,
  folder,
  onLinked,
  onComplete,
  invalid = false,
}: {
  invalid?: boolean;
  organizationId: string;
  current: ImportView["file"];
  maxBytes: number;
  folder: { enabled: boolean; path: string } | null;
  onLinked: (uploadId: string) => Promise<void>;
  onComplete: (uploadId: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [file, setFile] = useState<File | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const interrupted = current?.kind === "upload" && !current.complete && status.kind === "idle";

  const run = async (chosen: File) => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setFile(chosen);
    if (chosen.size > maxBytes) {
      setStatus({ kind: "tooLarge", size: chosen.size });
      return;
    }
    setStatus({ kind: "busy", progress: { sent: 0, total: chosen.size, phase: "uploading" } });
    try {
      let upload: UploadInfo;
      const resumable =
        current?.kind === "upload" &&
        current.uploadId &&
        !current.complete &&
        current.name === chosen.name &&
        current.size === chosen.size;
      if (resumable && current.uploadId) upload = await getUpload(organizationId, current.uploadId);
      else {
        upload = await createUpload(organizationId, chosen);
        await onLinked(upload.id);
      }
      const done = await uploadParts({
        organizationId,
        file: chosen,
        upload,
        signal: abort.signal,
        onProgress: (progress) => setStatus({ kind: "busy", progress }),
      });
      await onComplete(done.id);
      setStatus({ kind: "idle" });
    } catch (error) {
      if (abort.signal.aborted) return;
      setStatus({ kind: "failed", error });
    }
  };

  const choose = (files: FileList | null) => {
    const chosen = files?.[0];
    if (chosen) void run(chosen);
  };

  const percent = (progress: UploadProgress) =>
    progress.total > 0 ? Math.min(100, Math.round((progress.sent / progress.total) * 100)) : 0;

  return (
    <div className="flex flex-col gap-3">
      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          choose(event.dataTransfer.files);
        }}
        className={classNames(
          "flex cursor-pointer flex-wrap items-center gap-3 rounded-md border-2 border-dashed bg-surface-sunken p-4 focus-within:focus-ring",
          dragging ? "border-accent bg-accent-soft" : invalid ? "border-danger" : "border-border",
        )}
      >
        <Icon icon={Upload} className="text-text-muted" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium">{t("imports.upload.drop")}</span>
          <span id={hintId} className="text-sm text-text-muted">
            {t("imports.upload.hint", { size: format.bytes(maxBytes) })}
          </span>
        </span>
        <span className="font-medium text-accent">{t("imports.upload.choose")}</span>
        <input
          ref={input}
          id={inputId}
          type="file"
          accept=".zip,application/zip"
          aria-describedby={hintId}
          {...(invalid ? { "aria-invalid": true } : {})}
          className="sr-only"
          onChange={(event) => {
            choose(event.target.files);
            event.target.value = "";
          }}
        />
      </label>
      {status.kind === "tooLarge" ? (
        <ErrorState
          title={t("imports.upload.tooLarge", { name: file?.name ?? "" })}
          cause={t("imports.upload.tooLargeCause", {
            size: format.bytes(status.size),
            limit: format.bytes(maxBytes),
          })}
          action={
            folder?.enabled === false
              ? t("imports.upload.tooLargeActionNoFolder", { path: folder.path })
              : t("imports.upload.tooLargeAction", { path: folder?.path ?? "" })
          }
        />
      ) : null}
      {status.kind === "failed" ? (
        <ErrorState
          title={t("imports.upload.failed", { name: file?.name ?? "" })}
          cause={problemMessage(t, status.error)}
          action={t("imports.upload.failedAction")}
          {...(file ? { onRetry: () => void run(file), retryLabel: t("imports.upload.retry") } : {})}
        />
      ) : null}
      {interrupted && current ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-warning p-3">
          <Icon icon={FileArchive} className="text-text-muted" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-medium" title={current.name}>
              {current.name}
            </span>
            <span className="text-sm text-text-muted">{t("imports.upload.interrupted")}</span>
          </div>
          {file && file.name === current.name && file.size === current.size ? (
            <Button variant="secondary" onClick={() => void run(file)}>
              {t("imports.upload.resume")}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => input.current?.click()}>
              {t("imports.upload.chooseAgain")}
            </Button>
          )}
        </div>
      ) : null}
      {status.kind === "busy" ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
          <Icon icon={FileArchive} className="text-text-muted" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate font-medium" title={file?.name}>
              {file?.name}
            </span>
            <span className="text-sm text-text-muted" aria-live="polite">
              {status.progress.phase === "waiting"
                ? t("imports.upload.waiting")
                : status.progress.phase === "checking"
                  ? t("imports.upload.checking")
                  : t("imports.upload.progress", {
                      sent: format.bytes(status.progress.sent),
                      total: format.bytes(status.progress.total),
                    })}
            </span>
            <div
              role="progressbar"
              aria-label={t("imports.upload.progressLabel")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent(status.progress)}
              className="h-1 overflow-hidden rounded-full bg-surface-sunken"
            >
              <div
                className="h-full bg-accent transition-[width] motion-reduce:transition-none"
                style={{ width: `${percent(status.progress)}%` }}
              />
            </div>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              controller.current?.abort();
              setStatus({ kind: "idle" });
            }}
          >
            {t("imports.upload.pause")}
          </Button>
        </div>
      ) : null}
      {status.kind === "idle" && current?.kind === "upload" && current.complete ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
          <Icon icon={FileArchive} className="text-text-muted" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-medium" title={current.name}>
              {current.name}
            </span>
            <span className="text-sm text-text-muted">
              {t("imports.upload.uploaded", { size: format.bytes(current.size ?? 0) })}
            </span>
          </div>
          <Badge variant="success">
            <Icon icon={CheckCircle2} size="sm" />
            {t("imports.upload.done")}
          </Badge>
        </div>
      ) : null}
    </div>
  );
}
