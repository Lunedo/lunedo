import { Button } from "@pagehall/ui";
import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { Pencil, PenLine } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { contentUrl } from "../../files/attachments-api.js";
import { useEditable, usePageContext } from "../context.js";
import type { PresenceUser } from "../presence.js";

const DrawingEditor = lazy(() =>
  import("../../whiteboards/drawing-editor.js").then((module) => ({ default: module.DrawingEditor })),
);

const openOnInsert = new Set<string>();

export function openDrawingWhenInserted(blockId: string): void {
  openOnInsert.add(blockId);
}

export function useOtherEditors(blockId: string): string[] {
  const context = usePageContext();
  const provider = context?.provider;
  const selfId = context?.self?.id;
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    const awareness = provider?.awareness;
    if (!provider || !awareness) return;
    const update = () => {
      const editing = new Map<string, string>();
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === awareness.clientID) return;
        const user = state.user as PresenceUser | undefined;
        if (state.drawing === blockId && user?.id && user.id !== selfId) editing.set(user.id, user.name);
      });
      setNames([...editing.values()].sort());
    };
    update();
    provider.on("awarenessChange", update);
    return () => {
      provider.off("awarenessChange", update);
    };
  }, [provider, blockId, selfId]);
  return names;
}

export function DrawingView({ node, selected, editor, updateAttributes }: NodeViewProps) {
  const { t } = useTranslation();
  const context = usePageContext();
  const editable = useEditable(editor);
  const blockId = String(node.attrs.id);
  const sceneId = node.attrs.sceneId as string | null;
  const sceneVersion = node.attrs.sceneVersion as number | null;
  const previewId = node.attrs.previewId as string | null;
  const previewVersion = node.attrs.previewVersion as number | null;
  const others = useOtherEditors(blockId);
  const [open, setOpen] = useState(false);
  const busy = others.length > 0;

  useEffect(() => {
    if (editable && openOnInsert.delete(blockId)) setOpen(true);
  }, [editable, blockId]);

  useEffect(() => {
    const provider = context?.provider;
    if (!provider || !open) return;
    provider.setAwarenessField("drawing", blockId);
    return () => provider.setAwarenessField("drawing", null);
  }, [context?.provider, open, blockId]);

  return (
    <NodeViewWrapper
      className={`ph-drawing flex flex-col overflow-hidden rounded-md border border-border bg-surface${selected ? " ph-node-selected" : ""}`}
      contentEditable={false}
      data-drawing-id={blockId}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-sm">
        <PenLine aria-hidden="true" className="size-icon shrink-0 text-text-muted" />
        <span className="font-semibold">{t("editor.drawing.label")}</span>
        <span className="flex-1" />
        {busy ? (
          <span role="status" className="text-text-muted">
            {t("editor.drawing.editedBy", { name: others.join(", "), count: others.length })}
          </span>
        ) : null}
        {editable && !busy ? (
          <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setOpen(true)}>
            {t("editor.drawing.edit")}
          </Button>
        ) : null}
      </div>
      {previewId && previewVersion !== null ? (
        <img
          src={contentUrl(previewId, { version: previewVersion })}
          alt={t("editor.drawing.label")}
          loading="lazy"
          draggable={false}
          className="w-full bg-surface"
        />
      ) : (
        <p className="p-4 text-sm text-text-muted">
          {editable ? t("editor.drawing.empty") : t("editor.drawing.emptyReadOnly")}
        </p>
      )}
      {open && context ? (
        <Suspense fallback={null}>
          <DrawingEditor
            pageId={context.pageId}
            blockId={blockId}
            scene={sceneId && sceneVersion !== null ? { id: sceneId, version: sceneVersion } : null}
            onSaved={(attributes) => updateAttributes(attributes)}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      ) : null}
    </NodeViewWrapper>
  );
}
