import { Button, Dialog, Notice, Skeleton } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { Check, Server } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LoadError } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { loadText, storeDrawio, storeImage } from "./diagram-api.js";
import {
  drawioUrl,
  EMPTY_DRAWIO,
  exportMessage,
  loadMessage,
  parseDrawioMessage,
  svgFromDataUrl,
} from "./drawio-protocol.js";
import { DRAWIO_VERSION } from "./drawio-version.js";

const LOAD_TIMEOUT_MS = 60_000;
const EXPORT_TIMEOUT_MS = 30_000;

export interface DrawioAttributes {
  sourceFormat: "drawio";
  sourceId: string;
  sourceVersion: number;
  previewId: string;
  previewVersion: number;
  text: string;
}

export interface DrawioEditorProps {
  pageId: string;
  blockId: string;
  source: { id: string; version: number } | null;
  title: string;
  onSaved: (attributes: DrawioAttributes) => void;
  onClose: () => void;
}

type Phase = "starting" | "ready" | "saving" | "failed" | "gliffyFailed";

export function DrawioEditor({ pageId, blockId, source, title, onSaved, onClose }: DrawioEditorProps) {
  const { t, i18n } = useTranslation();
  const frame = useRef<HTMLIFrameElement>(null);
  const [phase, setPhase] = useState<Phase>("starting");
  const [changed, setChanged] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const exported = useRef<((result: { data: string; xml: string } | null) => void) | null>(null);
  const loaded = useQuery({
    queryKey: ["diagrams", "drawio", pageId, source?.id ?? blockId, source?.version ?? 0],
    queryFn: () => (source ? loadText(source.id, source.version) : Promise.resolve(EMPTY_DRAWIO)),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
  });
  const xml = loaded.data;

  useEffect(() => {
    if (xml === undefined) return;
    const timer = window.setTimeout(
      () => setPhase((current) => (current === "starting" ? "failed" : current)),
      LOAD_TIMEOUT_MS,
    );
    const onMessage = (event: MessageEvent) => {
      const target = frame.current?.contentWindow;
      if (!target || event.source !== target) return;
      const message = parseDrawioMessage(event.data);
      if (!message) return;
      switch (message.event) {
        case "init":
          target.postMessage(loadMessage(xml, title), "*");
          break;
        case "load":
          window.clearTimeout(timer);
          setPhase((current) => (current === "starting" ? "ready" : current));
          break;
        case "autosave":
          setChanged(true);
          break;
        case "pagehall-gliffy-converted":
          setChanged(true);
          break;
        case "pagehall-gliffy-failed":
          window.clearTimeout(timer);
          setPhase("gliffyFailed");
          break;
        case "export":
          exported.current?.({ data: message.data, xml: message.xml });
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    };
  }, [xml, title]);

  const requestExport = () =>
    new Promise<{ data: string; xml: string } | null>((resolve) => {
      const timer = window.setTimeout(() => resolve(null), EXPORT_TIMEOUT_MS);
      exported.current = (result) => {
        window.clearTimeout(timer);
        exported.current = null;
        resolve(result);
      };
      frame.current?.contentWindow?.postMessage(exportMessage(), "*");
    });

  const save = async () => {
    setPhase("saving");
    setFailure(null);
    try {
      const result = await requestExport();
      if (!result) throw new Error("export");
      const stored = await storeDrawio(pageId, blockId, result.xml);
      const image = await storeImage(pageId, blockId, "drawio", svgFromDataUrl(result.data));
      onSaved({ sourceFormat: "drawio", ...image, ...stored, text: stored.text });
      onClose();
    } catch (error) {
      setFailure(
        error instanceof Error && error.message === "export"
          ? t("editor.drawio.exportFailed")
          : problemMessage(t, error),
      );
      setPhase("ready");
    }
  };

  const close = () => {
    if (changed) setConfirming(true);
    else onClose();
  };

  const retry = () => {
    setPhase("starting");
    setChanged(false);
    if (frame.current) frame.current.src = drawioUrl(i18n.language);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={t("editor.drawio.editTitle")}
      description={t("editor.drawio.editDescription", { version: DRAWIO_VERSION })}
      size="full"
      dismissible={false}
      footer={
        confirming ? (
          <>
            <p role="alert" className="mr-auto text-sm text-text">
              {t("editor.drawio.discardDescription")}
            </p>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t("editor.drawio.keepEditing")}
            </Button>
            <Button variant="danger" onClick={onClose}>
              {t("editor.drawio.discard")}
            </Button>
          </>
        ) : (
          <>
            <p role="status" className="mr-auto flex items-center gap-2 text-sm text-text-muted">
              <Server aria-hidden="true" className="size-icon shrink-0" />
              {phase === "starting"
                ? t("editor.drawio.starting", { version: DRAWIO_VERSION })
                : t("editor.drawio.servedLocally", { version: DRAWIO_VERSION })}
            </p>
            <Button variant="secondary" onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              icon={Check}
              loading={phase === "saving"}
              disabled={phase === "starting" || phase === "failed" || phase === "gliffyFailed"}
              onClick={() => void save()}
            >
              {t("editor.drawio.save")}
            </Button>
          </>
        )
      }
    >
      {failure ? (
        <Notice variant="danger" title={t("editor.drawio.saveFailed")}>
          {failure}
        </Notice>
      ) : null}
      {phase === "failed" ? (
        <Notice variant="danger" title={t("editor.drawio.startFailed")}>
          <p>{t("editor.drawio.startFailedHint")}</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={retry}>
            {t("errors.retry")}
          </Button>
        </Notice>
      ) : null}
      {phase === "gliffyFailed" ? (
        <Notice variant="danger" title={t("editor.drawio.gliffyFailed")}>
          {t("editor.drawio.gliffyFailedHint")}
        </Notice>
      ) : null}
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-border">
        {loaded.isError ? (
          <div className="p-4">
            <LoadError
              what={t("editor.drawio.loadFailed")}
              error={loaded.error}
              onRetry={() => loaded.refetch()}
            />
          </div>
        ) : xml !== undefined ? (
          <>
            {phase === "starting" ? <Skeleton className="absolute inset-0" /> : null}
            <iframe
              ref={frame}
              title={t("editor.drawio.frameTitle")}
              src={drawioUrl(i18n.language)}
              sandbox="allow-scripts allow-downloads"
              referrerPolicy="no-referrer"
              className="size-full bg-bg"
            />
          </>
        ) : (
          <Skeleton className="h-full w-full" />
        )}
      </div>
    </Dialog>
  );
}
