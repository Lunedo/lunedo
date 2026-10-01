import { Button, Field, Input, Notice, Section, Select, Table } from "@pagehall/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download, FilterX } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { useFailureToast } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { translateKey } from "../i18n/translate.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { downloadBlob } from "./download.js";

export const AUDIT_EVENTS = [
  "auth.signedIn",
  "auth.signInFailed",
  "auth.lockedOut",
  "auth.signedOut",
  "auth.sessionEnded",
  "auth.reauthenticated",
  "auth.reauthenticationFailed",
  "account.created",
  "account.passwordChanged",
  "account.passwordResetRequested",
  "account.passwordReset",
  "account.emailChangeRequested",
  "account.emailChanged",
  "account.deactivated",
  "twoFactor.totpAdded",
  "twoFactor.totpRemoved",
  "twoFactor.passkeyAdded",
  "twoFactor.passkeyRemoved",
  "twoFactor.recoveryCodesGenerated",
  "twoFactor.recoveryCodeUsed",
  "setup.sessionStarted",
  "setup.stepCompleted",
  "setup.keyBackupDownloaded",
  "setup.completed",
  "mail.smtpChanged",
  "mail.testSent",
  "settings.changed",
  "organization.created",
  "organization.updated",
  "organization.domainAdded",
  "organization.domainRemoved",
  "membership.added",
  "membership.updated",
  "membership.removed",
  "role.created",
  "role.updated",
  "role.deleted",
  "role.assigned",
  "role.unassigned",
  "group.created",
  "group.updated",
  "group.deleted",
  "group.memberAdded",
  "group.memberRemoved",
  "group.managerAdded",
  "group.managerRemoved",
  "invitation.created",
  "invitation.accepted",
  "invitation.revoked",
  "guest.responsibleChanged",
  "instance.ownershipTransferred",
  "breakGlass.started",
  "breakGlass.actionAuthorized",
  "breakGlass.ended",
  "serviceAccount.created",
  "serviceAccount.updated",
  "serviceAccount.responsiblesChanged",
  "serviceAccount.unattended",
  "serviceAccount.deactivated",
  "apiToken.created",
  "apiToken.updated",
  "apiToken.revoked",
  "apiToken.expired",
  "apiToken.rejected",
  "audit.exported",
] as const;

export function auditEventKey(name: string): string {
  return `auditEvents.${name.replace(".", "_")}`;
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
  const showFailure = useFailureToast();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [exporting, setExporting] = useState(false);
  const cursor = cursors.at(-1);
  const query = toQuery(filters);
  const names = new Map(people.map((person) => [person.id, person.name]));

  const events = useQuery({
    queryKey: ["audit", scope, organizationId ?? null, query, cursor ?? null],
    placeholderData: keepPreviousData,
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
      showFailure(t("failures.exportAudit"), failure);
    } finally {
      setExporting(false);
    }
  };

  const describe = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    if (typeof value !== "object") return String(value);
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => `${key}: ${typeof entry === "object" ? JSON.stringify(entry) : String(entry)}`)
      .join(", ");
  };

  return (
    <Section
      title={t("audit.events")}
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
          <Field label={t("audit.event")}>
            <Select
              value={filters.name || "all"}
              onValueChange={(value) => update({ name: value === "all" ? "" : value })}
              options={[
                { value: "all", label: t("audit.allEvents") },
                ...AUDIT_EVENTS.map((name) => ({ value: name, label: translateKey(t, auditEventKey(name)) })),
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
          <Notice variant="danger">{problemMessage(t, events.error)}</Notice>
        </div>
      ) : null}
      <Table
        caption={t("audit.events")}
        rowKey={(event) => event.id}
        rows={events.data?.items ?? []}
        loading={events.isPending}
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
            cell: (event) => <time dateTime={event.occurredAt}>{format.dateTime(event.occurredAt)}</time>,
          },
          {
            key: "event",
            header: t("audit.event"),
            cell: (event) => (
              <div className="flex flex-col">
                <span className="font-medium">{translateKey(t, auditEventKey(event.name))}</span>
                <span className="font-mono text-text-muted text-xs">{event.name}</span>
              </div>
            ),
          },
          {
            key: "actor",
            header: t("audit.actor"),
            hideBelow: "sm",
            cell: (event) =>
              event.actorId
                ? (names.get(event.actorId) ?? event.actorId)
                : translateKey(t, `audit.actorTypes.${event.actorType}`),
          },
          {
            key: "details",
            header: t("audit.details"),
            hideBelow: "md",
            cell: (event) => (
              <span className="break-all text-sm text-text-muted">{describe(event.fields)}</span>
            ),
          },
        ]}
      />
    </Section>
  );
}
