import { Badge, Button, EmptyState, Notice, Section, Skeleton, Table, TruncatedText } from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { Import, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePaged } from "../components/table-state.js";
import { LoadError, useFailureToast } from "../errors/failure.js";
import type { Formatter } from "../format/format.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { SettingsPage } from "../screens/settings/settings-page.js";
import { useOrganizationState } from "../shell/shell-context.js";
import { FolderPath } from "./folder-path.js";
import { importTitle, isWizardState, sourceLabel, stateBadge, stateLabel } from "./import-labels.js";
import { createImport, folderQuery, type ImportView, importsQuery } from "./imports-api.js";

const route = getRouteApi("/app/settings/organizations/$organizationId/imports");

function changes(entry: ImportView): number {
  const counts = entry.counts;
  return (
    (counts.new ?? 0) +
    (counts.updated ?? 0) +
    (counts.conflicts ?? 0) +
    (counts.deleted ?? 0) +
    (counts.moved ?? 0) +
    (counts.movedHere ?? 0) +
    (counts.labels ?? 0)
  );
}

function reimportDetail(t: TFunction, format: Formatter, entry: ImportView): string {
  const source = sourceLabel(t, entry.source);
  switch (entry.state) {
    case "running":
      return t(entry.phase === "compare" ? "imports.list.comparing" : "imports.list.applying", { source });
    case "review":
      return t("imports.list.reimportReview", {
        source,
        when: format.relative(entry.finishedAt ?? entry.updatedAt),
        count: changes(entry),
        open: (entry.counts.conflicts ?? 0) + (entry.counts.deleted ?? 0),
      });
    case "accepted":
      return t("imports.list.reimportApplied", { source, when: format.relative(entry.updatedAt) });
    case "superseded":
      return t("imports.list.superseded", {
        source,
        when: format.relative(entry.decidedAt ?? entry.updatedAt),
      });
    default:
      return detail(t, format, { ...entry, targetSpace: null });
  }
}

function detail(t: TFunction, format: Formatter, entry: ImportView): string {
  if (entry.targetSpace) return reimportDetail(t, format, entry);
  const source = sourceLabel(t, entry.source);
  switch (entry.state) {
    case "running":
      return t("imports.list.running", { source, done: entry.progress.done, total: entry.progress.total });
    case "review":
      return t("imports.list.review", {
        source,
        when: format.relative(entry.finishedAt ?? entry.updatedAt),
        pages: entry.counts.pages ?? 0,
        problems: entry.counts.problems ?? 0,
      });
    case "accepted":
      return t("imports.list.accepted", {
        source,
        when: format.relative(entry.decidedAt ?? entry.updatedAt),
      });
    case "discarded":
    case "stopped":
      return t("imports.list.removed", { source, when: format.relative(entry.decidedAt ?? entry.updatedAt) });
    case "held":
      return t("imports.list.held", { source, name: entry.importer.name });
    case "failed":
      return t("imports.list.failed", { source, when: format.relative(entry.finishedAt ?? entry.updatedAt) });
    default:
      return t("imports.list.draft", { source, when: format.relative(entry.updatedAt) });
  }
}

