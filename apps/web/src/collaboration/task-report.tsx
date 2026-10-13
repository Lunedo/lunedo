import {
  type TaskReportDue,
  type TaskReportStatus,
  taskReportDueWindows,
  taskReportStatuses,
} from "@pagehall/editor-schema";
import { Combobox, Field, Select } from "@pagehall/ui";
import { ListChecks } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { rememberReferences, usePersonName } from "../editor/references.js";
import { LabelsField, labelsOf, PagesField, pageIdsOf } from "../editor/reports.js";
import { translateKey } from "../i18n/translate.js";
import { peopleLoader } from "./people.js";
import type { TaskQuery } from "./queries.js";
import { TaskTable } from "./task-table.js";

export interface TaskReportFilters {
  spaceId: string | null;
  seriesId: string | null;
  pageIds: string[];
  labels: string[];
  assignee: string | null;
  assignedToViewer: boolean;
  due: TaskReportDue;
  status: TaskReportStatus;
}

export function reportFilters(attrs: Record<string, unknown>): TaskReportFilters {
  const due = String(attrs.due ?? "any");
  const status = String(attrs.status ?? "open");
  return {
    spaceId: typeof attrs.spaceId === "string" ? attrs.spaceId : null,
    seriesId: typeof attrs.seriesId === "string" ? attrs.seriesId : null,
    pageIds: pageIdsOf(attrs.pageIds),
    labels: labelsOf(attrs.labels),
    assignee: typeof attrs.assignee === "string" ? attrs.assignee : null,
    assignedToViewer: attrs.assignedToViewer === true || attrs.assignedToViewer === "true",
    due: (taskReportDueWindows as readonly string[]).includes(due) ? (due as TaskReportDue) : "any",
    status: (taskReportStatuses as readonly string[]).includes(status)
      ? (status as TaskReportStatus)
      : "open",
  };
}

export function hasActiveFilters(filters: TaskReportFilters): boolean {
  return (
    filters.pageIds.length > 0 ||
    filters.labels.length > 0 ||
    filters.assignee !== null ||
    filters.assignedToViewer ||
    filters.due !== "any" ||
    filters.status !== "open"
  );
}

export function reportQuery(filters: TaskReportFilters): TaskQuery {
  return {
    status: filters.status,
    due: filters.due,
    limit: 50,
    ...(filters.spaceId ? { spaceId: filters.spaceId } : {}),
    ...(filters.seriesId ? { seriesId: filters.seriesId } : {}),
    ...(filters.pageIds.length > 0 ? { pageIds: filters.pageIds.join(",") } : {}),
    ...(filters.labels.length > 0 ? { labels: filters.labels.join(",") } : {}),
    ...(filters.assignedToViewer
      ? { assignee: "me" }
      : filters.assignee
        ? { assignee: filters.assignee }
        : {}),
  };
}

export function TaskReport({
  filters,
  currentSpaceId,
  onChange,
}: {
  filters: TaskReportFilters;
  currentSpaceId: string | null;
  onChange?: (filters: Partial<TaskReportFilters>) => void;
}) {
  const { t } = useTranslation();
  const assigneeName = usePersonName(filters.assignee ?? "");
  const [picking, setPicking] = useState(false);
  const assigneeMode = filters.assignedToViewer
    ? "viewer"
    : filters.assignee || picking
      ? "person"
      : "anyone";
  return (
    <section className="ph-task-report-view flex flex-col gap-3" aria-label={t("tasks.report.title")}>
      <h3 className="flex items-center gap-2 font-semibold">
        <ListChecks aria-hidden="true" className="size-icon-md" />
        {t("tasks.report.title")}
      </h3>
      {filters.seriesId ? <p className="text-sm text-text-muted">{t("tasks.report.seriesScope")}</p> : null}
      {onChange ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {filters.seriesId ? null : (
            <Field label={t("tasks.report.scope")}>
              <Select
                value={filters.spaceId ? "space" : "all"}
                onValueChange={(value) => onChange({ spaceId: value === "space" ? currentSpaceId : null })}
                options={[
                  ...(currentSpaceId ? [{ value: "space", label: t("tasks.report.thisSpace") }] : []),
                  { value: "all", label: t("tasks.report.allSpaces") },
                ]}
              />
            </Field>
          )}
          <Field label={t("tasks.report.assignee")}>
            <Select
              value={assigneeMode}
              onValueChange={(value) => {
                setPicking(value === "person");
                onChange(
                  value === "viewer"
                    ? { assignedToViewer: true, assignee: null }
                    : value === "anyone"
                      ? { assignedToViewer: false, assignee: null }
                      : { assignedToViewer: false },
                );
              }}
              options={[
                { value: "anyone", label: t("tasks.report.anyone") },
                { value: "viewer", label: t("tasks.report.viewer") },
                { value: "person", label: t("tasks.report.person") },
              ]}
            />
          </Field>
          {assigneeMode === "person" ? (
            <Field label={t("tasks.report.person")}>
              <Combobox
                aria-label={t("tasks.report.person")}
                placeholder={t("tasks.searchPerson")}
                value={filters.assignee}
                selectedItem={
                  filters.assignee ? { value: filters.assignee, label: assigneeName ?? "" } : null
                }
                load={peopleLoader}
                onValueChange={(value, item) => {
                  if (value && item) rememberReferences({ people: { [value]: item.label } });
                  onChange({ assignee: value, assignedToViewer: false });
                }}
              />
            </Field>
          ) : null}
          {filters.seriesId ? null : (
            <>
              <PagesField
                pageIds={filters.pageIds}
                label={t("tasks.report.pages")}
                hint={t("tasks.report.pagesHint")}
                onChange={(pageIds) => onChange({ pageIds })}
              />
              <LabelsField
                labels={filters.labels}
                spaceId={filters.spaceId ?? currentSpaceId}
                label={t("editor.reports.labels")}
                hint={t("tasks.report.labelsHint")}
                onChange={(labels) => onChange({ labels })}
              />
            </>
          )}
          <Field label={t("tasks.report.due")}>
            <Select
              value={filters.due}
              onValueChange={(value) => onChange({ due: value as TaskReportDue })}
              options={taskReportDueWindows.map((value) => ({
                value,
                label: translateKey(t, `tasks.due.${value}`),
              }))}
            />
          </Field>
          <Field label={t("tasks.report.status")}>
            <Select
              value={filters.status}
              onValueChange={(value) => onChange({ status: value as TaskReportStatus })}
              options={taskReportStatuses.map((value) => ({
                value,
                label: translateKey(t, `tasks.status.${value}`),
              }))}
            />
          </Field>
        </div>
      ) : null}
      <TaskTable
        query={reportQuery(filters)}
        showAssignee={!filters.assignedToViewer && !filters.assignee}
        emptyTitle={
          hasActiveFilters(filters) ? t("tasks.report.emptyTitle") : t("tasks.report.firstUseTitle")
        }
        emptyDescription={
          hasActiveFilters(filters)
            ? t("tasks.report.emptyDescription")
            : filters.seriesId
              ? t("tasks.report.firstUseSeriesDescription")
              : t("tasks.report.firstUseDescription")
        }
      />
    </section>
  );
}
