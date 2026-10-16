import { emptyScene, type Scene, validateScene } from "@pagehall/editor-schema/scene";
import { Button, Dialog, Notice, Skeleton } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LoadError } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { contentUrl, fetchBytes } from "../files/attachments-api.js";
import { type BoardHandle, ExcalidrawBoard } from "./excalidraw-board.js";
import type { FileStore } from "./scene-sync.js";
import { loadImage, putBytes, uploadImage } from "./whiteboard-api.js";

export interface DrawingAttributes {
  sceneId: string;
  sceneVersion: number;
  previewId: string;
  previewVersion: number;
  text: string;
}

export interface DrawingEditorProps {
  pageId: string;
  blockId: string;
  scene: { id: string; version: number } | null;
  onSaved: (attributes: DrawingAttributes) => void;
  onClose: () => void;
}

async function loadScene(scene: { id: string; version: number } | null): Promise<Scene> {
  if (!scene) return emptyScene();
  const bytes = await fetchBytes(contentUrl(scene.id, { version: scene.version }));
  const validation = validateScene(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
  if (!validation.ok) throw new Error("The stored drawing is not valid");
  return validation.scene;
}

export function DrawingEditor({ pageId, blockId, scene, onSaved, onClose }: DrawingEditorProps) {
  const { t } = useTranslation();
  const loaded = useQuery({
    queryKey: ["drawings", pageId, scene?.id ?? blockId, scene?.version ?? 0],
    queryFn: () => loadScene(scene),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
  });
  const handle = useRef<BoardHandle | null>(null);
  const initialVersion = useRef<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const files = useMemo<FileStore>(
    () => ({
      upload: (file) => uploadImage(pageId, file),
      load: (attachmentId, mimeType) => loadImage(attachmentId, mimeType),
    }),
    [pageId],
  );

  const changed = () => {
    const current = handle.current?.version();
    return current !== undefined && initialVersion.current !== null && current !== initialVersion.current;
  };

  const close = () => {
    if (changed()) setConfirming(true);
    else onClose();
  };

  const save = async () => {
    const board = handle.current;
    if (!board) return;
    setSaving(true);
    setFailure(null);
    try {
      const next = await board.sceneForSaving(async (file) => ({
        attachmentId: await uploadImage(pageId, file),
        mimeType: file.mimeType as Scene["files"][string]["mimeType"],
      }));
      const stored = await putBytes<{ sceneId: string; sceneVersion: number; text: string }>(
        `/api/v1/pages/${pageId}/drawings/${blockId}/scene`,
        new Blob([JSON.stringify(next)], { type: "application/json" }),
      );
      const svg = await board.exportSvg();
      const preview = await putBytes<{ previewId: string; previewVersion: number }>(
        `/api/v1/pages/${pageId}/drawings/${blockId}/preview`,
        new Blob([svg], { type: "image/svg+xml" }),
      );
      onSaved({ ...stored, ...preview });
      onClose();
    } catch (error) {
      setFailure(problemMessage(t, error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={t("editor.drawing.editTitle")}
      description={t("editor.drawing.editDescription")}
      size="full"
      dismissible={false}
      footer={
        confirming ? (
          <>
            <p role="alert" className="mr-auto text-sm text-text">
              {t("editor.drawing.discardDescription")}
            </p>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t("editor.drawing.keepEditing")}
            </Button>
            <Button variant="danger" onClick={onClose}>
              {t("editor.drawing.discard")}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" icon={Check} loading={saving} onClick={() => void save()}>
              {t("editor.drawing.save")}
            </Button>
          </>
        )
      }
    >
      {failure ? (
        <Notice variant="danger" title={t("editor.drawing.saveFailed")}>
          {failure}
        </Notice>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
        {loaded.isError ? (
          <div className="p-4">
            <LoadError
              what={t("editor.drawing.loadFailed")}
              error={loaded.error}
              onRetry={() => loaded.refetch()}
            />
          </div>
        ) : loaded.data ? (
          <ExcalidrawBoard
            scene={loaded.data}
            editable
            files={files}
            name={t("editor.drawing.label")}
            onReady={(ready) => {
              handle.current = ready;
              initialVersion.current ??= ready.version();
            }}
          />
        ) : (
          <Skeleton className="h-full w-full" />
        )}
      </div>
    </Dialog>
  );
}
