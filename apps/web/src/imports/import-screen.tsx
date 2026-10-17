import { slugify } from "@pagehall/editor-schema";
import {
  Badge,
  Button,
  ConfirmDialog,
  DangerAction,
  DangerZone,
  EmptyState,
  ErrorState,
  Icon,
  List,
  ListRow,
  Notice,
  Section,
  Skeleton,
  Spinner,
  Table,
  Tabs,
  useToast,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Download,
  Eye,
  FileInput,
  FileWarning,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LoadError, useFailureToast } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { translateKey } from "../i18n/translate.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { SettingsPage } from "../screens/settings/settings-page.js";
import { pagePath } from "../spaces/space-queries.js";
import { AcceptDialog } from "./accept-dialog.js";
import { ConfluenceLinkField } from "./confluence-link.js";
import { errorText, importTitle, sourceLabel, stateBadge, stateLabel } from "./import-labels.js";
import {
  discardImport,
  entriesQuery,
  type ImportView,
  importKeys,
  importQuery,
  macrosQuery,
  type ReportEntry,
  refreshImport,
  reportExportUrl,
  reportQuery,
  stopImport,
  takeOverImport,
} from "./imports-api.js";
import { createReimport } from "./reimport-api.js";
import { ReimportChanges } from "./reimport-changes.js";
import { PeopleTab, PermissionsTab } from "./resolution-tabs.js";
import { ThrottleNotice } from "./source-steps.js";

const route = getRouteApi("/app/settings/organizations/$organizationId/imports/$importId");
const PHASES = [
  "read",
  "space",
  "people",
  "pages",
  "attachments",
  "templates",
  "content",
  "comments",
  "reactions",
  "permissions",
  "baseline",
  "finish",
] as const;
const REIMPORT_PHASES = [
  "read",
  "compare",
  "lineage",
  "people",
  "pages",
  "moves",
  "attachments",
  "templates",
  "content",
  "labels",
  "comments",
  "reactions",
  "deletions",
  "baseline",
  "finish",
] as const;
const TABS = ["summary", "macros", "people", "comments", "attachments", "permissions"] as const;
type Tab = (typeof TABS)[number];

export function ImportScreen() {
  const { t } = useTranslation();
  const { organizationId, importId } = route.useParams();
  const query = useQuery(importQuery(importId));
  if (query.isPending) {
    return (
      <SettingsPage title={t("imports.title")} icon={FileInput} organizationId={organizationId}>
        <Skeleton className="h-control-field w-full" />
      </SettingsPage>
    );
  }
  if (query.isError) {
    return (
      <SettingsPage title={t("imports.title")} icon={FileInput} organizationId={organizationId}>
        <LoadError what={t("imports.detail.loadFailed")} error={query.error} onRetry={query.refetch} />
      </SettingsPage>
    );
  }
  return <ImportDetail organizationId={organizationId} entry={query.data} />;
}

