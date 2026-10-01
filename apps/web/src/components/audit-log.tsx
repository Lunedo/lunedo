import { auditEventNames } from "@pagehall/shared";
import { Button, Drawer, Field, Input, Section, Select, Table, TruncatedText } from "@pagehall/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download, FilterX } from "lucide-react";
import { useMemo, useState } from "react";
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
import { downloadBlob } from "./download.js";
import { useSettingValueFormatter } from "./settings-list.js";

export function auditEventKey(name: string): string {
  return `audit.events.${name}`;
}

interface Filters {
  from: string;
  to: string;
  name: string;
  actorId: string;
}

const EMPTY: Filters = { from: "", to: "", name: "", actorId: "" };

function toQuery(filters: Filters) {
  return {
    ...(filters.from ? { from: new Date(`${filters.from}T00:00:00`).toISOString() } : {}),
    ...(filters.to ? { to: new Date(`${filters.to}T23:59:59.999`).toISOString() } : {}),
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
  people,
  canExport,
}: {
  scope: "organization" | "instance";
  organizationId?: string;
  people: { id: string; name: string }[];
  canExport: boolean;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const context = useAuditContext();
  const showFailure = useFailureToast();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<AuditItem | null>(null);
  const cursor = cursors.at(-1);
  const query = toQuery(filters);

  const events = useQuery({
    queryKey: ["audit", scope, organizationId ?? null, query, cursor ?? null],
    placeholderData: keepPreviousData,
    throwOnError: false,
    queryFn: () =>
      scope === "organization" && organizationId
        ? request(() =>
            api.GET("/api/v1/organizations/{organizationId}/audit-events", {
              params: {
                path: { organizationId },
                query: { ...query, limit: 50, ...(cursor ? { cursor } : {}) },
              },
            }),
          )
        : request(() =>
            api.GET("/api/v1/instance/audit-events", {
              params: { query: { ...query, limit: 50, ...(cursor ? { cursor } : {}) } },
            }),
          ),
  });

  const update = (patch: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setCursors([undefined]);
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
      downloadBlob(`pagehall-audit-${new Date().toISOString().slice(0, 10)}.csv`, blob as Blob);
    } catch (failure) {
      showFailure(t("failures.exportAudit"), failure, () => void exportCsv());
    } finally {
      setExporting(false);
    }
  };

  return (
    <Section
      title={t("audit.eventsTitle")}
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
    >
      <div className="flex flex-wrap items-end gap-3 p-4">
        <Field label={t("audit.from")}>
          <Input
            type="date"
            value={filters.from}
            onChange={(event) => update({ from: event.target.value })}
          />
        </Field>
        <Field label={t("audit.to")}>
          <Input type="date" value={filters.to} onChange={(event) => update({ to: event.target.value })} />
        </Field>
        <div className="w-field max-w-full">
          <Field label={t("audit.action")}>
            <Select
              value={filters.name || "all"}
              onValueChange={(value) => update({ name: value === "all" ? "" : value })}
              options={[
                { value: "all", label: t("audit.allEvents") },
                ...auditEventNames.map((name) => ({
                  value: name,
                  label: translateKey(t, auditEventKey(name)),
                })),
              ]}
            />
          </Field>
        </div>
        <div className="w-field max-w-full">
          <Field label={t("audit.actor")}>
            <Select
              value={filters.actorId || "all"}
              onValueChange={(value) => update({ actorId: value === "all" ? "" : value })}
              options={[
                { value: "all", label: t("audit.everyone") },
                ...people.map((person) => ({ value: person.id, label: person.name })),
              ]}
            />
          </Field>
        </div>
        <Button
          variant="secondary"
          icon={FilterX}
          disabled={JSON.stringify(filters) === JSON.stringify(EMPTY)}
          onClick={() => update(EMPTY)}
        >
          {t("audit.resetFilters")}
        </Button>
      </div>
      {events.isError ? (
        <div className="px-4 pb-4">
          <LoadError what={t("failures.loadAudit")} error={events.error} onRetry={() => events.refetch()} />
        </div>
      ) : null}
      <Table
        caption={t("audit.eventsTitle")}
        rowKey={(event) => event.id}
        rows={(events.data?.items ?? []) as AuditItem[]}
        loading={events.isPending}
        onRowClick={(event: AuditItem) => setSelected(event)}
        empty={<p className="p-4 text-text-muted">{t("audit.none")}</p>}
        pagination={{
          hasPrevious: cursors.length > 1,
          hasNext: Boolean(events.data?.nextCursor),
          onPrevious: () => setCursors((current) => current.slice(0, -1)),
          onNext: () => {
            const next = events.data?.nextCursor;
            if (next) setCursors((current) => [...current, next]);
          },
        }}
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
            cell: (event) => <TruncatedText text={actorLabel(t, event)} />,
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
                  setSelected(event);
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
              <div className="flex min-w-0 flex-col">
                <TruncatedText text={targetLabel(t, event)} />
                <span className="text-text-muted text-xs">{scopeLabel(t, event)}</span>
              </div>
            ),
          },
          {
            key: "change",
            header: t("audit.change"),
            hideBelow: "md",
            cell: (event) => <span className="text-sm">{changeSummary(context, event)}</span>,
          },
        ]}
      />
      <Drawer
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title={selected ? actionLabel(t, selected) : ""}
        side="right"
        size="panel"
      >
        {selected ? <AuditDetails item={selected} context={context} /> : null}
      </Drawer>
    </Section>
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
    <div className="flex flex-col gap-4 p-4">
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
