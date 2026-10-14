import {
  Badge,
  ConfirmDialog,
  Dialog,
  formatDuration,
  IconButton,
  Menu,
  SettingRow,
  Skeleton,
  Table,
} from "@pagehall/ui";
import { Info, Lock, LockOpen, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { SettingEntry } from "../api/organization-queries.js";
import { translateKey } from "../i18n/translate.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { contentLanguageLabel } from "../search/content-language.js";
import { localeOptionSet } from "../settings/locale-options.js";
import {
  type SettingField,
  settingDescriptionKey,
  settingField,
  settingLabelKey,
  toMinutes,
} from "../settings/setting-fields.js";
import type { SettingChange } from "../settings/setting-mutations.js";
import { SaveIndicator, useSaveState } from "./auto-save.js";
import { clockTime, SettingControl } from "./setting-control.js";
import { disabledReason, inheritedValue, SettingSource } from "./setting-source.js";

type Level = "instance" | "organization" | "space" | "user";

export function useSettingValueFormatter() {
  const { t, i18n } = useTranslation();
  const format = useFormat();
  return (field: SettingField | undefined, value: unknown): string => {
    if (field?.type.kind === "duration" && field.type.nullable && value === null)
      return t("settings.noLimit");
    if (field?.type.kind === "number" && field.type.unlimited && value === "unlimited")
      return t("settings.noLimit");
    if (field?.type.kind === "contentLanguage") {
      return value === null || value === undefined
        ? t("contentLanguage.organization")
        : contentLanguageLabel(t, value, i18n.language);
    }
    if (value === null || value === undefined || value === "") return t("settings.notSet");
    if (!field) return typeof value === "object" ? JSON.stringify(value) : String(value);
    switch (field.type.kind) {
      case "boolean":
        return value === true ? t("common.on") : t("common.off");
      case "number":
        return t(`settings.units.${field.type.unit}`, {
          count: Number(value),
          value: format.number(Number(value)),
        });
      case "percent":
        return format.percent(Number(value));
      case "time":
        return clockTime(String(value), i18n.language);
      case "duration":
        return formatDuration(toMinutes(field.type, Number(value)), i18n.language);
      case "enum":
        return translateKey(t, `${field.type.labelPrefix}.${String(value)}`);
      case "locale":
        return localeOptionSet(field.key)?.formatValue(t, value, i18n.language) ?? String(value);
      default:
        return String(value);
    }
  };
}

export function SettingsList({
  settings,
  keys,
  level,
  organizationName,
  canManage,
  onChange,
}: {
  settings: readonly SettingEntry[] | undefined;
  keys: readonly string[];
  level: Level;
  organizationName?: string;
  canManage: (key: string) => boolean;
  onChange: (key: string, change: SettingChange) => Promise<void>;
}) {
  const formatValue = useSettingValueFormatter();
  if (!settings) return <Skeleton className="h-12 w-full" />;
  const entries = keys
    .map((key) => settings.find((entry) => entry.key === key))
    .filter((entry): entry is SettingEntry => entry !== undefined);
  return (
    <>
      {entries.map((entry) => (
        <SettingItem
          key={entry.key}
          entry={entry}
          level={level}
          {...(organizationName ? { organizationName } : {})}
          editable={entry.editable && canManage(entry.key)}
          formatValue={(value) => formatValue(settingField(entry.key), value)}
          onChange={(change) => onChange(entry.key, change)}
        />
      ))}
    </>
  );
}

function SettingItem({
  entry,
  level,
  organizationName,
  editable,
  formatValue,
  onChange,
}: {
  entry: SettingEntry;
  level: Level;
  organizationName?: string;
  editable: boolean;
  formatValue: (value: unknown) => string;
  onChange: (change: SettingChange) => Promise<void>;
}) {
  const { t } = useTranslation();
  const field = settingField(entry.key);
  const [explaining, setExplaining] = useState(false);
  const [confirmingLock, setConfirmingLock] = useState(false);
  const tracker = useSaveState();
  const apply = (change: SettingChange) => tracker.run(() => onChange(change));
  const lockedAbove = entry.lockedBy !== null && entry.lockedBy !== level;
  const own = entry.source === level;
  const canLock = entry.lockable && entry.levelsBelow.length > 0;
  const writable = editable && !lockedAbove;
  const label = translateKey(t, settingLabelKey(entry.key));

  const inherited = inheritedValue(entry, level);
  const control = field ? (
    <SettingControl
      key={own ? (entry.value === "unlimited" ? "own-unlimited" : "own") : "inherited"}
      field={field}
      label={label}
      value={own ? entry.value : inherited}
      inheritedValue={inherited}
      inherited={!own}
      inheritedLabel={formatValue(inherited)}
      maximum={entry.maximum}
      disabled={!writable}
      disabledReason={writable ? undefined : disabledReason(t, entry, level, editable, organizationName)}
      onSave={async (value) => {
        await apply({ value });
      }}
      onFollowDefault={async () => {
        await apply({ clear: true });
      }}
    />
  ) : (
    <span className="text-text-muted">{formatValue(entry.value)}</span>
  );

  const menuItems = [
    { label: t("settings.explain"), icon: Info, onSelect: () => setExplaining(true) },
    ...(writable && own
      ? [
          {
            label: t("settings.resetToDefault"),
            onSelect: () => void apply({ clear: true }),
          },
        ]
      : []),
    ...(writable && canLock
      ? [
          entry.locked
            ? {
                label: t("settings.unlock"),
                icon: LockOpen,
                onSelect: () => void apply({ locked: false }),
              }
            : {
                label:
                  level === "instance"
                    ? t("settings.lockForOrganizations")
                    : entry.levelsBelow.includes("space")
                      ? t("settings.lockForSpaces")
                      : t("settings.lockForMembers"),
                icon: Lock,
                onSelect: () => setConfirmingLock(true),
              },
        ]
      : []),
  ];

  return (
    <>
      <SettingRow
        label={label}
        description={translateKey(t, settingDescriptionKey(entry.key))}
        meta={
          <span className="flex flex-wrap items-center gap-2">
            <SettingSource
              entry={entry}
              level={level}
              {...(organizationName ? { organizationName } : {})}
              formatValue={formatValue}
            />
            {entry.locked && own ? (
              <Badge variant="neutral" icon={Lock}>
                {t("settings.locked")}
              </Badge>
            ) : null}
          </span>
        }
        control={control}
        status={<SaveIndicator tracker={tracker} />}
        menu={
          <Menu
            align="end"
            trigger={<IconButton label={t("settings.moreFor", { name: label })} icon={MoreHorizontal} />}
            items={menuItems}
          />
        }
      />
      <ConfirmDialog
        open={confirmingLock}
        onOpenChange={setConfirmingLock}
        title={t("settings.lockTitle", { name: label })}
        description={
          level === "instance"
            ? t("settings.lockImpactInstance", { name: label, value: formatValue(entry.value) })
            : t("settings.lockImpactOrganization", {
                name: label,
                value: formatValue(entry.value),
                organization: organizationName ?? "",
              })
        }
        confirmLabel={
          level === "instance"
            ? t("settings.lockForOrganizations")
            : entry.levelsBelow.includes("space")
              ? t("settings.lockForSpaces")
              : t("settings.lockForMembers")
        }
        cancelLabel={t("common.cancel")}
        onConfirm={async () => {
          setConfirmingLock(false);
          await apply({ locked: true });
        }}
      />
      <Dialog
        open={explaining}
        onOpenChange={setExplaining}
        title={t("settings.explainTitle", { name: label })}
        size="md"
      >
        <Table
          caption={t("settings.explainTitle", { name: label })}
          rowKey={(state) => state.level}
          rows={entry.levels}
          columns={[
            {
              key: "level",
              header: t("settings.level"),
              cell: (state) => translateKey(t, `settings.levels.${state.level}`),
            },
            {
              key: "value",
              header: t("settings.value"),
              cell: (state) => (state.value === null ? t("settings.inherits") : formatValue(state.value)),
            },
            {
              key: "state",
              header: t("settings.state"),
              cell: (state) => (
                <span className="flex flex-wrap gap-1">
                  {state.locked ? <Badge variant="warning">{t("settings.locked")}</Badge> : null}
                  {state.value !== null && !state.effective ? (
                    <Badge variant="neutral">{t("settings.ineffective")}</Badge>
                  ) : null}
                  {entry.source === state.level ? (
                    <Badge variant="accent">{t("settings.applies")}</Badge>
                  ) : null}
                </span>
              ),
            },
          ]}
        />
        <p className="mt-3 text-sm text-text-muted">
          {entry.source === "default"
            ? t("settings.explainDefault", { value: formatValue(entry.defaultValue) })
            : t("settings.explainSource", {
                level: translateKey(t, `settings.levels.${entry.source}`),
                value: formatValue(entry.value),
              })}
        </p>
      </Dialog>
    </>
  );
}
