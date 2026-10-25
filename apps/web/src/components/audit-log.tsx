import { auditEventNames } from "@lunedo/shared";
import {
  Button,
  Combobox,
  type ComboboxItem,
  Dialog,
  Select,
  Table,
  TableToolbar,
  TruncatedText,
} from "@lunedo/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { LoadError, useFailureToast } from "../errors/failure.js";
import { describeUserAgent } from "../format/user-agent.js";
import { translateKey } from "../i18n/translate.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { settingField } from "../settings/setting-fields.js";
import {
  type AuditContext,
  type AuditItem,
  actionLabel,
  actorLabel,
  changeSummary,
  formatAuditValue,
  propertyLabel,
  scopeLabel,
  targetLabel,
  targetTypeLabel,
} from "./audit-presentation.js";
import { AppDatePicker } from "./date-fields.js";
import { downloadBlob } from "./download.js";
import { accountLoader, memberLoader } from "./pickers.js";
import { useSettingValueFormatter } from "./settings-list.js";
import { usePageSize } from "./table-state.js";

export function auditEventKey(name: string): string {
  return `audit.events.${name}`;
}

export const AUDIT_PERIODS = ["all", "day", "week", "month", "custom"] as const;
type Period = (typeof AUDIT_PERIODS)[number];

const PERIOD_DAYS: Record<"day" | "week" | "month", number> = { day: 1, week: 7, month: 30 };

interface Filters {
  period: Period;
  from: string;
  to: string;
  name: string;
  actorId: string;
}

const EMPTY: Filters = { period: "all", from: "", to: "", name: "", actorId: "" };

export function periodStart(period: Period, now: Date): string | undefined {
  if (period === "all" || period === "custom") return undefined;
  return new Date(now.getTime() - PERIOD_DAYS[period] * 86_400_000).toISOString();
}

function toQuery(filters: Filters, now: Date) {
  const since = periodStart(filters.period, now);
  const custom = filters.period === "custom";
  return {
    ...(since ? { from: since } : {}),
    ...(custom && filters.from ? { from: new Date(`${filters.from}T00:00:00`).toISOString() } : {}),
    ...(custom && filters.to ? { to: new Date(`${filters.to}T23:59:59.999`).toISOString() } : {}),
    ...(filters.name ? { name: filters.name } : {}),
    ...(filters.actorId ? { actorId: filters.actorId } : {}),
  };
}

function useAuditContext(): AuditContext {
  const { t } = useTranslation();
  const format = useFormat();
  const formatValue = useSettingValueFormatter();
  return useMemo(
    () => ({ t, format, formatSetting: (key, value) => formatValue(settingField(key), value) }),
    [t, format, formatValue],
  );
}

