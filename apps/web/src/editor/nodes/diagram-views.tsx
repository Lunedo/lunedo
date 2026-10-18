import { Button, Notice, SegmentedControl, Textarea } from "@pagehall/ui";
import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { Check, Network, Pencil, Workflow } from "lucide-react";
import { lazy, type ReactNode, Suspense, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TextDiagram } from "../../diagram-frame/protocol.js";
import { storeImage } from "../../diagrams/diagram-api.js";
import { ReferencedDiagram } from "../../diagrams/referenced-diagram.js";
import { type RenderResult, textDiagramRenderer } from "../../diagrams/text-renderer.js";
import { problemMessage } from "../../errors/problem-message.js";
import { useAttachmentUrl } from "../../files/attachment-source.js";
import { translateKey } from "../../i18n/translate.js";
import { useEditable, usePageContext } from "../context.js";
import { useOtherEditors } from "./drawing-view.js";

const DrawioEditor = lazy(() =>
  import("../../diagrams/drawio-editor.js").then((module) => ({ default: module.DrawioEditor })),
);

const PREVIEW_DELAY_MS = 600;
const openOnInsert = new Set<string>();

export function openDiagramWhenInserted(blockId: string): void {
  openOnInsert.add(blockId);
}

export const DIAGRAM_STARTERS: Readonly<Record<TextDiagram, string>> = {
  mermaid: "flowchart LR\n  A[Start] --> B[Done]",
  plantuml: "@startuml\nAlice -> Bob: Hello\n@enduml",
};

function useEditingPresence(blockId: string, editing: boolean): void {
  const context = usePageContext();
  useEffect(() => {
    const provider = context?.provider;
    if (!provider || !editing) return;
    provider.setAwarenessField("drawing", blockId);
    return () => provider.setAwarenessField("drawing", null);
  }, [context?.provider, editing, blockId]);
}

function useOpenOnInsert(blockId: string, editable: boolean, open: () => void): void {
  const opened = useRef(false);
  useEffect(() => {
    if (!opened.current && editable && openOnInsert.delete(blockId)) {
      opened.current = true;
      open();
    }
  }, [editable, blockId, open]);
}

function DiagramHeader({
  icon: Icon,
  label,
  others,
  children,
}: {
  icon: typeof Network;
  label: string;
  others: string[];
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-sm">
      <Icon aria-hidden="true" className="size-icon shrink-0 text-text-muted" />
      <span className="font-semibold">{label}</span>
      <span className="flex-1" />
      {others.length > 0 ? (
        <span role="status" className="text-text-muted">
          {t("editor.diagram.editedBy", { name: others.join(", "), count: others.length })}
        </span>
      ) : null}
      {children}
    </div>
  );
}

function StoredImage({ id, version, label }: { id: string; version: number; label: string }) {
  const attachmentUrl = useAttachmentUrl();
  return (
    <img
      src={attachmentUrl(id, version)}
      alt={label}
      loading="lazy"
      draggable={false}
      className="mx-auto max-w-full bg-surface"
    />
  );
}