function ImportsTable({
  rows,
  onOpen,
  actionLabel,
}: {
  rows: ImportView[];
  onOpen: (entry: ImportView) => void;
  actionLabel: (entry: ImportView) => string;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const paged = usePaged(rows);
  return (
    <Table
      caption={t("imports.list.title")}
      rowKey={(entry) => entry.id}
      rows={paged.rows}
      pagination={paged.pagination}
      onRowClick={onOpen}
      rowLabel={actionLabel}
      columns={[
        {
          key: "name",
          header: t("imports.list.name"),
          grow: true,
          cell: (entry) => (
            <span className="flex min-w-0 flex-col leading-tight">
              <TruncatedText
                className="font-medium"
                text={
                  entry.targetSpace
                    ? t("imports.list.reimportTitle", { space: entry.targetSpace.name })
                    : importTitle(t, entry)
                }
              />
              <TruncatedText className="text-xs text-text-muted" text={detail(t, format, entry)} />
            </span>
          ),
        },
        {
          key: "state",
          header: t("imports.list.state"),
          cell: (entry) => <Badge variant={stateBadge(entry.state)}>{stateLabel(t, entry.state)}</Badge>,
        },
        {
          key: "actions",
          sticky: true,
          align: "end",
          header: <span className="sr-only">{t("settings.actions")}</span>,
          cell: (entry) => (
            <Button size="sm" variant="secondary" onClick={() => onOpen(entry)}>
              {actionLabel(entry)}
            </Button>
          ),
        },
      ]}
    />
  );
}

export function ImportsScreen() {
  const { t } = useTranslation();
  const format = useFormat();
  const { organizationId } = route.useParams();
  const navigate = useNavigate();
  const state = useOrganizationState();
  const canImport = state.can("organization.imports.manage");
  const imports = useQuery(importsQuery(organizationId));
  const folder = useQuery({ ...folderQuery(organizationId), enabled: canImport, throwOnError: false });
  const failed = useFailureToast();
  const [creating, setCreating] = useState(false);

  const start = async () => {
    setCreating(true);
    try {
      const created = await createImport(organizationId, "confluence-xml");
      await navigate({
        to: "/settings/organizations/$organizationId/imports/$importId/setup",
        params: { organizationId, importId: created.id },
      });
    } catch (error) {
      failed(t("imports.list.createFailed"), error, () => void start());
    } finally {
      setCreating(false);
    }
  };

  const open = (entry: ImportView) =>
    navigate(
      isWizardState(entry.state) && entry.canManage
        ? {
            to: "/settings/organizations/$organizationId/imports/$importId/setup",
            params: { organizationId, importId: entry.id },
          }
        : {
            to: "/settings/organizations/$organizationId/imports/$importId",
            params: { organizationId, importId: entry.id },
          },
    );

  const actionLabel = (entry: ImportView) => {
    if (isWizardState(entry.state)) return t("imports.list.continue");
    if (entry.state === "running" || entry.state === "stopping" || entry.state === "discarding")
      return t("imports.list.showProgress");
    if (entry.state === "held" && entry.canTakeOver) return t("imports.list.takeOverAction");
    if (entry.state === "review" && entry.targetSpace) return t("imports.list.reviewChanges");
    if (entry.state === "review") return t("imports.list.openReport");
    return t("imports.list.open");
  };

  return (
    <SettingsPage
      title={t("imports.title")}
      description={t("imports.description")}
      actions={
        canImport && (imports.data?.length ?? 0) > 0 ? (
          <Button variant="primary" icon={Plus} loading={creating} onClick={() => void start()}>
            {t("imports.list.new")}
          </Button>
        ) : undefined
      }
    >
      {imports.isPending ? (
        <Skeleton className="h-control-field w-full" />
      ) : imports.isError ? (
        <LoadError what={t("imports.list.loadFailed")} error={imports.error} onRetry={imports.refetch} />
      ) : imports.data.length === 0 ? (
        <Section title={t("imports.list.title")}>
          <EmptyState
            icon={Import}
            title={t("imports.list.empty")}
            description={t("imports.list.emptyDescription")}
            {...(canImport
              ? {
                  action: (
                    <Button variant="primary" icon={Plus} loading={creating} onClick={() => void start()}>
                      {t("imports.list.new")}
                    </Button>
                  ),
                }
              : {})}
          />
        </Section>
      ) : (
        <ImportsTable rows={imports.data} onOpen={(entry) => void open(entry)} actionLabel={actionLabel} />
      )}
      {canImport && folder.data ? (
        <Notice variant="info" title={t("imports.list.largeTitle")}>
          <div className="flex flex-col gap-3">
            <span>
              {folder.data.enabled
                ? t("imports.list.largeFolder", { size: format.bytes(folder.data.maxUploadBytes) })
                : t("imports.list.largeNoFolder", { size: format.bytes(folder.data.maxUploadBytes) })}
            </span>
            <FolderPath path={folder.data.path} />
          </div>
        </Notice>
      ) : null}
    </SettingsPage>
  );
}
