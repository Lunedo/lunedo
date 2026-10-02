import {
  Badge,
  type BadgeVariant,
  Button,
  Drawer,
  DurationSelect,
  Notice,
  Section,
  Select,
  SettingRow,
  Skeleton,
  Table,
  TableToolbar,
  Textarea,
  useToast,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import {
  hasDirectory,
  type IdentityProvider,
  identityKeys,
  removeDirectoryKey,
  type SyncRun,
  type SyncRunDetail,
  type SyncRunFilter,
  setDirectoryKey,
  startSync,
  syncRunQuery,
  syncRunsQuery,
} from "../../api/identity-queries.js";
import { AutoSaveTextField, SaveIndicator, useSaveState } from "../../components/auto-save.js";
import { FailureNotice, LoadError, useFailureToast } from "../../errors/failure.js";
import { translateKey } from "../../i18n/translate.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { useProviderUpdate } from "./provider-config.js";

const STATUS_VARIANT: Record<SyncRun["status"], BadgeVariant> = {
  running: "info",
  succeeded: "success",
  warnings: "warning",
  failed: "danger",
};

export function syncSummary(t: TFunction, run: SyncRun): string {
  if (run.status === "failed") return run.error ?? t("identityProviders.sync.failedWithoutReason");
  if (run.status === "running") return t("identityProviders.sync.inProgress");
  if (run.changeCount === 0 && run.warningCount === 0) return t("identityProviders.sync.noChanges");
  return [
    run.changeCount > 0 ? t("identityProviders.sync.changes", { count: run.changeCount }) : null,
    run.warningCount > 0 ? t("identityProviders.sync.warnings", { count: run.warningCount }) : null,
  ]
    .filter(Boolean)
    .join(", ");
}

export function durationText(t: TFunction, durationMs: number | null): string {
  if (durationMs === null) return "–";
  return durationMs < 1000
    ? t("identityProviders.sync.milliseconds", { value: durationMs })
    : t("identityProviders.sync.seconds", { value: Math.round(durationMs / 1000) });
}

export function SyncTab({ provider, canManage }: { provider: IdentityProvider; canManage: boolean }) {
  const { t } = useTranslation();
  const format = useFormat();
  const { toast } = useToast();
  const showFailure = useFailureToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<SyncRunFilter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const runs = useQuery({ ...syncRunsQuery(provider.id, filter), throwOnError: false });
  const directory = hasDirectory(provider);

  const syncNow = async () => {
    setStarting(true);
    try {
      await startSync(provider.id);
      toast({ title: t("identityProviders.sync.started"), variant: "success" });
      await queryClient.invalidateQueries({ queryKey: ["identityProviders", provider.id, "syncRuns"] });
    } catch (failure) {
      showFailure(t("failures.startSync"), failure);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {!directory ? <Notice variant="info">{t("identityProviders.sync.signInOnly")}</Notice> : null}
      <TableToolbar
        filters={
          <div className="w-field max-w-full">
            <Select
              aria-label={t("identityProviders.sync.filter")}
              value={filter}
              onValueChange={(value) => setFilter(value as SyncRunFilter)}
              options={[
                { value: "all", label: t("identityProviders.sync.filterAll") },
                { value: "changes", label: t("identityProviders.sync.filterChanges") },
                { value: "failed", label: t("identityProviders.sync.filterFailed") },
              ]}
            />
          </div>
        }
        filtersActive={filter !== "all"}
        onResetFilters={() => setFilter("all")}
        actions={
          canManage ? (
            <Button
              variant="primary"
              icon={RefreshCw}
              loading={starting}
              disabled={!directory}
              {...(directory ? {} : { title: t("identityProviders.sync.noDirectory") })}
              onClick={() => void syncNow()}
            >
              {t("identityProviders.sync.now")}
            </Button>
          ) : undefined
        }
      />
      {runs.isError ? (
        <LoadError what={t("failures.loadSyncRuns")} error={runs.error} onRetry={() => runs.refetch()} />
      ) : (
        <Table
          caption={t("identityProviders.sync.caption")}
          rows={runs.data?.items ?? []}
          rowKey={(run) => run.id}
          loading={runs.isPending}
          empty={t("identityProviders.sync.empty")}
          onRowClick={(run) => setOpen(run.id)}
          rowLabel={(run) => t("identityProviders.sync.open", { time: format.dateTime(run.startedAt) })}
          columns={[
            {
              key: "started",
              header: t("identityProviders.sync.startedAt"),
              cell: (run) => <span className="whitespace-nowrap">{format.dateTime(run.startedAt)}</span>,
            },
            {
              key: "trigger",
              header: t("identityProviders.sync.trigger"),
              cell: (run) => translateKey(t, `identityProviders.sync.triggers.${run.trigger}`),
            },
            {
              key: "result",
              header: t("identityProviders.sync.result"),
              cell: (run) => (
                <Badge variant={STATUS_VARIANT[run.status]}>
                  {translateKey(t, `identityProviders.sync.statuses.${run.status}`)}
                </Badge>
              ),
            },
            {
              key: "summary",
              header: t("identityProviders.sync.summary"),
              cell: (run) => syncSummary(t, run),
            },
            {
              key: "duration",
              header: t("identityProviders.sync.duration"),
              align: "end",
              cell: (run) => <span className="tabular-nums">{durationText(t, run.durationMs)}</span>,
            },
          ]}
        />
      )}
      <Drawer
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
        title={t("identityProviders.sync.detailTitle")}
        size="panel"
      >
        {open ? <RunDetail providerId={provider.id} runId={open} /> : null}
      </Drawer>
    </div>
  );
}

function withKeys<T>(items: readonly T[], base: (item: T) => string): { key: string; item: T }[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const value = base(item);
    const count = seen.get(value) ?? 0;
    seen.set(value, count + 1);
    return { key: `${value}#${count}`, item };
  });
}