function ImportDetail({ organizationId, entry }: { organizationId: string; entry: ImportView }) {
  const { t } = useTranslation();
  const format = useFormat();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const failed = useFailureToast();
  const [dialog, setDialog] = useState<"accept" | "discard" | "stop" | null>(null);
  const [takingOver, setTakingOver] = useState(false);
  const reimport = entry.targetSpace;
  const title = reimport ? t("imports.reimport.title") : importTitle(t, entry);
  const key = entry.quarantineSpace?.key ?? reimport?.key ?? entry.spaceKey ?? "";
  const [starting, setStarting] = useState(false);

  const startReimport = async () => {
    if (!entry.reimportSpaceId) return;
    setStarting(true);
    try {
      const created = await createReimport(organizationId, entry.source, entry.reimportSpaceId);
      await navigate({
        to: "/settings/organizations/$organizationId/imports/$importId/setup",
        params: { organizationId, importId: created.id },
      });
    } catch (error) {
      failed(t("imports.reimport.startFailed"), error, () => void startReimport());
    } finally {
      setStarting(false);
    }
  };
  const running = entry.state === "running" || entry.state === "held";
  const deleting = entry.state === "stopping" || entry.state === "discarding";
  const reviewers = entry.reviewers.map((reviewer) => reviewer.name);
  const refresh = () => refreshImport(queryClient, entry.id, organizationId);

  const takeOver = async () => {
    setTakingOver(true);
    try {
      queryClient.setQueryData(importKeys.detail(entry.id), await takeOverImport(entry.id));
      await refresh();
    } catch (error) {
      failed(t("imports.detail.takeOverFailed"), error, () => void takeOver());
    } finally {
      setTakingOver(false);
    }
  };

  const subtitle = () => {
    if (reimport) {
      return t("imports.reimport.subtitle", {
        space: reimport.name,
        source: sourceLabel(t, entry.source),
        when: format.relative(entry.finishedAt ?? entry.updatedAt),
      });
    }
    if (entry.state === "review") {
      return reviewers.length > 0
        ? t("imports.detail.quarantineWithReviewers", { names: reviewers.join(", ") })
        : t("imports.detail.quarantineAlone");
    }
    if (entry.startedAt) {
      return t("imports.detail.started", {
        when: format.relative(entry.startedAt),
        name: entry.importer.name,
      });
    }
    return sourceLabel(t, entry.source);
  };

  return (
    <SettingsPage
      title={entry.state === "running" ? t("imports.detail.importing") : title}
      description={subtitle()}
      icon={FileInput}
      organizationId={organizationId}
      width="wide"
      breadcrumbs={[
        { label: t("imports.title"), href: `/settings/organizations/${organizationId}/imports` },
        { label: title },
      ]}
      actions={
        <>
          <Badge variant={stateBadge(entry.state)}>
            {reimport && entry.state === "review"
              ? t("imports.reimport.stateReview")
              : stateLabel(t, entry.state)}
          </Badge>
          {reimport ? (
            <Link
              to="/spaces/$spaceKey"
              params={{ spaceKey: reimport.key }}
              className="inline-flex h-control-md items-center gap-2 rounded-md border border-control-border px-3 font-medium hover:bg-hover focus-visible:focus-ring"
            >
              <Icon icon={Eye} size="sm" />
              {t("imports.reimport.openSpace")}
            </Link>
          ) : null}
          {entry.state === "review" && entry.quarantineSpace && !reimport ? (
            <Link
              to="/spaces/$spaceKey"
              params={{ spaceKey: entry.quarantineSpace.key }}
              className="inline-flex h-control-md items-center gap-2 rounded-md border border-control-border px-3 font-medium hover:bg-hover focus-visible:focus-ring"
            >
              <Icon icon={Eye} size="sm" />
              {t("imports.detail.openSpace")}
            </Link>
          ) : null}
          {entry.state === "review" && entry.canManage && !reimport ? (
            <Button variant="primary" onClick={() => setDialog("accept")}>
              {t("imports.detail.accept")}
            </Button>
          ) : null}
        </>
      }
    >
      {entry.state === "held" ? (
        <Notice
          variant="warning"
          title={t("imports.detail.heldTitle")}
          {...(entry.canTakeOver
            ? {
                action: (
                  <Button variant="secondary" loading={takingOver} onClick={() => void takeOver()}>
                    {t("imports.detail.takeOver")}
                  </Button>
                ),
              }
            : {})}
        >
          {t("imports.detail.held", { name: entry.importer.name })}
        </Notice>
      ) : null}
      {entry.state === "failed" && entry.errorCode ? <FailedNotice code={entry.errorCode} /> : null}
      {running || deleting ? <Progress entry={entry} /> : null}
      {reimport && ["review", "accepted", "superseded"].includes(entry.state) ? (
        <ReimportChanges entry={entry} />
      ) : null}
      {!reimport && (entry.state === "review" || entry.state === "accepted") ? (
        <Report organizationId={organizationId} entry={entry} />
      ) : null}
      {entry.state === "accepted" || entry.state === "superseded" ? (
        <Section title={t("imports.reimport.againTitle")} icon={RefreshCw}>
          <div className="flex flex-col gap-4 p-4">
            {entry.reimportSpaceId ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <p className="min-w-0 text-sm text-text-muted sm:flex-1">
                  {t("imports.reimport.againDescription")}
                </p>
                <Button variant="secondary" loading={starting} onClick={() => void startReimport()}>
                  {t("imports.reimport.again")}
                </Button>
              </div>
            ) : null}
            <ConfluenceLinkField />
          </div>
        </Section>
      ) : null}
      {entry.tokenDeletedAt ? (
        <Notice variant="info" title={t("imports.detail.tokenDeletedTitle")}>
          {t("imports.detail.tokenDeleted", { when: format.dateTime(entry.tokenDeletedAt) })}
        </Notice>
      ) : entry.peopleSource?.kind === "token" && (entry.state === "review" || running) ? (
        <Notice variant="info" title={t("imports.detail.tokenKeptTitle")}>
          {t("imports.detail.tokenKept")}
        </Notice>
      ) : null}
      {entry.state === "accepted" && entry.quarantineSpace && !reimport ? (
        <Notice variant="success" title={t("imports.detail.acceptedTitle")}>
          {t("imports.detail.accepted", { when: format.relative(entry.decidedAt ?? entry.updatedAt) })}
        </Notice>
      ) : null}
      {entry.state === "discarded" || entry.state === "stopped" ? (
        <EmptyState
          icon={FileInput}
          title={t(
            entry.state === "stopped" ? "imports.detail.stoppedTitle" : "imports.detail.discardedTitle",
          )}
          description={t("imports.detail.removedDescription", {
            when: entry.fileExpiresAt ? format.date(entry.fileExpiresAt) : "",
          })}
        />
      ) : null}
      {entry.canManage && (running || entry.state === "review" || entry.state === "failed") ? (
        <DangerZone title={t("imports.detail.danger")}>
          {running ? (
            <DangerAction
              title={t("imports.detail.stop")}
              description={t(
                reimport ? "imports.reimport.stopDescription" : "imports.detail.stopDescription",
              )}
              action={
                <Button variant="danger" onClick={() => setDialog("stop")}>
                  {t("imports.detail.stop")}
                </Button>
              }
            />
          ) : (
            <DangerAction
              title={t(reimport ? "imports.reimport.discard" : "imports.detail.discard")}
              description={t(
                reimport ? "imports.reimport.discardDescription" : "imports.detail.discardDescription",
              )}
              action={
                <Button variant="danger" onClick={() => setDialog("discard")}>
                  {t(reimport ? "imports.reimport.discard" : "imports.detail.discard")}
                </Button>
              }
            />
          )}
        </DangerZone>
      ) : null}
      {entry.canManage ? (
        <>
          <AcceptDialog
            open={dialog === "accept"}
            onOpenChange={(open) => setDialog(open ? "accept" : null)}
            organizationId={organizationId}
            entry={entry}
            onAccepted={async () => {
              await refresh();
              toast({ title: t("imports.accept.done", { name: title }), variant: "success" });
            }}
          />
          <ConfirmDialog
            open={dialog === "stop" || dialog === "discard"}
            onOpenChange={(open) => {
              if (!open) setDialog(null);
            }}
            title={
              reimport && dialog === "discard"
                ? t("imports.reimport.discardTitle")
                : t(dialog === "stop" ? "imports.detail.stopTitle" : "imports.detail.discardTitle")
            }
            description={
              reimport
                ? t(dialog === "stop" ? "imports.reimport.stopConfirm" : "imports.reimport.discardConfirm")
                : dialog === "stop"
                  ? t("imports.detail.stopConfirm")
                  : t("imports.detail.discardConfirm", {
                      name: title,
                      pages: entry.counts.pages ?? 0,
                      attachments: entry.counts.attachments ?? 0,
                    })
            }
            confirmLabel={
              reimport && dialog === "discard"
                ? t("imports.reimport.discard")
                : t(dialog === "stop" ? "imports.detail.stop" : "imports.detail.discard")
            }
            cancelLabel={t(dialog === "stop" ? "imports.detail.keepRunning" : "imports.detail.keepImport")}
            destructive
            typedConfirmation={{
              value: key,
              label: t("imports.detail.typeKey", { key }),
              mismatch: t("imports.detail.keyMismatch", { key }),
            }}
            onConfirm={async () => {
              try {
                const result =
                  dialog === "stop" ? await stopImport(entry.id, key) : await discardImport(entry.id, key);
                queryClient.setQueryData(importKeys.detail(entry.id), result);
                await refresh();
                toast({
                  title: t(dialog === "stop" ? "imports.detail.stopping" : "imports.detail.discarding"),
                  variant: "success",
                });
              } catch (error) {
                failed(
                  t(dialog === "stop" ? "imports.detail.stopFailed" : "imports.detail.discardFailed"),
                  error,
                );
                throw error;
              }
            }}
          />
        </>
      ) : null}
    </SettingsPage>
  );
}

