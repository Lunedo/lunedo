import {
  type EmailDelivery,
  emailDeliveries,
  type NotificationEvent,
  type NotificationEventGroup,
  notificationChannelSettingKey,
  notificationEvents,
} from "@pagehall/shared";
import { Button, Notice, Section, Select, Skeleton, Switch } from "@pagehall/ui";
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
  push: SettingEntry | undefined;
}

function channelsOf(row: EventRow): SettingEntry[] {
  return row.push ? [row.inApp, row.email, row.push] : [row.inApp, row.email];
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
    const push = byKey.get(notificationChannelSettingKey(event.id, "push"));
    return inApp && email ? [{ event, inApp, email, push }] : [];
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
  const locked = channelsOf(row).find((entry) => entry.lockedBy && entry.lockedBy !== level);
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
  if (channelsOf(row).some((entry) => entry.source === level)) {
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
  const sources = channelsOf(row).map((entry) => inheritedFrom(entry, level));
  const from = sources.includes("organization")
    ? "organization"
    : sources.includes("instance")
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

function EventList({
  rows,
  caption,
  level,
  organizationName,
  editable,
  browserPush,
  onChange,
}: {
  rows: EventRow[];
  caption: string;
  level: SettingLevel;
  organizationName?: string | undefined;
  editable: boolean;
  browserPush: boolean;
  onChange: (key: string, value: unknown) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const saveState = useSaveStates();
  const label = (row: EventRow) => translateKey(t, `notifications.events.${row.event.id}`);
  const save = (row: EventRow, key: string, value: unknown) =>
    void saveState(row.event.id).run(() => onChange(key, value));
  const current = (entry: SettingEntry) =>
    entry.source === level ? entry.value : inheritedValue(entry, level);
  const shown = (row: EventRow) => (browserPush ? channelsOf(row) : [row.inApp, row.email]);
  const own = (row: EventRow) => shown(row).filter((entry) => entry.source === level);
  const reset = (row: EventRow) =>
    void saveState(row.event.id).run(async () => {
      for (const entry of own(row)) await onChange(entry.key, undefined);
    });

  const inAppLabel = t("notifications.channels.inApp");
  const emailLabel = t("notifications.channels.email");
  const pushLabel = t("notifications.channels.push");
  return (
    <div>
      <div
        aria-hidden="true"
        className="hidden items-center gap-4 border-border border-b bg-surface-sunken px-4 py-2 font-semibold text-text-muted text-xs md:flex"
      >
        <span className="min-w-0 flex-1">{t("notifications.event")}</span>
        <span className="w-number-field shrink-0">{inAppLabel}</span>
        <span className="w-field shrink-0">{emailLabel}</span>
        {browserPush ? <span className="w-number-field shrink-0">{pushLabel}</span> : null}
      </div>
      <ul aria-label={caption} className="flex flex-col divide-y divide-border">
        {rows.map((row) => {
          const inAppReason = disabledReason(t, row.inApp, level, editable, organizationName);
          const emailReason = disabledReason(t, row.email, level, editable, organizationName);
          const email = current(row.email);
          const push = browserPush ? row.push : undefined;
          const pushReason = push ? disabledReason(t, push, level, editable, organizationName) : undefined;
          return (
            <li key={row.event.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
              <div className="flex min-w-0 flex-1 basis-field flex-col gap-1">
                <span className="font-medium wrap-anywhere">{label(row)}</span>
                <span className="flex flex-wrap items-center gap-2">
                  <RowSource row={row} level={level} organizationName={organizationName} />
                  {editable && own(row).length > 0 ? (
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={t("notifications.resetEvent", { event: label(row) })}
                      onClick={() => reset(row)}
                    >
                      {t("notifications.reset")}
                    </Button>
                  ) : null}
                </span>
                <SaveIndicator tracker={saveState(row.event.id)} />
              </div>
              <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row md:items-center md:gap-4">
                <div className="flex items-center gap-2 md:w-number-field">
                  <Switch
                    label={t("notifications.channelFor", { event: label(row), channel: inAppLabel })}
                    labelHidden
                    checked={current(row.inApp) === true}
                    disabled={inAppReason !== undefined}
                    {...(inAppReason ? { disabledReason: inAppReason } : {})}
                    onCheckedChange={(checked) => save(row, row.inApp.key, checked)}
                  />
                  <span aria-hidden="true" className="text-sm md:hidden">
                    {inAppLabel}
                  </span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1 md:w-field md:flex-none">
                  <span aria-hidden="true" className="text-sm md:hidden">
                    {emailLabel}
                  </span>
                  <Select
                    aria-label={t("notifications.channelFor", { event: label(row), channel: emailLabel })}
                    value={isDelivery(email) ? email : "off"}
                    disabled={emailReason !== undefined}
                    options={emailDeliveries.map((delivery) => ({
                      value: delivery,
                      label: t(`notifications.email.${delivery}`),
                    }))}
                    onValueChange={(next) => save(row, row.email.key, next)}
                  />
                  {emailReason ? <span className="text-text-muted text-xs">{emailReason}</span> : null}
                </div>
                {push ? (
                  <div className="flex items-center gap-2 md:w-number-field">
                    <Switch
                      label={t("notifications.channelFor", { event: label(row), channel: pushLabel })}
                      labelHidden
                      checked={current(push) === true}
                      disabled={pushReason !== undefined}
                      {...(pushReason ? { disabledReason: pushReason } : {})}
                      onCheckedChange={(checked) => save(row, push.key, checked)}
                    />
                    <span aria-hidden="true" className="text-sm md:hidden">
                      {pushLabel}
                    </span>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function NotificationPreferences({
  settings,
  loading,
  level,
  organizationName,
  editable,
  emailMethod,
  browserPush,
  onChange,
}: {
  settings: readonly SettingEntry[] | undefined;
  loading: boolean;
  level: SettingLevel;
  organizationName?: string;
  editable: boolean;
  emailMethod: "smtp" | "graph" | null | undefined;
  browserPush: boolean;
  onChange: (key: string, value: unknown) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  if (loading) return <Skeleton className="h-12 w-full" />;
  const content = notificationRows(settings, "content");
  const administration = notificationRows(settings, "administration");
  const tableProps = { level, organizationName, editable, browserPush, onChange };
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
        <EventList rows={content} caption={t("notifications.eventTypes")} {...tableProps} />
      </Section>
      {administration.length > 0 ? (
        <details className="rounded-md border border-border bg-surface">
          <summary className="cursor-pointer rounded-md px-4 py-3 font-semibold focus-visible:focus-ring">
            {t("notifications.administrationEvents")}
          </summary>
          <div className="border-border border-t">
            <EventList
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
