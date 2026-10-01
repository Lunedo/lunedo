import { Button, Section, Skeleton, Switch, Table } from "@pagehall/ui";
import { useTranslation } from "react-i18next";
import type { SettingEntry } from "../api/organization-queries.js";
import { translateKey } from "../i18n/translate.js";
import { type SettingLevel, SettingSource } from "./setting-source.js";

interface Channels {
  inApp: boolean;
  email: boolean;
}

function isChannels(value: unknown): value is Channels {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Channels).inApp === "boolean" &&
    typeof (value as Channels).email === "boolean"
  );
}

export function notificationEntries(settings: readonly SettingEntry[] | undefined): SettingEntry[] {
  return (settings ?? []).filter(
    (entry) => entry.key.startsWith("notifications.") && isChannels(entry.value),
  );
}

export function NotificationPreferences({
  settings,
  loading,
  level,
  organizationName,
  editable,
  onChange,
}: {
  settings: readonly SettingEntry[] | undefined;
  loading: boolean;
  level: SettingLevel;
  organizationName?: string;
  editable: boolean;
  onChange: (key: string, value: Channels | undefined) => void;
}) {
  const { t } = useTranslation();
  const entries = notificationEntries(settings);
  const label = (entry: SettingEntry) =>
    translateKey(t, `notifications.events.${entry.key.slice("notifications.".length)}`);
  const channelsText = (value: unknown) => {
    if (!isChannels(value)) return "";
    const enabled = [
      value.inApp ? t("notifications.channels.inApp") : null,
      value.email ? t("notifications.channels.email") : null,
    ].filter(Boolean);
    return enabled.length > 0 ? enabled.join(", ") : t("notifications.channels.none");
  };

  return (
    <Section title={t("notifications.eventTypes")}>
      {loading ? <Skeleton className="h-12 w-full" /> : null}
      {!loading ? (
        <Table
          caption={t("notifications.eventTypes")}
          rowKey={(entry) => entry.key}
          rows={entries}
          columns={[
            {
              key: "event",
              header: t("notifications.event"),
              cell: (entry) => (
                <div className="flex flex-col gap-1">
                  <span className="font-medium">{label(entry)}</span>
                  <SettingSource
                    entry={entry}
                    level={level}
                    {...(organizationName ? { organizationName } : {})}
                    formatValue={channelsText}
                  />
                </div>
              ),
            },
            ...(["inApp", "email"] as const).map((channel) => ({
              key: channel,
              header: t(`notifications.channels.${channel}`),
              cell: (entry: SettingEntry) => {
                const value = entry.value as Channels;
                return (
                  <Switch
                    label={`${label(entry)}: ${t(`notifications.channels.${channel}`)}`}
                    labelHidden
                    checked={value[channel]}
                    disabled={!editable || (entry.lockedBy !== null && entry.lockedBy !== level)}
                    onCheckedChange={(checked) => onChange(entry.key, { ...value, [channel]: checked })}
                  />
                );
              },
            })),
            {
              key: "reset",
              header: t("settings.actions"),
              align: "end" as const,
              cell: (entry: SettingEntry) =>
                entry.source === level && editable ? (
                  <Button variant="secondary" size="sm" onClick={() => onChange(entry.key, undefined)}>
                    {level === "user" ? t("settings.useDefault") : t("settings.inherit")}
                  </Button>
                ) : null,
            },
          ]}
          empty={<p className="p-4 text-text-muted">{t("notifications.noEventTypes")}</p>}
        />
      ) : null}
    </Section>
  );
}