function FailedNotice({ code }: { code: string }) {
  const { t } = useTranslation();
  const text = errorText(t, code);
  return (
    <ErrorState
      title={t("imports.detail.failed", { what: text.what })}
      cause={text.cause}
      action={text.action}
    />
  );
}

function Progress({ entry }: { entry: ImportView }) {
  const { t } = useTranslation();
  const format = useFormat();
  const deleting = entry.state === "stopping" || entry.state === "discarding";
  const phases: readonly string[] = entry.targetSpace
    ? entry.phase === "compare"
      ? REIMPORT_PHASES.slice(0, 2)
      : REIMPORT_PHASES.slice(2)
    : PHASES;
  const current = entry.phase === "done" ? phases.length : phases.indexOf(entry.phase ?? phases[0] ?? "");
  const fraction = entry.progress.total > 0 ? Math.min(1, entry.progress.done / entry.progress.total) : 0;
  const overall = deleting ? 0 : Math.round(((Math.max(0, current) + fraction) / phases.length) * 100);
  return (
    <>
      {deleting ? (
        <Notice variant="info" title={t("imports.detail.deletingTitle")}>
          <span className="inline-flex items-center gap-2">
            <Spinner label={t("imports.detail.phaseActive")} />
            {t("imports.detail.deleting", { count: entry.progress.done })}
          </span>
        </Notice>
      ) : (
        <div
          role="progressbar"
          aria-label={t("imports.detail.progressLabel")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={overall}
          className="h-2 overflow-hidden rounded-full bg-surface-sunken"
        >
          <div
            className="h-full bg-accent transition-[width] motion-reduce:transition-none"
            style={{ width: `${overall}%` }}
          />
        </div>
      )}
      {deleting ? null : <ThrottleNotice until={entry.throttledUntil} />}
      {deleting ? null : (
        <Section title={t("imports.detail.steps")}>
          <ol className="flex flex-col divide-y divide-border">
            {phases.map((phase, position) => {
              const done = position < current;
              const active = position === current;
              return (
                <li
                  key={phase}
                  aria-current={active ? "step" : undefined}
                  className={`flex items-center gap-3 px-4 py-3 ${done || active ? "text-text" : "text-text-muted"}`}
                >
                  <span className="flex size-icon-lg shrink-0 items-center justify-center">
                    {done ? (
                      <CheckCircle2 aria-hidden="true" className="size-icon-md text-success" />
                    ) : active ? (
                      <Spinner label={t("imports.detail.phaseActive")} />
                    ) : (
                      <span aria-hidden="true" className="size-icon-md rounded-full border border-border" />
                    )}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium">{translateKey(t, `imports.phases.${phase}`)}</span>
                    {active && entry.progress.total > 0 ? (
                      <span className="text-sm text-text-muted tabular-nums">
                        {t("imports.detail.phaseProgress", {
                          done: format.number(entry.progress.done),
                          total: format.number(entry.progress.total),
                        })}
                      </span>
                    ) : null}
                    <span className="sr-only">
                      {done
                        ? t("imports.detail.phaseDone")
                        : active
                          ? t("imports.detail.phaseActive")
                          : t("imports.detail.phaseWaiting")}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        </Section>
      )}
      {deleting ? null : <Notice variant="info">{t("imports.detail.resumeNote")}</Notice>}
    </>
  );
}

function Report({ organizationId, entry }: { organizationId: string; entry: ImportView }) {
  const { t } = useTranslation();
  const format = useFormat();
  const search = route.useSearch();
  const navigate = useNavigate();
  const tab: Tab = TABS.includes(search.tab as Tab) ? (search.tab as Tab) : "summary";
  const report = useQuery(reportQuery(entry.id));
  const macros = useQuery(macrosQuery(entry.id));
  const count = (category: string) =>
    (report.data?.categories ?? [])
      .filter((row) => row.category === category)
      .reduce((sum, row) => sum + row.count, 0);
  const setTab = (next: string) => void navigate({ to: ".", search: { tab: next } });
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(["pages", "blogPosts", "attachments", "comments"] as const).map((name) => (
          <div key={name} className="flex flex-col gap-1 rounded-md border border-border p-4">
            <span className="text-xl font-semibold tabular-nums">
              {format.number(entry.counts[name] ?? 0)}
            </span>
            <span className="text-sm text-text-muted">
              {t(`imports.report.counts.${name}`, { count: entry.counts[name] ?? 0 })}
            </span>
          </div>
        ))}
      </div>
      <Tabs
        value={tab}
        onValueChange={setTab}
        label={t("imports.report.tabs")}
        tabs={[
          { value: "summary", label: t("imports.report.summary") },
          { value: "macros", label: t("imports.report.macros"), count: macros.data?.length ?? 0 },
          { value: "people", label: t("imports.report.people"), count: report.data?.placeholders ?? 0 },
          { value: "comments", label: t("imports.report.comments"), count: count("comments") },
          { value: "attachments", label: t("imports.report.attachments"), count: count("attachments") },
          {
            value: "permissions",
            label: t("imports.report.permissions"),
            count: report.data?.permissionsToCheck ?? 0,
          },
        ]}
      >
        {report.isPending ? (
          <Skeleton className="h-control-field w-full" />
        ) : report.isError ? (
          <LoadError what={t("imports.report.loadFailed")} error={report.error} onRetry={report.refetch} />
        ) : tab === "summary" ? (
          <Summary entry={entry} report={report.data} onOpen={setTab} />
        ) : tab === "macros" ? (
          <MacrosTab entry={entry} />
        ) : tab === "people" ? (
          <PeopleTab organizationId={organizationId} entry={entry} />
        ) : tab === "permissions" ? (
          <PermissionsTab organizationId={organizationId} entry={entry} />
        ) : tab === "comments" ? (
          <EntriesList entry={entry} category="comments" empty={t("imports.report.noCommentProblems")} />
        ) : (
          <EntriesList
            entry={entry}
            category="attachments"
            empty={t("imports.report.noAttachmentProblems")}
          />
        )}
      </Tabs>
      <p>
        <a
          href={reportExportUrl(entry.id)}
          download
          className="inline-flex items-center gap-2 font-medium text-accent hover:underline focus-visible:focus-ring"
        >
          <Icon icon={Download} size="sm" />
          {t("imports.report.download")}
        </a>
      </p>
    </>
  );
}

function Summary({
  entry,
  report,
  onOpen,
}: {
  entry: ImportView;
  report: {
    categories: { category: string; code: string; count: number }[];
    total: number;
    placeholders: number;
    permissionsToCheck: number;
  };
  onOpen: (tab: string) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<string | null>(null);
  const extra = [
    report.placeholders > 0
      ? {
          key: "people",
          title: t("imports.report.placeholdersTitle", { count: report.placeholders }),
          hint: t("imports.report.placeholdersHint"),
        }
      : null,
    report.permissionsToCheck > 0
      ? {
          key: "permissions",
          title: t("imports.report.permissionsTitle", { count: report.permissionsToCheck }),
          hint: t("imports.report.permissionsHint"),
        }
      : null,
  ].filter((row): row is { key: string; title: string; hint: string } => row !== null);
  if (report.total === 0 && extra.length === 0) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title={t("imports.report.clean")}
        description={t("imports.report.cleanDescription")}
      />
    );
  }
  return (
    <Section title={t("imports.report.attention")}>
      <ul className="flex flex-col divide-y divide-border">
        {extra.map((row) => (
          <li key={row.key}>
            <button
              type="button"
              onClick={() => onOpen(row.key)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover focus-visible:focus-ring"
            >
              <Icon icon={AlertTriangle} className="text-warning" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">{row.title}</span>
                <span className="text-sm text-text-muted">{row.hint}</span>
              </span>
              <Icon icon={ChevronRight} className="text-text-muted" />
            </button>
          </li>
        ))}
        {report.categories.map((row) => {
          const target =
            row.category === "macros" || row.category === "attachments" || row.category === "comments"
              ? row.category
              : null;
          const label = translateKey(t, `imports.report.codes.${row.code}.title`, {
            count: row.count,
            defaultValue: row.code,
          });
          const hint = translateKey(t, `imports.report.codes.${row.code}.hint`, { defaultValue: "" });
          const open = expanded === row.code;
          return (
            <li key={row.code}>
              <button
                type="button"
                aria-expanded={target ? undefined : open}
                onClick={() => (target ? onOpen(target) : setExpanded(open ? null : row.code))}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover focus-visible:focus-ring"
              >
                <Icon icon={AlertTriangle} className="text-warning" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{label}</span>
                  {hint ? <span className="text-sm text-text-muted">{hint}</span> : null}
                </span>
                <Icon
                  icon={ChevronRight}
                  className={open ? "rotate-90 text-text-muted" : "text-text-muted"}
                />
              </button>
              {open ? (
                <div className="px-4 pb-3">
                  <EntriesList entry={entry} category={row.category} code={row.code} empty="" />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function entryText(t: TFunction, entry: ReportEntry): string {
  const details = entry.details as Record<string, string | number | null>;
  return translateKey(t, `imports.report.codes.${entry.code}.entry`, {
    ...Object.fromEntries(Object.entries(details).map(([name, value]) => [name, value ?? ""])),
    defaultValue: entry.code,
  });
}

function EntriesList({
  entry,
  category,
  code,
  empty,
}: {
  entry: ImportView;
  category: string;
  code?: string;
  empty: string;
}) {
  const { t } = useTranslation();
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const page = useQuery(entriesQuery(entry.id, { category, code: code ?? null }, cursor));
  if (page.isPending) return <Skeleton className="h-control-field w-full" />;
  if (page.isError)
    return <LoadError what={t("imports.report.entriesFailed")} error={page.error} onRetry={page.refetch} />;
  if (page.data.items.length === 0) {
    return empty ? <EmptyState icon={CheckCircle2} title={empty} /> : null;
  }
  const spaceKey = entry.quarantineSpace?.key ?? "";
  return (
    <div className="flex flex-col gap-2">
      <List label={t("imports.report.entries")}>
        {page.data.items.map((item) => (
          <ListRow
            key={item.id}
            icon={FileWarning}
            title={
              item.item
                ? item.item.title
                : item.template
                  ? t("imports.report.template", { name: item.template.name })
                  : item.restricted
                    ? t("imports.report.restrictedPage")
                    : t("imports.report.wholeExport")
            }
            description={entryText(t, item)}
            {...(item.item?.title && spaceKey
              ? {
                  actions: (
                    <Link
                      to={pagePath(spaceKey, item.item.id, slugify(item.item.title))}
                      className="font-medium text-accent hover:underline focus-visible:focus-ring"
                    >
                      {t("imports.report.openPage")}
                    </Link>
                  ),
                }
              : {})}
          />
        ))}
      </List>
      <div className="flex gap-2">
        {cursors.length > 0 ? (
          <Button variant="secondary" onClick={() => setCursors((current) => current.slice(0, -1))}>
            {t("imports.report.previous")}
          </Button>
        ) : null}
        {page.data.nextCursor ? (
          <Button
            variant="secondary"
            onClick={() => setCursors((current) => [...current, page.data.nextCursor as string])}
          >
            {t("imports.report.next")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function MacrosTab({ entry }: { entry: ImportView }) {
  const { t } = useTranslation();
  const format = useFormat();
  const macros = useQuery(macrosQuery(entry.id));
  const [selected, setSelected] = useState<string | null>(null);
  if (macros.isPending) return <Skeleton className="h-control-field w-full" />;
  if (macros.isError)
    return (
      <LoadError what={t("imports.report.macrosFailed")} error={macros.error} onRetry={macros.refetch} />
    );
  if (macros.data.length === 0) {
    return <EmptyState icon={CheckCircle2} title={t("imports.report.noMacros")} />;
  }
  return (
    <div className="flex flex-col gap-3">
      <Table
        caption={t("imports.report.macrosCaption")}
        rowKey={(row) => row.name}
        rows={macros.data}
        columns={[
          {
            key: "name",
            header: t("imports.report.macro"),
            cell: (row) => <span className="font-medium">{row.name}</span>,
          },
          {
            key: "pages",
            header: t("imports.report.usedOn"),
            align: "end",
            cell: (row) =>
              t("imports.report.pagesCount", { count: row.pages, formatted: format.number(row.pages) }),
          },
          {
            key: "result",
            header: t("imports.report.result"),
            hideBelow: "sm",
            cell: () => <span className="text-text-muted">{t("imports.report.notConverted")}</span>,
          },
        ]}
        onRowClick={(row) => setSelected(selected === row.name ? null : row.name)}
        rowLabel={(row) => t("imports.report.showPages", { name: row.name })}
      />
      {selected ? (
        <Section title={t("imports.report.pagesWith", { name: selected })}>
          <div className="p-4">
            <MacroPages entry={entry} name={selected} />
          </div>
        </Section>
      ) : null}
      <p className="text-sm text-text-muted">{t("imports.report.macrosNote")}</p>
    </div>
  );
}

function MacroPages({ entry, name }: { entry: ImportView; name: string }) {
  const { t } = useTranslation();
  const page = useQuery(entriesQuery(entry.id, { macro: name }));
  if (page.isPending) return <Skeleton className="h-control-field w-full" />;
  if (page.isError)
    return <ErrorState title={t("imports.report.entriesFailed")} cause={problemMessage(t, page.error)} />;
  const items = page.data.items;
  const spaceKey = entry.quarantineSpace?.key ?? "";
  return (
    <List label={t("imports.report.pagesWith", { name })}>
      {items.map((item) =>
        item.template ? (
          <ListRow key={item.id} title={t("imports.report.template", { name: item.template.name })} />
        ) : item.item?.title ? (
          <ListRow
            key={item.id}
            title={item.item.title}
            actions={
              <Link
                to={pagePath(spaceKey, item.item.id, slugify(item.item.title))}
                className="font-medium text-accent hover:underline focus-visible:focus-ring"
              >
                {t("imports.report.openPage")}
              </Link>
            }
          />
        ) : null,
      )}
    </List>
  );
}