function name(detail: SyncRunDetail, id: string | null): string | null {
  return id ? (detail.references[id] ?? null) : null;
}

function RunDetail({ providerId, runId }: { providerId: string; runId: string }) {
  const { t } = useTranslation();
  const format = useFormat();
  const run = useQuery({ ...syncRunQuery(providerId, runId), throwOnError: false });
  if (run.isPending) return <Skeleton className="h-32 w-full" />;
  if (run.isError) {
    return (
      <FailureNotice what={t("failures.loadSyncRun")} error={run.error} onRetry={() => void run.refetch()} />
    );
  }
  const detail = run.data;
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-text-muted">{t("identityProviders.sync.startedAt")}</dt>
        <dd>{format.dateTime(detail.startedAt)}</dd>
        <dt className="text-text-muted">{t("identityProviders.sync.trigger")}</dt>
        <dd>{translateKey(t, `identityProviders.sync.triggers.${detail.trigger}`)}</dd>
        <dt className="text-text-muted">{t("identityProviders.sync.result")}</dt>
        <dd>{translateKey(t, `identityProviders.sync.statuses.${detail.status}`)}</dd>
        <dt className="text-text-muted">{t("identityProviders.sync.duration")}</dt>
        <dd>{durationText(t, detail.durationMs)}</dd>
      </dl>
      {detail.error ? (
        <Notice variant="danger" title={t("identityProviders.sync.errorTitle")}>
          {detail.error}
        </Notice>
      ) : null}
      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">{t("identityProviders.sync.changesTitle")}</h3>
        {detail.changes.length === 0 ? (
          <p className="text-sm text-text-muted">{t("identityProviders.sync.noChanges")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {withKeys(detail.changes, (change) =>
              [change.kind, change.accountId, change.organizationId, change.detail].join(":"),
            ).map(({ key, item: change }) => (
              <li key={key} className="flex flex-col gap-1 py-2">
                <span className="font-medium">
                  {translateKey(t, `identityProviders.sync.changeKinds.${change.kind}`)}
                </span>
                <span className="text-sm text-text-muted">
                  {[name(detail, change.accountId), name(detail, change.organizationId), change.detail]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">{t("identityProviders.sync.warningsTitle")}</h3>
        {detail.warnings.length === 0 ? (
          <p className="text-sm text-text-muted">{t("identityProviders.sync.noWarnings")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {withKeys(detail.warnings, (warning) =>
              [warning.kind, warning.accountId, warning.ruleId, warning.detail].join(":"),
            ).map(({ key, item: warning }) => (
              <li key={key} className="flex flex-col gap-1 py-2">
                <span className="font-medium">
                  {translateKey(t, `identityProviders.sync.warningKinds.${warning.kind}`)}
                </span>
                <span className="text-sm text-text-muted">
                  {[name(detail, warning.accountId), name(detail, warning.ruleId), warning.detail]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function SyncSettings({ provider, canManage }: { provider: IdentityProvider; canManage: boolean }) {
  const { t, i18n } = useTranslation();
  const update = useProviderUpdate(provider);
  const interval = useSaveState();
  const config = provider.config;
  if (config.preset === "generic") return null;
  return (
    <Section title={t("identityProviders.sync.settingsTitle")}>
      <SettingRow
        label={t("identityProviders.sync.interval")}
        description={t("identityProviders.sync.intervalHint")}
        control={
          <DurationSelect
            aria-label={t("identityProviders.sync.interval")}
            value={config.sync.intervalMinutes}
            choices={[15, 60, 240, 1440]}
            units={["minutes", "hours"]}
            min={15}
            max={1440}
            locale={i18n.language}
            disabled={!canManage}
            onValueChange={(minutes) => {
              if (minutes === null) return;
              void interval.run(() =>
                update.config((current) => ({ ...current, sync: { intervalMinutes: minutes } })),
              );
            }}
          />
        }
        status={<SaveIndicator tracker={interval} />}
      />
      <SettingRow
        label={t("identityProviders.sync.whenDisabled")}
        description={t("identityProviders.sync.whenDisabledHint", { provider: provider.name })}
        control={<span className="text-text-muted">{t("identityProviders.sync.deactivate")}</span>}
      />
      {config.preset === "google" ? <GoogleDirectory provider={provider} canManage={canManage} /> : null}
    </Section>
  );
}

function GoogleDirectory({ provider, canManage }: { provider: IdentityProvider; canManage: boolean }) {
  const { t } = useTranslation();
  const update = useProviderUpdate(provider);
  const queryClient = useQueryClient();
  const showFailure = useFailureToast();
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const config = provider.config;
  if (config.preset !== "google") return null;
  const refresh = () => queryClient.invalidateQueries({ queryKey: identityKeys.provider(provider.id) });
  const saveKey = async () => {
    setSaving(true);
    try {
      await setDirectoryKey(provider.id, key.trim());
      setKey("");
      await refresh();
    } catch (failure) {
      showFailure(t("failures.saveDirectoryKey"), failure);
    } finally {
      setSaving(false);
    }
  };
  const removeKey = async () => {
    try {
      await removeDirectoryKey(provider.id);
      await refresh();
    } catch (failure) {
      showFailure(t("failures.removeDirectoryKey"), failure);
    }
  };
  return (
    <div className="flex flex-col gap-4 px-4 py-3">
      <AutoSaveTextField
        label={t("identityProviders.sync.adminEmail")}
        hint={t("identityProviders.sync.adminEmailHint")}
        value={config.directory?.adminEmail ?? ""}
        schema={z.union([z.literal(""), z.email()])}
        disabled={!canManage}
        onSave={(adminEmail) =>
          update.config((current) =>
            current.preset === "google"
              ? { ...current, directory: adminEmail ? { adminEmail } : null }
              : current,
          )
        }
      />
      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-2 font-medium">
          {t("identityProviders.sync.serviceAccountKey")}
          {provider.directoryKey ? (
            <Badge variant="success">{t("identityProviders.sync.keyStored")}</Badge>
          ) : (
            <Badge variant="neutral">{t("identityProviders.sync.noKey")}</Badge>
          )}
        </span>
        {canManage ? (
          <>
            <Textarea
              aria-label={t("identityProviders.sync.serviceAccountKey")}
              value={key}
              rows={4}
              className="font-mono"
              placeholder={t("identityProviders.sync.keyPlaceholder")}
              onChange={(event) => setKey(event.target.value)}
            />
            <div className="flex flex-wrap justify-end gap-2">
              {provider.directoryKey ? (
                <Button variant="danger" onClick={() => void removeKey()}>
                  {t("identityProviders.sync.removeKey")}
                </Button>
              ) : null}
              <Button
                variant="outline"
                loading={saving}
                disabled={key.trim() === ""}
                onClick={() => void saveKey()}
              >
                {t("identityProviders.sync.saveKey")}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
