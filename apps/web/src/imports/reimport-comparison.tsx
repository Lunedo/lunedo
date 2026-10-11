import { EmptyState, Field, SegmentedControl, Select, Skeleton } from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { GitCompareArrows, Lock } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/request.js";
import { LoadError, useFailureToast } from "../errors/failure.js";
import { translateKey } from "../i18n/translate.js";
import { SettingsPage } from "../screens/settings/settings-page.js";
import { type DiffLayout, DiffView } from "../spaces/versions/diff-view.js";
import { importQuery, refreshImport } from "./imports-api.js";
import {
  type ChangeComparison,
  type ChangeDecision,
  changeComparisonQuery,
  decideChanges,
} from "./reimport-api.js";

const route = getRouteApi(
  "/app/settings/organizations/$organizationId/imports/$importId/changes/$changeId/compare",
);

const DECISIONS: readonly ChangeDecision[] = ["pagehall", "source", "both"];
const UNDECIDED = "later";

function pagehallLabel(t: TFunction, comparison: ChangeComparison): string {
  return comparison.pagehall.version === null
    ? t("imports.reimport.comparison.pagehallCurrent")
    : t("imports.reimport.comparison.pagehallVersion", { number: comparison.pagehall.version });
}

function sourceLabel(t: TFunction, comparison: ChangeComparison): string {
  return comparison.source.version === null
    ? t("imports.reimport.comparison.source")
    : t("imports.reimport.comparison.sourceVersion", { number: comparison.source.version });
}

export function ReimportComparisonScreen() {
  const { t } = useTranslation();
  const { organizationId, importId, changeId } = route.useParams();
  const search = route.useSearch();
  const navigate = useNavigate();
  const entry = useQuery(importQuery(importId));
  const comparison = useQuery({ ...changeComparisonQuery(importId, changeId), throwOnError: false });
  const layout: DiffLayout = search.view === "sideBySide" ? "sideBySide" : "inline";
  const importHref = `/settings/organizations/${organizationId}/imports/${importId}?tab=conflicts`;
  const title = comparison.data
    ? t("imports.reimport.comparison.title", { title: comparison.data.pagehall.title })
    : t("imports.reimport.comparison.heading");
  const withheld = comparison.error instanceof ApiError && comparison.error.code === "comparisonWithheld";

  return (
    <SettingsPage
      title={title}
      description={t("imports.reimport.comparison.description")}
      icon={GitCompareArrows}
      organizationId={organizationId}
      width="wide"
      breadcrumbs={[
        { label: t("imports.title"), href: `/settings/organizations/${organizationId}/imports` },
        { label: t("imports.reimport.title"), href: importHref },
        { label: t("imports.reimport.comparison.heading") },
      ]}
    >
      {comparison.isPending ? (
        <Skeleton className="h-control-field w-full" />
      ) : withheld ? (
        <EmptyState
          icon={Lock}
          title={t("imports.reimport.comparison.withheldTitle")}
          description={t("imports.reimport.comparison.withheld")}
          action={
            <Link
              to="/settings/organizations/$organizationId/imports/$importId"
              params={{ organizationId, importId }}
              search={{ tab: "permissions" }}
              className="inline-flex h-control-md items-center rounded-md border border-control-border px-3 font-medium hover:bg-hover focus-visible:focus-ring"
            >
              {t("imports.reimport.comparison.openPermissions")}
            </Link>
          }
        />
      ) : comparison.isError ? (
        <LoadError
          what={t("imports.reimport.comparison.failed")}
          error={comparison.error}
          onRetry={comparison.refetch}
        />
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            {entry.data?.state === "review" ? (
              <DecisionField
                importId={importId}
                organizationId={organizationId}
                changeId={changeId}
                decision={comparison.data.decision}
                decisions={comparison.data.decisions}
                title={comparison.data.pagehall.title}
              />
            ) : null}
            <SegmentedControl
              label={t("versions.view")}
              value={layout}
              onValueChange={(value) =>
                void navigate({
                  to: ".",
                  search: value === "sideBySide" ? { view: "sideBySide" } : {},
                  replace: true,
                })
              }
              options={[
                { value: "inline", label: t("versions.inline") },
                { value: "sideBySide", label: t("versions.sideBySide") },
              ]}
            />
          </div>
          <p className="text-sm text-text-muted">
            {t("imports.reimport.comparison.sides", {
              before: pagehallLabel(t, comparison.data),
              after: sourceLabel(t, comparison.data),
            })}
          </p>
          <DiffView
            comparison={comparison.data}
            layout={layout}
            beforeLabel={pagehallLabel(t, comparison.data)}
            afterLabel={sourceLabel(t, comparison.data)}
          />
        </div>
      )}
    </SettingsPage>
  );
}

function DecisionField({
  importId,
  organizationId,
  changeId,
  decision,
  decisions,
  title,
}: {
  importId: string;
  organizationId: string;
  changeId: string;
  decision: ChangeDecision | null;
  decisions: readonly ChangeDecision[];
  title: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const failed = useFailureToast();
  const [saved, setSaved] = useState(false);
  const decide = async (next: ChangeDecision | null) => {
    setSaved(false);
    try {
      await decideChanges(importId, [changeId], next);
      await refreshImport(queryClient, importId, organizationId);
      setSaved(true);
    } catch (error) {
      failed(t("imports.reimport.decideFailed"), error, () => void decide(next));
    }
  };
  return (
    <Field
      label={t("imports.reimport.columns.decision")}
      hint={decisions.length < DECISIONS.length ? t("imports.reimport.restricted") : undefined}
    >
      <div className="flex items-center gap-2">
        <Select
          value={decision ?? undefined}
          onValueChange={(value) => void decide(value === UNDECIDED ? null : (value as ChangeDecision))}
          options={[
            ...decisions.map((value) => ({
              value,
              label: translateKey(t, `imports.reimport.decisions.${value}`),
            })),
            { value: UNDECIDED, label: t("imports.reimport.decisions.later") },
          ]}
          placeholder={t("imports.reimport.decide")}
          aria-label={t("imports.reimport.decisionFor", { title })}
        />
        {saved ? (
          <span role="status" className="text-sm text-success">
            {t("imports.reimport.saved")}
          </span>
        ) : null}
      </div>
    </Field>
  );
}
