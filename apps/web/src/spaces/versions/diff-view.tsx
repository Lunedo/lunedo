import { type DocumentDiff, renderDiffHtml } from "@lunedo/editor-schema";
import { Button, Skeleton } from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { applyWidths, readViewContext } from "../../editor/read-view.js";
import { type References, rememberReferences } from "../../editor/references.js";
import { LoadError } from "../../errors/failure.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { compareQuery } from "../content-queries.js";
import "../../editor/editor.css";

export type DiffLayout = "inline" | "sideBySide";

const CHANGE_SELECTOR = [
  '[data-change="added"]',
  '[data-change="removed"]',
  '[data-change="moved"]',
  "ins.ld-diff-added",
  "del.ld-diff-removed",
  ".ld-diff-formatted",
  ".ld-diff-note",
].join(",");
const CURRENT = "ld-diff-current";

export function changeTargets(root: HTMLElement): HTMLElement[] {
  const all = [...root.querySelectorAll<HTMLElement>(CHANGE_SELECTOR)];
  const outermost = all.filter(
    (element) => !all.some((other) => other !== element && other.contains(element)),
  );
  return outermost.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
}

function useChangeNavigation(root: React.RefObject<HTMLElement | null>, key: unknown) {
  const [current, setCurrent] = useState(-1);
  const [total, setTotal] = useState(0);
  useLayoutEffect(() => {
    void key;
    setCurrent(-1);
    setTotal(root.current ? changeTargets(root.current).length : 0);
  }, [root, key]);
  const go = (step: 1 | -1) => {
    if (!root.current) return;
    const targets = changeTargets(root.current);
    if (targets.length === 0) return;
    const next =
      current < 0
        ? step === 1
          ? 0
          : targets.length - 1
        : (current + step + targets.length) % targets.length;
    for (const element of root.current.querySelectorAll(`.${CURRENT}`)) element.classList.remove(CURRENT);
    const target = targets[next];
    target?.classList.add(CURRENT);
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
    setCurrent(next);
    setTotal(targets.length);
  };
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "[" && event.key !== "]") return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      event.preventDefault();
      goRef.current(event.key === "]" ? 1 : -1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return { current, total, go };
}

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
  const body = useRef<HTMLDivElement>(null);
  const navigation = useChangeNavigation(body, `${layout}:${rendered?.inline ?? ""}`);

  if (!rendered) return <p className="text-danger">{t("editor.readView.invalid")}</p>;
  const { diff } = rendered;
  return (
    <section aria-label={t("versions.comparison")} className="flex flex-col gap-3">
      {navigation.total > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            icon={ChevronUp}
            aria-keyshortcuts="["
            title={t("versions.previousChangeKey")}
            onClick={() => navigation.go(-1)}
          >
            {t("versions.previousChange")}
          </Button>
          <Button
            variant="secondary"
            icon={ChevronDown}
            aria-keyshortcuts="]"
            title={t("versions.nextChangeKey")}
            onClick={() => navigation.go(1)}
          >
            {t("versions.nextChange")}
          </Button>
          <span className="text-sm text-text-muted" aria-live="polite">
            {navigation.current >= 0
              ? t("versions.changePosition", { current: navigation.current + 1, total: navigation.total })
              : null}
          </span>
        </div>
      ) : null}
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
      <div ref={body} className="contents">
        {layout === "inline" ? (
          <DiffHtml html={rendered.inline} label={t("versions.changes")} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <DiffHtml html={rendered.before} label={beforeLabel} heading />
            <DiffHtml html={rendered.after} label={afterLabel} heading />
          </div>
        )}
      </div>
    </section>
  );
}

function DiffHtml({
  html,
  label,
  heading = false,
  plain = false,
}: {
  html: string;
  label: string;
  heading?: boolean;
  plain?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (container.current && html) applyWidths(container.current);
  }, [html]);
  return (
    <section aria-label={label} className="flex min-w-0 flex-col gap-2">
      {heading ? <h2 className="text-sm font-semibold text-text-muted">{label}</h2> : null}
      <div
        ref={container}
        className={`ld-content ld-read-view ld-diff min-w-0 ${plain ? "" : "rounded-md border border-border bg-surface p-4"}`}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: the shared renderer escapes all content of the validated documents
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </section>
  );
}

export function DraftChanges({ pageId, basedOn }: { pageId: string; basedOn: number }) {
  const { t } = useTranslation();
  const format = useFormat();
  const comparison = useQuery(compareQuery(pageId, basedOn, "draft"));
  const html = useMemo(() => {
    if (!comparison.data) return null;
    try {
      return renderDiffHtml(
        comparison.data.diff as DocumentDiff,
        "after",
        readViewContext(comparison.data.references, t, format),
        { labels: { moved: t("versions.diff.moved"), attributes: t("versions.diff.attributes") } },
      );
    } catch {
      return "";
    }
  }, [comparison.data, t, format]);
  useLayoutEffect(() => {
    if (comparison.data) rememberReferences(comparison.data.references);
  }, [comparison.data]);
  if (comparison.isPending) return <Skeleton className="h-field w-full" />;
  if (comparison.isError) {
    return (
      <LoadError
        what={t("versions.compareFailed")}
        error={comparison.error}
        onRetry={() => comparison.refetch()}
      />
    );
  }
  if (!html) return <p className="text-danger">{t("editor.readView.invalid")}</p>;
  return <DiffHtml html={html} label={t("versions.draftView")} plain />;
}