export function DrawioView({ node, selected, editor, updateAttributes }: NodeViewProps) {
  const { t } = useTranslation();
  const context = usePageContext();
  const editable = useEditable(editor);
  const blockId = String(node.attrs.id);
  const sourceId = node.attrs.sourceId as string | null;
  const sourceVersion = node.attrs.sourceVersion as number | null;
  const previewId = node.attrs.previewId as string | null;
  const previewVersion = node.attrs.previewVersion as number | null;
  const gliffy = node.attrs.sourceFormat === "gliffy";
  const others = useOtherEditors(blockId);
  const [open, setOpen] = useState(false);
  const busy = others.length > 0;
  const label = t("editor.drawio.label");
  useOpenOnInsert(blockId, editable, () => setOpen(true));
  useEditingPresence(blockId, open);

  return (
    <NodeViewWrapper
      className={`ph-diagram flex flex-col overflow-hidden rounded-md border border-border bg-surface${selected ? " ph-node-selected" : ""}`}
      contentEditable={false}
      data-diagram="drawio"
      data-diagram-id={blockId}
    >
      <DiagramHeader icon={Network} label={label} others={others}>
        {sourceVersion !== null ? (
          <span className="text-text-muted">{t("editor.drawio.version", { version: sourceVersion })}</span>
        ) : null}
        {editable && !busy ? (
          <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setOpen(true)}>
            {t("editor.drawio.edit")}
          </Button>
        ) : null}
      </DiagramHeader>
      {gliffy && editable ? (
        <p className="border-b border-border px-3 py-2 text-sm text-text-muted">
          {t("editor.drawio.gliffyNote")}
        </p>
      ) : null}
      {editable && sourceId === null && previewId !== null ? (
        <p className="border-b border-border px-3 py-2 text-sm text-text-muted">
          {t("editor.drawio.fileMissing")}
        </p>
      ) : null}
      {previewId && previewVersion !== null ? (
        <StoredImage id={previewId} version={previewVersion} label={label} />
      ) : (
        <p className="p-4 text-sm text-text-muted">
          {editable ? t("editor.drawio.empty") : t("editor.drawio.emptyReadOnly")}
        </p>
      )}
      {open && context ? (
        <Suspense fallback={null}>
          <DrawioEditor
            pageId={context.pageId}
            blockId={blockId}
            source={sourceId && sourceVersion !== null ? { id: sourceId, version: sourceVersion } : null}
            title={label}
            onSaved={(attributes) => updateAttributes(attributes)}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      ) : null}
    </NodeViewWrapper>
  );
}

export function DrawioReferenceView({ node, selected }: NodeViewProps) {
  return (
    <NodeViewWrapper
      className={`ph-diagram flex flex-col overflow-hidden rounded-md border border-border bg-surface${selected ? " ph-node-selected" : ""}`}
      contentEditable={false}
      data-diagram="drawioReference"
    >
      <ReferencedDiagram
        pageId={(node.attrs.pageId as string | null) ?? null}
        diagramId={(node.attrs.diagramId as string | null) ?? null}
        name={String(node.attrs.name ?? "")}
      />
    </NodeViewWrapper>
  );
}

function renderFailure(t: ReturnType<typeof useTranslation>["t"], result: RenderResult): string | null {
  if (result.ok) return null;
  return translateKey(t, `editor.diagram.failures.${result.reason}`, { detail: result.detail });
}

function svgUrl(svg: string): string {
  return URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
}

function LivePreview({ svg, label }: { svg: string; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = svgUrl(svg);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [svg]);
  return url ? <img src={url} alt={label} className="mx-auto max-w-full" /> : null;
}

