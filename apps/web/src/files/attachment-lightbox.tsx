import { Lightbox, LightboxButton, Skeleton } from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { Download, ExternalLink, File as FileIcon, History, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { LoadError } from "../errors/failure.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { type Attachment, contentUrl } from "./attachments-api.js";
import { attachmentSource, PreviewBody, typeLabel, Versions } from "./file-preview.js";

export function attachmentQuery(attachmentId: string | null) {
  return {
    queryKey: ["attachments", attachmentId],
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/attachments/{attachmentId}", {
          params: { path: { attachmentId: attachmentId ?? "" } },
        }),
      ),
    enabled: attachmentId !== null,
    throwOnError: false,
  };
}

function FileDetails({ attachment }: { attachment: Attachment }) {
  const { t } = useTranslation();
  const format = useFormat();
  return (
    <div className="flex max-w-dialog-sm flex-col items-center gap-3 rounded-lg bg-surface p-6 text-center text-text">
      <FileIcon aria-hidden="true" className="size-control-lg text-text-muted" />
      <p className="font-semibold wrap-anywhere">{attachment.name}</p>
      <p className="text-sm text-text-muted">
        {t("files.lightbox.details", {
          type: typeLabel(t, attachment),
          size: format.bytes(attachment.size),
          name: attachment.uploadedBy?.name ?? t("files.someone"),
          date: format.dateTime(attachment.uploadedAt),
        })}
      </p>
      <a
        href={contentUrl(attachment.id, { download: true })}
        download={attachment.name}
        className="inline-flex min-h-hit items-center gap-2 rounded-md border border-border px-3 font-medium hover:bg-hover focus-visible:focus-ring"
      >
        <Download aria-hidden="true" className="size-icon-md" />
        {t("files.download")}
      </a>
    </div>
  );
}

function Stage({ attachment, zoomed }: { attachment: Attachment; zoomed: boolean }) {
  const source = attachmentSource(attachment.id);
  if (attachment.preview === "image" && !attachment.tooLargeForPreview) {
    return (
      <img
        src={source.url(attachment.version)}
        alt={attachment.name}
        className={zoomed ? "max-w-none" : "max-h-full max-w-full object-contain"}
      />
    );
  }
  if (attachment.preview === "none") return <FileDetails attachment={attachment} />;
  return (
    <div className="flex h-full w-full max-w-dialog-xl flex-col overflow-auto rounded-md bg-surface p-4 text-text">
      <PreviewBody attachment={attachment} source={source} frame={{ className: "h-full" }} />
    </div>
  );
}

export function AttachmentLightbox({
  ids,
  index,
  canEdit,
  onIndexChange,
  onClose,
}: {
  ids: readonly string[];
  index: number;
  canEdit: boolean;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const current = ids[index] ?? null;
  const attachment = useQuery(attachmentQuery(current));
  const [zoomed, setZoomed] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  useEffect(() => {
    setZoomed(false);
  }, []);
  const data = attachment.data && attachment.data.id === current ? attachment.data : null;
  const image = data?.preview === "image" && !data.tooLargeForPreview;
  const several = ids.length > 1;
  return (
    <Lightbox
      open={current !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={data?.name ?? t("files.preview.open")}
      previousLabel={t("files.lightbox.previous")}
      nextLabel={t("files.lightbox.next")}
      onPrevious={several ? () => onIndexChange((index - 1 + ids.length) % ids.length) : undefined}
      onNext={several ? () => onIndexChange((index + 1) % ids.length) : undefined}
      footer={several ? t("files.lightbox.position", { number: index + 1, count: ids.length }) : undefined}
      actions={
        data ? (
          <>
            {image ? (
              <LightboxButton
                label={zoomed ? t("files.lightbox.fit") : t("files.lightbox.zoom")}
                icon={
                  zoomed ? (
                    <ZoomOut aria-hidden="true" className="size-icon-lg" />
                  ) : (
                    <ZoomIn aria-hidden="true" className="size-icon-lg" />
                  )
                }
                pressed={zoomed}
                onClick={() => setZoomed((value) => !value)}
              />
            ) : null}
            {data.versions > 1 || canEdit ? (
              <LightboxButton
                label={t("files.versions.show", { count: data.versions })}
                icon={<History aria-hidden="true" className="size-icon-lg" />}
                pressed={showVersions}
                onClick={() => setShowVersions((value) => !value)}
              />
            ) : null}
            <LightboxButton
              label={t("files.download")}
              icon={<Download aria-hidden="true" className="size-icon-lg" />}
              href={contentUrl(data.id, { download: true })}
              download={data.name}
            />
            <LightboxButton
              label={t("files.lightbox.newTab")}
              icon={<ExternalLink aria-hidden="true" className="size-icon-lg" />}
              href={contentUrl(data.id, {})}
            />
          </>
        ) : null
      }
      aside={
        data && showVersions ? (
          <div className="w-card max-w-full overflow-y-auto bg-surface p-4 text-text">
            <Versions attachment={data} canEdit={canEdit} />
          </div>
        ) : null
      }
    >
      {attachment.isError ? (
        <div className="rounded-md bg-surface p-4 text-text">
          <LoadError
            what={t("files.preview.fileFailed")}
            error={attachment.error}
            onRetry={() => void attachment.refetch()}
          />
        </div>
      ) : data ? (
        <Stage attachment={data} zoomed={zoomed} />
      ) : (
        <Skeleton className="h-card w-card" />
      )}
    </Lightbox>
  );
}
