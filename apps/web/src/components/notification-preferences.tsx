import {
  type EmailDelivery,
  emailDeliveries,
  type NotificationEvent,
  type NotificationEventGroup,
  notificationChannelSettingKey,
  notificationEvents,
} from "@pagehall/shared";
import { Button, Notice, Section, Select, Skeleton, Switch, Table } from "@pagehall/ui";
import { Building2, Lock, PenLine, Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SettingEntry } from "../api/organization-queries.js";
import { translateKey } from "../i18n/translate.js";
import { SaveIndicator, useSaveStates } from "./auto-save.js";
import { disabledReason, inheritedFrom, inheritedValue, type SettingLevel } from "./setting-source.js";

interface EventRow {
  event: NotificationEvent;
  inApp: SettingEntry;
  email: SettingEntry;
}

export function notificationRows(
  settings: readonly SettingEntry[] | undefined,
  group: NotificationEventGroup,
): EventRow[] {
  const byKey = new Map((settings ?? []).map((entry) => [entry.key, entry]));
  return notificationEvents.flatMap((event) => {
    if (event.group !== group) return [];
    const inApp = byKey.get(notificationChannelSettingKey(event.id, "inApp"));
    const email = byKey.get(notificationChannelSettingKey(event.id, "email"));
    return inApp && email ? [{ event, inApp, email }] : [];
  });
}

function isDelivery(value: unknown): value is EmailDelivery {
  return typeof value === "string" && (emailDeliveries as readonly string[]).includes(value);
}

function RowSource({
  row,
  level,
  organizationName,
}: {
  row: EventRow;
  level: SettingLevel;
  organizationName?: string | undefined;
}) {
  const { t } = useTranslation();
  const className = "inline-flex items-center gap-1 text-text-muted text-xs";
  const icon = "size-icon-sm shrink-0";
  const locked = [row.inApp, row.email].find((entry) => entry.lockedBy && entry.lockedBy !== level);
  if (locked) {
    return (
      <span className={className}>
        <Lock aria-hidden="true" className={icon} />
        {locked.lockedBy === "instance"
          ? t("settings.source.lockedByInstance")
          : t("settings.source.lockedByOrganization", { name: organizationName ?? "" })}
      </span>
    );
  }
  if (row.inApp.source === level || row.email.source === level) {
    return (
      <span className={className}>
        <PenLine aria-hidden="true" className={icon} />
        {level === "user"
          ? t("settings.source.setByYou")
          : level === "organization"
            ? t("settings.source.setForOrganization", { name: organizationName ?? "" })
            : t("settings.source.setForInstance")}
      </span>
    );
  }
  const from = [inheritedFrom(row.inApp, level), inheritedFrom(row.email, level)].includes("organization")
    ? "organization"
    : [inheritedFrom(row.inApp, level), inheritedFrom(row.email, level)].includes("instance")
      ? "instance"
      : "default";
  return (
    <span className={className}>
      {from === "organization" ? (
        <Building2 aria-hidden="true" className={icon} />
      ) : (
        <Server aria-hidden="true" className={icon} />
      )}
      {t(`notifications.source.${from}`, { name: organizationName ?? "" })}
    </span>
  );
}

