import { IconButton, Menu, Section, Skeleton, Switch, Table } from "@pagehall/ui";
import { MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SettingEntry } from "../api/organization-queries.js";
import { translateKey } from "../i18n/translate.js";
import { SaveIndicator, useSaveStates } from "./auto-save.js";
import { disabledReason, type SettingLevel, SettingSource } from "./setting-source.js";

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
  onChange: (key: string, value: Channels | undefined) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const saveState = useSaveStates();
  const save = (key: string, value: Channels | undefined) =>
    void saveState(key).run(() => onChange(key, value));
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
                  <SaveIndicator tracker={saveState(entry.key)} />
                </div>
              ),
            },
            ...(["inApp", "email"] as const).map((channel) => ({
              key: channel,
              header: t(`notifications.channels.${channel}`),
              cell: (entry: SettingEntry) => {
                const value = entry.value as Channels;
                const reason = disabledReason(t, entry, level, editable, organizationName);
                return (
                  <Switch
                    label={`${label(entry)}: ${t(`notifications.channels.${channel}`)}`}
                    labelHidden
                    checked={value[channel]}
                    disabled={reason !== undefined}
                    {...(reason ? { disabledReason: reason } : {})}
                    onCheckedChange={(checked) => save(entry.key, { ...value, [channel]: checked })}
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
                  <Menu
                    align="end"
                    trigger={
                      <IconButton
                        label={t("settings.moreFor", { name: label(entry) })}
                        icon={MoreHorizontal}
                      />
                    }
                    items={[
                      { label: t("settings.resetToDefault"), onSelect: () => save(entry.key, undefined) },
                    ]}
                  />
                ) : null,
            },
          ]}
          empty={<p className="p-4 text-text-muted">{t("notifications.noEventTypes")}</p>}
        />
      ) : null}
    </Section>
  );
}
