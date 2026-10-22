import { type DocumentDiff, renderDiffHtml } from "@lunedo/editor-schema";
import { useLayoutEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { applyWidths, readViewContext } from "../../editor/read-view.js";
import { type References, rememberReferences } from "../../editor/references.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import "../../editor/editor.css";

export type DiffLayout = "inline" | "sideBySide";

export function DiffView({
  comparison,
  layout,
  beforeLabel,
  afterLabel,
}: {
  comparison: { diff?: unknown; references: References };
  layout: DiffLayout;
  beforeLabel: string;
  afterLabel: string;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const labels = useMemo(
    () => ({ moved: t("versions.diff.moved"), attributes: t("versions.diff.attributes") }),
    [t],
  );
  const rendered = useMemo(() => {
    const diff = comparison.diff as DocumentDiff;
    const context = readViewContext(comparison.references, t, format);
    try {
      return {
        diff,
        inline: renderDiffHtml(diff, "inline", context, { labels }),
        before: renderDiffHtml(diff, "before", context, { labels }),
        after: renderDiffHtml(diff, "after", context, { labels }),
      };
    } catch {
      return null;
    }
  }, [comparison, t, format, labels]);
  useLayoutEffect(() => {
    rememberReferences(comparison.references);
  }, [comparison.references]);

  if (!rendered) return <p className="text-danger">{t("editor.readView.invalid")}</p>;
  const { diff } = rendered;
  return (
    <section aria-label={t("versions.comparison")} className="flex flex-col gap-3">
      <p className="flex flex-wrap gap-4 text-sm text-text-muted" role="status">
        <span>
          {diff.changes === 0
            ? t("versions.noDifferences")
            : t("versions.changeCount", { count: diff.changes })}
        </span>
        <span>
          <ins className="ld-diff-added">{t("versions.added")}</ins>
        </span>
        <span>
          <del className="ld-diff-removed">{t("versions.removed")}</del>
        </span>
      </p>
      {diff.title ? (
        <p className="text-sm">
          {t("versions.titleChanged")} <del className="ld-diff-removed">{diff.title.before}</del>{" "}
          <ins className="ld-diff-added">{diff.title.after}</ins>
        </p>
      ) : null}
      {layout === "inline" ? (
        <DiffHtml html={rendered.inline} label={t("versions.changes")} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <DiffHtml html={rendered.before} label={beforeLabel} heading />
          <DiffHtml html={rendered.after} label={afterLabel} heading />
        </div>
      )}
    </section>
  );
}

function DiffHtml({ html, label, heading = false }: { html: string; label: string; heading?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (container.current && html) applyWidths(container.current);
  }, [html]);
  return (
    <section aria-label={label} className="flex min-w-0 flex-col gap-2">
      {heading ? <h2 className="text-sm font-semibold text-text-muted">{label}</h2> : null}
      <div
        ref={container}
        className="ld-content ld-read-view ld-diff min-w-0 rounded-md border border-border bg-surface p-4"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: the shared renderer escapes all content of the validated documents
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </section>
  );
}