export function TextDiagramView({ node, selected, editor, updateAttributes }: NodeViewProps) {
  const { t } = useTranslation();
  const context = usePageContext();
  const editable = useEditable(editor);
  const type = node.type.name as TextDiagram;
  const blockId = String(node.attrs.id);
  const stored = String(node.attrs.source ?? "");
  const previewId = node.attrs.previewId as string | null;
  const previewVersion = node.attrs.previewVersion as number | null;
  const others = useOtherEditors(blockId);
  const busy = others.length > 0;
  const label = t(`editor.${type}.label`);
  const sourceId = useId();
  const errorId = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [view, setView] = useState<"preview" | "source">("preview");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(stored);
  const [rendered, setRendered] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useEditingPresence(blockId, editing);
  useOpenOnInsert(blockId, editable, () => {
    setDraft(stored.length > 0 ? stored : DIAGRAM_STARTERS[type]);
    setEditing(true);
  });

  useEffect(() => {
    if (!editing) return;
    let current = true;
    const timer = window.setTimeout(() => {
      void textDiagramRenderer()
        .render(type, draft)
        .then((result) => {
          if (!current) return;
          if (result.ok) {
            setRendered(result.svg);
            setProblem(null);
          } else {
            setProblem(renderFailure(t, result));
          }
        });
    }, PREVIEW_DELAY_MS);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [editing, draft, type, t]);

  const start = () => {
    setDraft(stored.length > 0 ? stored : DIAGRAM_STARTERS[type]);
    setRendered(null);
    setProblem(null);
    setFailure(null);
    setEditing(true);
  };

  const save = async () => {
    if (!context) return;
    setSaving(true);
    setFailure(null);
    try {
      const result = await textDiagramRenderer().render(type, draft);
      if (!result.ok) {
        setProblem(renderFailure(t, result));
        textarea.current?.focus();
        return;
      }
      const image = await storeImage(context.pageId, blockId, type, result.svg);
      updateAttributes({ source: draft, ...image });
      setEditing(false);
      setView("preview");
    } catch (error) {
      setFailure(problemMessage(t, error));
    } finally {
      setSaving(false);
    }
  };

  const hasImage = previewId !== null && previewVersion !== null;

  return (
    <NodeViewWrapper
      className={`ph-diagram flex flex-col overflow-hidden rounded-md border border-border bg-surface${selected ? " ph-node-selected" : ""}`}
      contentEditable={false}
      data-diagram={type}
      data-diagram-id={blockId}
    >
      <DiagramHeader icon={Workflow} label={label} others={others}>
        {editing ? null : (
          <SegmentedControl
            value={view}
            onValueChange={(value) => setView(value === "source" ? "source" : "preview")}
            label={t("editor.diagram.show")}
            options={[
              { value: "preview", label: t("editor.diagram.preview") },
              { value: "source", label: t("editor.diagram.source") },
            ]}
          />
        )}
        {editable && !busy && !editing ? (
          <Button size="sm" variant="secondary" icon={Pencil} onClick={start}>
            {t("editor.diagram.edit")}
          </Button>
        ) : null}
      </DiagramHeader>
      {editing ? (
        <div className="flex flex-col gap-3 p-3">
          <label htmlFor={sourceId} className="text-sm font-medium">
            {t("editor.diagram.sourceLabel", { name: label })}
          </label>
          <Textarea
            ref={textarea}
            id={sourceId}
            value={draft}
            rows={8}
            spellCheck={false}
            invalid={problem !== null}
            aria-describedby={problem ? errorId : undefined}
            className="font-mono text-sm"
            onChange={(event) => setDraft(event.target.value)}
          />
          {problem ? (
            <Notice variant="warning" title={t("editor.diagram.problemTitle")}>
              <p id={errorId} className="whitespace-pre-wrap">
                {problem}
              </p>
            </Notice>
          ) : null}
          {failure ? (
            <Notice variant="danger" title={t("editor.diagram.saveFailed")}>
              {failure}
            </Notice>
          ) : null}
          <div className="rounded-md border border-border bg-bg p-2" aria-live="polite">
            {rendered ? (
              <LivePreview svg={rendered} label={label} />
            ) : hasImage ? (
              <StoredImage id={previewId} version={previewVersion} label={label} />
            ) : (
              <p className="p-2 text-sm text-text-muted">{t("editor.diagram.rendering")}</p>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" icon={Check} loading={saving} onClick={() => void save()}>
              {t("editor.diagram.save")}
            </Button>
          </div>
        </div>
      ) : view === "source" || !hasImage ? (
        <>
          {!hasImage && view === "preview" ? (
            <p className="px-3 pt-3 text-sm text-text-muted">
              {stored.length > 0
                ? t("editor.diagram.notRendered", { name: label })
                : editable
                  ? t("editor.diagram.empty")
                  : t("editor.diagram.emptyReadOnly")}
            </p>
          ) : null}
          {stored.length > 0 ? (
            <pre className="ph-code-block m-3 overflow-auto">
              <code>{stored}</code>
            </pre>
          ) : null}
        </>
      ) : (
        <StoredImage id={previewId} version={previewVersion} label={label} />
      )}
    </NodeViewWrapper>
  );
}
