import { Button, Notice, Spinner, TruncatedText } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowLeft, Printer } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { translateKey } from "../i18n/translate.js";
import type { PrintViewer } from "../print/viewer.js";
import { exportQuery, printExportHtml, printPageHtml } from "./export-queries.js";
import { printOptions, printRouteSearch } from "./print-search.js";

type Phase = "preparing" | "loading" | "layout" | "ready" | "failed";

function viewerOf(frame: HTMLIFrameElement | null): PrintViewer | null {
  return (frame?.contentWindow as (Window & { pagehallPrint?: PrintViewer }) | null)?.pagehallPrint ?? null;
}

export function PrintScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = printRouteSearch.parse(useSearch({ strict: false }));
  const frame = useRef<HTMLIFrameElement>(null);
  const printed = useRef(false);
  const [frameReady, setFrameReady] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>(search.export ? "preparing" : "loading");
  const [sheets, setSheets] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const job = useQuery({ ...exportQuery(search.export ?? ""), enabled: search.export !== undefined });
  const options = job.data?.options ?? printOptions(search);
  const exportFailed = job.data?.state === "failed";
  const title = html ? new DOMParser().parseFromString(html, "text/html").title : (job.data?.name ?? "");

  const pageId = search.page;
  const exportId = search.export;
  const jobReady = job.data?.state === "ready";
  const requested = JSON.stringify(printOptions(search));

  useEffect(() => {
    if (html !== null || exportFailed || attempt < 0) return;
    const load = pageId
      ? () => printPageHtml(pageId, JSON.parse(requested))
      : exportId && jobReady
        ? () => printExportHtml(exportId)
        : null;
    if (!load) return;
    let current = true;
    setPhase("loading");
    load().then(
      (loaded) => {
        if (current) setHtml(loaded);
      },
      () => {
        if (current) setPhase("failed");
      },
    );
    return () => {
      current = false;
    };
  }, [html, exportFailed, pageId, exportId, jobReady, requested, attempt]);

  useEffect(() => {
    if (exportFailed) setPhase("failed");
  }, [exportFailed]);

  useEffect(() => {
    const viewer = viewerOf(frame.current);
    if (!frameReady || html === null || !viewer) return;
    let current = true;
    setPhase("layout");
    viewer.render(html).then(
      (result) => {
        if (!current) return;
        setSheets(result.pages);
        setPhase("ready");
        if (!printed.current) {
          printed.current = true;
          frame.current?.contentWindow?.print();
        }
      },
      () => {
        if (current) setPhase("failed");
      },
    );
    return () => {
      current = false;
    };
  }, [frameReady, html]);

  const printAgain = useCallback(() => frame.current?.contentWindow?.print(), []);
  const retry = () => {
    printed.current = false;
    setHtml(null);
    setFrameReady(false);
    setPhase(search.export ? "preparing" : "loading");
    setAttempt((value) => value + 1);
  };

  const back = () => {
    if (window.history.length > 1) window.history.back();
    else void navigate({ to: "/" });
  };

  if (!search.page && !search.export) {
    return (
      <main className="mx-auto flex max-w-xl flex-col gap-4 p-6">
        <Notice variant="info" title={t("exports.print.missingTitle")}>
          {t("exports.print.missing")}
        </Notice>
      </main>
    );
  }

  return (
    <main className="flex h-dvh flex-col bg-surface-sunken text-text">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-4 py-2">
        <Button variant="outline" size="sm" icon={ArrowLeft} onClick={back}>
          {t("exports.print.back")}
        </Button>
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="min-w-0 font-semibold">
            <TruncatedText text={t("exports.print.title", { title })} />
          </h1>
          {phase === "ready" ? (
            <p className="text-sm text-text-muted">
              {t("exports.print.details", {
                paper: translateKey(t, `exports.dialog.papers.${options.paper}`),
                orientation: translateKey(t, `exports.dialog.orientations.${options.orientation}`),
                count: sheets,
              })}
            </p>
          ) : null}
        </div>
        <Button
          size="sm"
          variant="secondary"
          icon={Printer}
          onClick={printAgain}
          disabled={phase !== "ready"}
        >
          {t("exports.print.again")}
        </Button>
      </header>
      <div className="flex flex-col gap-1 border-b border-border bg-surface px-4 py-2 text-sm">
        <p>{t("exports.print.hint")}</p>
        <p className="text-text-muted">{t("exports.print.browsers")}</p>
      </div>
      <div aria-live="polite" className="contents">
        {phase === "preparing" || phase === "loading" || phase === "layout" ? (
          <div className="flex items-center gap-2 px-4 py-3 text-sm">
            <Spinner label={t(`exports.print.${phase}`)} />
            <span>{t(`exports.print.${phase}`)}</span>
            {phase === "preparing" && job.data && job.data.progress.total > 0 ? (
              <span className="flex min-w-0 flex-1 items-center gap-2 text-text-muted">
                <span
                  role="progressbar"
                  aria-label={t("exports.print.preparing")}
                  aria-valuemin={0}
                  aria-valuemax={job.data.progress.total}
                  aria-valuenow={job.data.progress.done}
                  className="h-2 w-40 max-w-full overflow-hidden rounded-full bg-surface"
                >
                  <span
                    className="block h-full bg-accent transition-[width] motion-reduce:transition-none"
                    style={{
                      width: `${Math.min(100, (job.data.progress.done / job.data.progress.total) * 100)}%`,
                    }}
                  />
                </span>
                {t("exports.print.preparingProgress", {
                  done: job.data.progress.done,
                  total: job.data.progress.total,
                })}
              </span>
            ) : null}
          </div>
        ) : null}
        {phase === "failed" ? (
          <div className="px-4 py-3">
            <Notice variant="danger" title={t("exports.print.failedTitle")}>
              <span>{exportFailed ? t("exports.print.exportFailed") : t("exports.print.failed")}</span>
              {exportFailed ? null : (
                <span className="mt-2 flex">
                  <Button size="sm" variant="secondary" onClick={retry}>
                    {t("exports.print.retry")}
                  </Button>
                </span>
              )}
            </Notice>
          </div>
        ) : null}
      </div>
      <iframe
        key={attempt}
        ref={frame}
        src="/print.html"
        title={t("exports.print.frame", { title })}
        className="min-h-0 w-full flex-1 border-0"
        onLoad={() => setFrameReady(true)}
      />
    </main>
  );
}
