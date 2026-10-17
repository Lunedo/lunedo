import { EMBED_ALLOW, EMBED_SANDBOX, type EmbedService } from "@pagehall/editor-schema";
import { Skeleton } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Presentation } from "lucide-react";
import { type CSSProperties, type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { LoadError } from "../errors/failure.js";
import { attachmentSource, PreviewBody } from "../files/file-preview.js";
import { useCurrentOrganizationId } from "../shell/shell-context.js";
import { previewUrl } from "../whiteboards/whiteboard-api.js";
import { useOpenPath } from "./context.js";
import { notFound } from "./includes.js";

export const DEFAULT_EMBED_HEIGHT = 420;
export const DEFAULT_PREVIEW_HEIGHT = 480;

export interface EmbedOverview {
  services: EmbedService[];
  available: EmbedService[];
  narrowed: boolean;
}

export function embedServicesQuery(organizationId: string | null) {
  return {
    queryKey: ["organizations", organizationId, "embed-services"],
    enabled: organizationId !== null,
    staleTime: 60_000,
    queryFn: async (): Promise<EmbedOverview> =>
      (await request(() =>
        api.GET("/api/v1/organizations/{organizationId}/embed-services", {
          params: { path: { organizationId: organizationId ?? "" } },
        }),
      )) as EmbedOverview,
  };
}

export function useEmbedServices(): readonly EmbedService[] | null {
  const organizationId = useCurrentOrganizationId();
  const services = useQuery({ ...embedServicesQuery(organizationId), throwOnError: false });
  return services.data?.services ?? null;
}

export function useVisible<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const target = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = target.current;
    if (!element || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);
  return [target, visible];
}

function heightStyle(name: string, height: number | null, fallback: number): CSSProperties {
  return { [name]: `${height ?? fallback}px` } as CSSProperties;
}

export function EmbedFrame({ src, title, height }: { src: string; title: string; height: number | null }) {
  const { t } = useTranslation();
  const [target, visible] = useVisible<HTMLDivElement>();
  return (
    <div
      ref={target}
      className="ph-embed-box"
      style={heightStyle("--embed-height", height, DEFAULT_EMBED_HEIGHT)}
      data-loaded={visible ? "true" : "false"}
    >
      {visible ? (
        <iframe
          src={src}
          title={title}
          sandbox={EMBED_SANDBOX}
          allow={EMBED_ALLOW}
          referrerPolicy="no-referrer"
          loading="lazy"
          allowFullScreen
          className="size-full rounded-md border border-border bg-surface-sunken"
        />
      ) : (
        <p className="flex size-full items-center justify-center rounded-md border border-border bg-surface-sunken p-4 text-center text-sm text-text-muted">
          {t("editor.embed.loadsWhenVisible")}
        </p>
      )}
    </div>
  );
}

export function attachmentQuery(attachmentId: string, enabled = true) {
  return {
    queryKey: ["attachments", attachmentId],
    enabled,
    retry: (count: number, error: unknown) => !notFound(error) && count < 2,
    queryFn: () =>
      request(() => api.GET("/api/v1/attachments/{attachmentId}", { params: { path: { attachmentId } } })),
  };
}

export function InlineFilePreview({
  attachmentId,
  height,
  zoom,
  placeholders = false,
  onHidden,
}: {
  attachmentId: string;
  height: number | null;
  zoom: number | null;
  placeholders?: boolean;
  onHidden?: () => void;
}) {
  const { t } = useTranslation();
  const [target, visible] = useVisible<HTMLDivElement>();
  const attachment = useQuery({ ...attachmentQuery(attachmentId, visible), throwOnError: false });
  const hidden = attachment.isError && notFound(attachment.error);
  useEffect(() => {
    if (hidden && !placeholders) onHidden?.();
  }, [hidden, placeholders, onHidden]);
  if (hidden) {
    return placeholders ? (
      <p className="text-sm text-text-muted">{t("editor.filePreview.restricted")}</p>
    ) : null;
  }
  if (attachment.data?.preview === "none") {
    return placeholders ? <p className="text-sm text-text-muted">{t("editor.filePreview.none")}</p> : null;
  }
  let body: ReactNode = <Skeleton className="size-full" />;
  if (attachment.isError) {
    body = (
      <LoadError
        what={t("editor.filePreview.loadFailed")}
        error={attachment.error}
        onRetry={() => void attachment.refetch()}
      />
    );
  } else if (attachment.data) {
    body = (
      <PreviewBody
        attachment={attachment.data}
        source={attachmentSource(attachmentId)}
        frame={{ zoom: zoom ?? undefined, className: "h-full" }}
      />
    );
  }
  return (
    <div
      ref={target}
      className="ph-file-preview-box"
      style={heightStyle("--preview-height", height, DEFAULT_PREVIEW_HEIGHT)}
    >
      {body}
    </div>
  );
}

export function whiteboardReferenceQuery(whiteboardId: string) {
  return {
    queryKey: ["whiteboards", whiteboardId, "reference"],
    retry: (count: number, error: unknown) => !notFound(error) && count < 2,
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/whiteboards/{itemId}/reference", { params: { path: { itemId: whiteboardId } } }),
      ),
  };
}

export function WhiteboardBlock({
  whiteboardId,
  placeholders = false,
}: {
  whiteboardId: string | null;
  placeholders?: boolean;
}) {
  const { t } = useTranslation();
  const open = useOpenPath();
  const board = useQuery({
    ...whiteboardReferenceQuery(whiteboardId ?? ""),
    enabled: whiteboardId !== null,
    throwOnError: false,
  });
  const note = (text: string) => <p className="text-sm text-text-muted">{text}</p>;
  if (whiteboardId === null) return placeholders ? note(t("editor.whiteboard.choose")) : null;
  if (board.isPending) return <Skeleton className="h-card w-full" />;
  if (board.isError) {
    if (notFound(board.error)) return placeholders ? note(t("editor.readView.restrictedContent")) : null;
    return (
      <LoadError
        what={t("editor.whiteboard.loadFailed")}
        error={board.error}
        onRetry={() => void board.refetch()}
      />
    );
  }
  const { href, title, preview } = board.data;
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    open(href);
  };
  return (
    <a
      href={href}
      onClick={follow}
      className="ph-whiteboard-card flex flex-col gap-2 rounded-md border border-border p-2 hover:bg-hover focus-visible:focus-ring"
    >
      {preview ? (
        <img
          src={previewUrl(whiteboardId)}
          alt=""
          loading="lazy"
          className="max-h-card w-full object-contain"
        />
      ) : (
        <span className="flex h-card items-center justify-center rounded-sm bg-surface-sunken text-text-muted">
          <Presentation aria-hidden="true" className="size-icon-lg" />
        </span>
      )}
      <span className="flex min-w-0 items-center gap-2 font-medium">
        <span className="truncate" title={title}>
          {title || t("editor.whiteboard.label")}
        </span>
        <ExternalLink aria-hidden="true" className="size-icon shrink-0 text-text-muted" />
        <span className="sr-only">{t("editor.whiteboard.open")}</span>
      </span>
    </a>
  );
}
