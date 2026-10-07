import { MAX_LATEX_LENGTH } from "@pagehall/editor-schema";
import { Button, Field, Popover, Textarea } from "@pagehall/ui";
import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import katex from "katex";
import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export function renderFormula(latex: string, displayMode: boolean): { html: string; error: boolean } {
  try {
    return {
      html: katex.renderToString(latex, {
        displayMode,
        throwOnError: true,
        trust: false,
        strict: "ignore",
        maxExpand: 1000,
        maxSize: 20,
        output: "htmlAndMathml",
      }),
      error: false,
    };
  } catch {
    return {
      html: katex.renderToString(latex, { displayMode, throwOnError: false, trust: false }),
      error: true,
    };
  }
}

function Formula({
  latex,
  displayMode,
  className,
}: {
  latex: string;
  displayMode: boolean;
  className?: string;
}) {
  const rendered = useMemo(() => renderFormula(latex, displayMode), [latex, displayMode]);
  return (
    <span
      className={className}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX output of a formula rendered without trust
      dangerouslySetInnerHTML={{ __html: rendered.html }}
    />
  );
}

export function MathView({ node, updateAttributes, editor, selected, deleteNode }: NodeViewProps) {
  const { t } = useTranslation();
  const displayMode = node.type.name === "blockMath";
  const latex = String(node.attrs.latex ?? "");
  const [open, setOpen] = useState(latex.length === 0 && editor.isEditable);
  const [draft, setDraft] = useState(latex);
  useEffect(() => {
    if (!open) setDraft(latex);
  }, [latex, open]);
  const preview = useMemo(() => renderFormula(draft, displayMode), [draft, displayMode]);
  const apply = () => {
    if (draft.trim().length === 0) deleteNode();
    else updateAttributes({ latex: draft });
    setOpen(false);
    editor.commands.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey || !displayMode)) {
      event.preventDefault();
      apply();
    }
    if (event.key === "Escape") {
      setOpen(false);
      editor.commands.focus();
    }
  };
  const trigger = (
    <button
      type="button"
      contentEditable={false}
      className={displayMode ? "ph-math ph-math-block" : "ph-math"}
      aria-label={t("editor.math.edit", { latex })}
    >
      {latex ? <Formula latex={latex} displayMode={displayMode} /> : <span>{t("editor.math.empty")}</span>}
    </button>
  );
  return (
    <NodeViewWrapper
      as={displayMode ? "div" : "span"}
      className={selected ? "ph-node-selected" : undefined}
      data-latex={latex}
    >
      {editor.isEditable ? (
        <Popover
          trigger={trigger}
          open={open}
          onOpenChange={setOpen}
          label={t("editor.math.title")}
          align="start"
        >
          <div className="flex w-dialog-sm max-w-full flex-col gap-3">
            <Field
              label={t("editor.math.formula")}
              hint={t(displayMode ? "editor.math.hintBlock" : "editor.math.hintInline")}
            >
              <Textarea
                value={draft}
                rows={displayMode ? 4 : 2}
                maxLength={MAX_LATEX_LENGTH}
                className="font-mono"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKeyDown}
              />
            </Field>
            <section aria-live="polite" aria-label={t("editor.math.preview")} className="ph-math-preview">
              {draft ? <Formula latex={draft} displayMode={displayMode} /> : null}
              {preview.error ? <p className="text-sm text-danger">{t("editor.math.invalid")}</p> : null}
            </section>
            <Button size="sm" onClick={apply}>
              {t("editor.math.apply")}
            </Button>
          </div>
        </Popover>
      ) : (
        trigger
      )}
    </NodeViewWrapper>
  );
}