export function AuditLog({
  scope,
  organizationId,
  canExport,
}: {
  scope: "organization" | "instance";
  organizationId?: string;
  canExport: boolean;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const context = useAuditContext();
  const showFailure = useFailureToast();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [exporting, setExporting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingEdge, setPendingEdge] = useState<"first" | "last" | null>(null);
  const [actor, setActor] = useState<ComboboxItem | null>(null);
  const actorLoader = useMemo(
    () => (organizationId ? memberLoader(organizationId) : accountLoader()),
    [organizationId],
  );
  const cursor = cursors.at(-1);
  const { pageSize, setPageSize } = usePageSize();
  const [now, setNow] = useState(() => new Date());
  const query = useMemo(() => toQuery(filters, now), [filters, now]);

  const events = useQuery({
    queryKey: ["audit", scope, organizationId ?? null, query, cursor ?? null, pageSize],
    placeholderData: keepPreviousData,
    throwOnError: false,
    queryFn: () =>
      scope === "organization" && organizationId
        ? request(() =>
            api.GET("/api/v1/organizations/{organizationId}/audit-events", {
              params: {
                path: { organizationId },
                query: { ...query, limit: pageSize, ...(cursor ? { cursor } : {}) },
              },
            }),
          )
        : request(() =>
            api.GET("/api/v1/instance/audit-events", {
              params: { query: { ...query, limit: pageSize, ...(cursor ? { cursor } : {}) } },
            }),
          ),
  });

  const items = (events.data?.items ?? []) as AuditItem[];
  const index = selectedId ? items.findIndex((item) => item.id === selectedId) : -1;
  const selected = index >= 0 ? (items[index] ?? null) : null;
  const pageLoaded = !events.isPlaceholderData && !events.isFetching;
  const hasPrevious = index > 0 || cursors.length > 1;
  const hasNext = (index >= 0 && index < items.length - 1) || Boolean(events.data?.nextCursor);

  useEffect(() => {
    if (!pendingEdge || !pageLoaded) return;
    const edge = pendingEdge === "first" ? items[0] : items.at(-1);
    setPendingEdge(null);
    setSelectedId(edge?.id ?? null);
  }, [pendingEdge, pageLoaded, items]);

  const step = (direction: -1 | 1) => {
    if (pendingEdge) return;
    const neighbour = items[index + direction];
    if (neighbour) {
      setSelectedId(neighbour.id);
      return;
    }
    if (direction === 1) {
      const next = events.data?.nextCursor;
      if (!next) return;
      setCursors((current) => [...current, next]);
      setPendingEdge("first");
      return;
    }
    if (cursors.length < 2) return;
    setCursors((current) => current.slice(0, -1));
    setPendingEdge("last");
  };

  const update = (patch: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setCursors([undefined]);
    setNow(new Date());
  };

  const pagination = {
    hasPrevious: cursors.length > 1,
    hasNext: Boolean(events.data?.nextCursor),
    onPrevious: () => setCursors((current) => current.slice(0, -1)),
    onNext: () => {
      const next = events.data?.nextCursor;
      if (next) setCursors((current) => [...current, next]);
    },
    pageSize,
    onPageSizeChange: (size: number) => {
      setCursors([undefined]);
      setPageSize(size);
    },
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const blob = await request(() =>
        scope === "organization" && organizationId
          ? api.GET("/api/v1/organizations/{organizationId}/audit-events/export", {
              params: { path: { organizationId }, query },
              parseAs: "blob",
            })
          : api.GET("/api/v1/instance/audit-events/export", { params: { query }, parseAs: "blob" }),
      );
      downloadBlob(`lunedo-audit-${new Date().toISOString().slice(0, 10)}.csv`, blob as Blob);
    } catch (failure) {
      showFailure(t("failures.exportAudit"), failure, () => void exportCsv());
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <TableToolbar
        filters={
          <>
            <Select
              aria-label={t("audit.period")}
              value={filters.period}
              className="w-auto"
              onValueChange={(value) => update({ period: value as Period })}
              options={AUDIT_PERIODS.map((period) => ({
                value: period,
                label: translateKey(t, `audit.periods.${period}`),
              }))}
            />
            {filters.period === "custom" ? (
              <>
                <AppDatePicker
                  aria-label={t("audit.from")}
                  placeholder={t("audit.from")}
                  value={filters.from}
                  clearable
                  className="w-auto"
                  {...(filters.to ? { max: filters.to } : {})}
                  onValueChange={(value) => update({ from: value })}
                />
                <AppDatePicker
                  aria-label={t("audit.to")}
                  placeholder={t("audit.to")}
                  value={filters.to}
                  clearable
                  className="w-auto"
                  {...(filters.from ? { min: filters.from } : {})}
                  onValueChange={(value) => update({ to: value })}
                />
              </>
            ) : null}
            <div className="w-field max-w-full">
              <Combobox
                aria-label={t("audit.action")}
                placeholder={t("audit.allEvents")}
                value={filters.name || null}
                onValueChange={(value) => update({ name: value ?? "" })}
                items={auditEventNames.map((name) => ({
                  value: name,
                  label: translateKey(t, auditEventKey(name)),
                }))}
              />
            </div>
            <div className="w-field max-w-full">
              <Combobox
                aria-label={t("audit.actor")}
                placeholder={t("audit.everyone")}
                value={actor?.value ?? null}
                selectedItem={actor}
                load={actorLoader}
                onValueChange={(value, item) => {
                  setActor(item);
                  update({ actorId: value ?? "" });
                }}
              />
            </div>
          </>
        }
        filtersActive={JSON.stringify(filters) !== JSON.stringify(EMPTY)}
        onResetFilters={() => {
          setActor(null);
          update(EMPTY);
        }}
        pagination={pagination}
        actions={
          canExport ? (
            <Button
              variant="secondary"
              size="sm"
              icon={Download}
              loading={exporting}
              onClick={() => void exportCsv()}
            >
              {t("audit.export")}
            </Button>
          ) : null
        }
      />
      {events.isError ? (
        <LoadError what={t("failures.loadAudit")} error={events.error} onRetry={() => events.refetch()} />
      ) : null}
      <Table
        caption={t("audit.eventsTitle")}
        rowKey={(event) => event.id}
        rows={items}
        loading={events.isPending}
        onRowClick={(event: AuditItem) => setSelectedId(event.id)}
        empty={<p className="p-4 text-text-muted">{t("audit.none")}</p>}
        pagination={pagination}
        columns={[
          {
            key: "time",
            header: t("audit.time"),
            cell: (event) => (
              <time dateTime={event.occurredAt} className="whitespace-nowrap">
                {format.dateTime(event.occurredAt)}
              </time>
            ),
          },
          {
            key: "actor",
            header: t("audit.actor"),
            hideBelow: "sm",
            cell: (event) => <TruncatedText text={actorLabel(t, event)} className="max-w-field" />,
          },
          {
            key: "action",
            header: t("audit.action"),
            cell: (event) => (
              <button
                type="button"
                className="rounded-sm text-left font-medium text-text hover:underline focus-visible:focus-ring"
                aria-label={t("audit.showDetails", { action: actionLabel(t, event) })}
                onClick={(clicked) => {
                  clicked.stopPropagation();
                  setSelectedId(event.id);
                }}
              >
                {actionLabel(t, event)}
              </button>
            ),
          },
          {
            key: "target",
            header: t("audit.target"),
            cell: (event) => (
              <div className="flex max-w-field min-w-0 flex-col leading-tight">
                <TruncatedText text={targetLabel(t, event)} />
                <span
                  className="truncate text-text-muted text-xs"
                  title={[changeSummary(context, event), scopeLabel(t, event)].filter(Boolean).join(" · ")}
                >
                  {changeSummary(context, event) ? (
                    <>
                      <span>{changeSummary(context, event)}</span>
                      {" · "}
                    </>
                  ) : null}
                  <span>{scopeLabel(t, event)}</span>
                </span>
              </div>
            ),
          },
          {
            key: "address",
            header: t("audit.address"),
            hideBelow: "md",
            cell: (event) => (
              <span className="font-mono text-sm text-text-muted">{event.clientIp ?? ""}</span>
            ),
          },
        ]}
      />
      <Dialog
        open={selectedId !== null}
        onOpenChange={(open) => {
          if (open) return;
          setSelectedId(null);
          setPendingEdge(null);
        }}
        title={selected ? actionLabel(t, selected) : t("audit.loadingEvent")}
        size="lg"
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-text-muted" aria-live="polite">
              {!hasPrevious ? t("audit.firstEvent") : !hasNext ? t("audit.lastEvent") : null}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" icon={ChevronLeft} disabled={!hasPrevious} onClick={() => step(-1)}>
                {t("audit.previousEvent")}
              </Button>
              <Button variant="outline" icon={ChevronRight} disabled={!hasNext} onClick={() => step(1)}>
                {t("audit.nextEvent")}
              </Button>
            </div>
          </div>
        }
      >
        {selected ? <AuditDetails item={selected} context={context} /> : null}
      </Dialog>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-text-muted text-xs">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

export function AuditDetails({ item, context }: { item: AuditItem; context: AuditContext }) {
  const { t, format } = context;
  const client = item.userAgent ? describeUserAgent(item.userAgent) : null;
  const browser = client
    ? [client.browser, client.system].filter(Boolean).join(t("audit.on")) || item.userAgent
    : null;
  return (
    <div className="flex flex-col gap-4">
      <dl className="flex flex-col gap-3">
        <DetailRow label={t("audit.time")}>{format.dateTime(item.occurredAt)}</DetailRow>
        <DetailRow label={t("audit.actor")}>{actorLabel(t, item)}</DetailRow>
        <DetailRow label={t("audit.target")}>
          {targetLabel(t, item)}
          {item.changeKind === "setting" ? null : (
            <span className="text-text-muted"> · {targetTypeLabel(t, item.target.type)}</span>
          )}
        </DetailRow>
        <DetailRow label={t("audit.scope")}>{scopeLabel(t, item)}</DetailRow>
      </dl>
      {item.peopleHidden ? <p className="text-text-muted text-sm">{t("audit.peopleHidden")}</p> : null}
      <section aria-labelledby={`changes-${item.id}`} className="flex flex-col gap-2">
        <h3 id={`changes-${item.id}`} className="font-semibold">
          {t("audit.changes")}
        </h3>
        {item.changes.length === 0 ? (
          <p className="text-text-muted text-sm">{t("audit.noChanges")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {item.changes.map((change) => (
              <li key={change.property} className="rounded-md border border-border p-2 text-sm">
                <div className="font-medium">{propertyLabel(t, item, change.property)}</div>
                <div className="flex flex-col">
                  <span>
                    <span className="text-text-muted">{t("audit.before")} </span>
                    {formatAuditValue(context, item, change.property, change.old)}
                  </span>
                  <span>
                    <span className="text-text-muted">{t("audit.after")} </span>
                    {formatAuditValue(context, item, change.property, change.new)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <dl className="flex flex-col gap-3">
        <DetailRow label={t("audit.clientIp")}>{item.clientIp ?? t("common.unknown")}</DetailRow>
        <DetailRow label={t("audit.browser")}>{browser ?? t("common.unknown")}</DetailRow>
        <DetailRow label={t("audit.requestId")}>
          <span className="font-mono text-sm">{item.requestId ?? t("common.unknown")}</span>
        </DetailRow>
      </dl>
      <details className="rounded-md border border-border">
        <summary className="cursor-pointer rounded-md px-3 py-2 font-medium focus-visible:focus-ring">
          {t("audit.rawEvent")}
        </summary>
        <pre className="overflow-x-auto border-border border-t p-3 font-mono text-xs">
          {JSON.stringify(
            {
              id: item.id,
              name: item.name,
              scopeType: item.scopeType,
              scopeId: item.scopeId,
              sequence: item.sequence,
              actorType: item.actorType,
              actorId: item.actorId,
              targetType: item.targetType,
              targetId: item.targetId,
              fields: item.fields,
              occurredAt: item.occurredAt,
              requestId: item.requestId,
              clientIp: item.clientIp,
              userAgent: item.userAgent,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </div>
  );
}
