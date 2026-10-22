import { Skeleton } from "@lunedo/ui";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type FramePreviewKind, isFrameMessage, type RenderMessage } from "../preview/protocol.js";

export const PREVIEW_URL = "/preview.html";

function currentTheme(): "light" | "dark" {
  const theme = document.documentElement.dataset.theme;
  if (theme === "dark" || theme === "light") return theme;
  return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function PreviewFrame({
  kind,
  name,
  bytes,
  onFailed,
  zoom,
  className = "size-full min-h-card",
}: {
  kind: FramePreviewKind;
  name: string;
  bytes: ArrayBuffer;
  onFailed: () => void;
  zoom?: number | undefined;
  className?: string;
}) {
  const { t } = useTranslation();
  const frame = useRef<HTMLIFrameElement>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const target = frame.current?.contentWindow;
      if (!target || event.source !== target || !isFrameMessage(event.data)) return;
      if (event.data.type === "ready") {
        const message: RenderMessage = {
          type: "render",
          kind,
          name,
          bytes: bytes.slice(0),
          theme: currentTheme(),
          ...(zoom === undefined ? {} : { zoom }),
          labels: {
            page: t("files.preview.pageNumber", { number: "{number}" }),
            sheet: t("files.preview.sheet", { name: "{name}" }),
            truncated: t("files.preview.truncated"),
            failed: t("files.preview.failed"),
            empty: t("files.preview.empty"),
          },
        };
        target.postMessage(message, "*");
      } else if (event.data.type === "rendered") {
        setRendered(true);
      } else {
        onFailed();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [bytes, kind, name, onFailed, t, zoom]);

  return (
    <div className={`relative ${className}`}>
      {rendered ? null : <Skeleton className="absolute inset-0" />}
      <iframe
        ref={frame}
        title={t("files.preview.frameTitle", { name })}
        src={PREVIEW_URL}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        className="size-full rounded-md border border-border bg-bg"
      />
    </div>
  );
}