function EventTable({
  rows,
  caption,
  level,
  organizationName,
  editable,
  onChange,
}: {
  rows: EventRow[];
  caption: string;
  level: SettingLevel;
  organizationName?: string | undefined;
  editable: boolean;
  onChange: (key: string, value: unknown) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const saveState = useSaveStates();
  const label = (row: EventRow) => translateKey(t, `notifications.events.${row.event.id}`);
  const save = (row: EventRow, key: string, value: unknown) =>
    void saveState(row.event.id).run(() => onChange(key, value));
  const current = (entry: SettingEntry) =>
    entry.source === level ? entry.value : inheritedValue(entry, level);
  const own = (row: EventRow) => [row.inApp, row.email].filter((entry) => entry.source === level);
  const reset = (row: EventRow) =>
    void saveState(row.event.id).run(async () => {
      for (const entry of own(row)) await onChange(entry.key, undefined);
    });

  return (
    <Table
      caption={caption}
      rowKey={(row) => row.event.id}
      rows={rows}
      columns={[
        {
          key: "event",
          header: t("notifications.event"),
          cell: (row) => (
            <div className="flex min-w-0 flex-col gap-1">
              <span className="font-medium wrap-anywhere">{label(row)}</span>
              <RowSource row={row} level={level} organizationName={organizationName} />
              <SaveIndicator tracker={saveState(row.event.id)} />
            </div>
          ),
        },
        {
          key: "inApp",
          header: t("notifications.channels.inApp"),
          cell: (row) => {
            const reason = disabledReason(t, row.inApp, level, editable, organizationName);
            return (
              <Switch
                label={t("notifications.channelFor", {
                  event: label(row),
                  channel: t("notifications.channels.inApp"),
                })}
                labelHidden
                checked={current(row.inApp) === true}
                disabled={reason !== undefined}
                {...(reason ? { disabledReason: reason } : {})}
                onCheckedChange={(checked) => save(row, row.inApp.key, checked)}
              />
            );
          },
        },
        {
          key: "email",
          header: t("notifications.channels.email"),
          cell: (row) => {
            const reason = disabledReason(t, row.email, level, editable, organizationName);
            const value = current(row.email);
            return (
              <div className="flex flex-col gap-1">
                <Select
                  aria-label={t("notifications.channelFor", {
                    event: label(row),
                    channel: t("notifications.channels.email"),
                  })}
                  value={isDelivery(value) ? value : "off"}
                  disabled={reason !== undefined}
                  options={emailDeliveries.map((delivery) => ({
                    value: delivery,
                    label: t(`notifications.email.${delivery}`),
                  }))}
                  onValueChange={(next) => save(row, row.email.key, next)}
                />
                {reason ? <span className="text-text-muted text-xs">{reason}</span> : null}
              </div>
            );
          },
        },
        {
          key: "reset",
          header: <span className="sr-only">{t("settings.actions")}</span>,
          align: "end",
          cell: (row) =>
            editable && own(row).length > 0 ? (
              <Button
                variant="outline"
                size="sm"
                aria-label={t("notifications.resetEvent", { event: label(row) })}
                onClick={() => reset(row)}
              >
                {t("notifications.reset")}
              </Button>
            ) : null,
        },
      ]}
    />
  );
}

export function NotificationPreferences({
  settings,
  loading,
  level,
  organizationName,
  editable,
  emailMethod,
  onChange,
}: {
  settings: readonly SettingEntry[] | undefined;
  loading: boolean;
  level: SettingLevel;
  organizationName?: string;
  editable: boolean;
  emailMethod: "smtp" | "graph" | null | undefined;
  onChange: (key: string, value: unknown) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  if (loading) return <Skeleton className="h-12 w-full" />;
  const content = notificationRows(settings, "content");
  const administration = notificationRows(settings, "administration");
  const tableProps = { level, organizationName, editable, onChange };
  return (
    <>
      {emailMethod === null ? (
        <Notice title={t("notifications.emailMissingTitle")}>
          {level === "user" ? t("notifications.emailMissing") : t("notifications.emailMissingAdministrators")}
        </Notice>
      ) : null}
      {emailMethod && level !== "user" ? (
        <Notice title={t(`notifications.emailMethod.${emailMethod}`)}>
          {t("notifications.emailMethodDescription")}
        </Notice>
      ) : null}
      <Section title={t("notifications.eventTypes")}>
        <EventTable rows={content} caption={t("notifications.eventTypes")} {...tableProps} />
      </Section>
      {administration.length > 0 ? (
        <details className="rounded-md border border-border bg-surface">
          <summary className="cursor-pointer rounded-md px-4 py-3 font-semibold focus-visible:focus-ring">
            {t("notifications.administrationEvents")}
          </summary>
          <div className="border-border border-t">
            <EventTable
              rows={administration}
              caption={t("notifications.administrationEvents")}
              {...tableProps}
            />
          </div>
        </details>
      ) : null}
    </>
  );
}
