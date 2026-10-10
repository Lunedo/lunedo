import { Badge, Button, EmptyState, List, ListRow, Notice, Section, Skeleton } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { FileInput, Import, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LoadError, useFailureToast } from "../errors/failure.js";
import type { Formatter } from "../format/format.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { SettingsPage } from "../screens/settings/settings-page.js";
import { useOrganizationState } from "../shell/shell-context.js";
import { FolderPath } from "./folder-path.js";
import { importTitle, isWizardState, sourceLabel, stateBadge, stateLabel } from "./import-labels.js";
import { createImport, folderQuery, type ImportView, importsQuery } from "./imports-api.js";

const route = getRouteApi("/app/settings/organizations/$organizationId/imports");

function detail(t: TFunction, format: Formatter, entry: ImportView): string {
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
    if (entry.state === "review") return t("imports.list.openReport");
    return t("imports.list.open");
  };

  return (
    <SettingsPage
      title={t("imports.title")}
      description={t("imports.description")}
      icon={Import}
      organizationId={organizationId}
      width="wide"
      actions={
        canImport ? (
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
        <Section title={t("imports.list.title")}>
          <List label={t("imports.list.title")}>
            {imports.data.map((entry) => (
              <ListRow
                key={entry.id}
                icon={FileInput}
                title={importTitle(t, entry)}
                description={detail(t, format, entry)}
                actions={
                  <>
                    <Badge variant={stateBadge(entry.state)}>{stateLabel(t, entry.state)}</Badge>
                    <Button variant="secondary" onClick={() => void open(entry)}>
                      {actionLabel(entry)}
                    </Button>
                  </>
                }
              />
            ))}
          </List>
        </Section>
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
