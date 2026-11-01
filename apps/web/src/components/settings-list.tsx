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
} from "@lunedo/ui";
import { Info, Lock, LockOpen, MoreHorizontal, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { SettingEntry } from "../api/organization-queries.js";
import { clockTime } from "../format/clock-time.js";
import { translateKey } from "../i18n/translate.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { contentLanguageLabel } from "../search/content-language.js";
import { localeOptionSet } from "../settings/locale-options.js";
import {
  type SettingField,
  settingDescriptionKey,
  settingField,
  settingHelpKey,
  settingLabelKey,
  toMinutes,
} from "../settings/setting-fields.js";
import type { SettingChange } from "../settings/setting-mutations.js";
import { SaveIndicator, useSaveState, useUndoToast } from "./auto-save.js";
import { FORMAT_KEYS, FormatCell, FormatsRow, formatsExample } from "./formats-row.js";
import { SettingControl } from "./setting-control.js";
import {
  BoundMark,
  boundedField,
  disabledReason,
  inheritedValue,
  instanceBound,
  SettingMarks,
  sameValue,
} from "./setting-source.js";

type Level = "instance" | "organization" | "space" | "user";

export function useSettingValueFormatter() {
  const { t, i18n } = useTranslation();
  const format = useFormat();
  return (field: SettingField | undefined, value: unknown): string => {
    if (field?.type.kind === "duration" && field.type.nullable && value === null)
      return t("settings.noLimit");
    if (field?.type.kind === "number" && field.type.unlimited && value === "unlimited")
      return t("settings.noLimit");
    if (field?.type.kind === "number" && field.type.unsetLabel && value === null)
      return translateKey(t, field.type.unsetLabel);
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
  const { t, i18n } = useTranslation();
  const formatValue = useSettingValueFormatter();
  if (!settings) return <Skeleton className="h-12 w-full" />;
  const entries = keys
    .map((key) => settings.find((entry) => entry.key === key))
    .filter((entry): entry is SettingEntry => entry !== undefined);
  const isFormat = (entry: SettingEntry) => (FORMAT_KEYS as readonly string[]).includes(entry.key);
  const formats = entries.filter(isFormat);
  const item = (entry: SettingEntry, variant: "row" | "cell") => (
    <SettingItem
      key={entry.key}
      entry={entry}
      level={level}
      variant={variant}
      {...(organizationName ? { organizationName } : {})}
      editable={entry.editable && canManage(entry.key)}
      formatValue={(value) => formatValue(settingField(entry.key), value)}
      onChange={(change) => onChange(entry.key, change)}
    />
  );
  return (
    <>
      {entries.map((entry) => {
        if (!isFormat(entry)) return item(entry, "row");
        if (entry !== formats[0]) return null;
        return (
          <FormatsRow
            key="formats"
            example={formatsExample(
              t,
              i18n.language,
              Object.fromEntries(formats.map((format) => [format.key, format.value])),
            )}
          >
            {formats.map((format) => item(format, "cell"))}
          </FormatsRow>
        );
      })}
    </>
  );
}

function SettingItem({
  entry,
  level,
  variant,
  organizationName,
  editable,
  formatValue,
  onChange,
}: {
  entry: SettingEntry;
  level: Level;
  variant: "row" | "cell";
  organizationName?: string;
  editable: boolean;
  formatValue: (value: unknown) => string;
  onChange: (change: SettingChange) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const bound = instanceBound(entry, level);
  const baseField = settingField(entry.key);
  const field = baseField ? boundedField(baseField, bound) : undefined;
  const requiredByInstance = bound?.value === true && bound.direction === "higher";
  const [explaining, setExplaining] = useState(false);
  const [confirmingLock, setConfirmingLock] = useState(false);
  const tracker = useSaveState();
  const undoToast = useUndoToast();
  const lockedAbove = entry.lockedBy !== null && entry.lockedBy !== level;
  const own = entry.source === level;
  const label = translateKey(t, settingLabelKey(entry.key));
  const apply = async (change: SettingChange) => {
    const revert: SettingChange =
      "locked" in change ? { locked: !change.locked } : own ? { value: entry.value } : { clear: true };
    return tracker.run(
      () => onChange(change),
      () => undoToast(label, () => onChange(revert)),
    );
  };
  const canLock = entry.lockable && entry.levelsBelow.length > 0;
  const writable = editable && !lockedAbove && !requiredByInstance;

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
      disabledReason={
        writable
          ? undefined
          : requiredByInstance
            ? t("settings.bound.required")
            : disabledReason(t, entry, level, editable, organizationName)
      }
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
            icon: RotateCcw,
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

  const boundInHint = variant === "row" && bound !== null && typeof bound.value !== "boolean" && !lockedAbove;
  const description = boundInHint
    ? t(bound.direction === "lower" ? "settings.bound.hintAtMost" : "settings.bound.hintAtLeast", {
        value: formatValue(bound.value),
      })
    : translateKey(t, settingDescriptionKey(entry.key, level));
  const marks = (
    <>
      {bound && !lockedAbove && !boundInHint ? <BoundMark bound={bound} formatValue={formatValue} /> : null}
      <SettingMarks
        entry={entry}
        level={level}
        own={own}
        differs={own && !sameValue(entry.value, inherited)}
        writable={writable}
        label={label}
        {...(organizationName ? { organizationName } : {})}
        onReset={() => void apply({ clear: true })}
      />
    </>
  );
  const menu = (
    <Menu
      align="end"
      trigger={<IconButton label={t("settings.moreFor", { name: label })} icon={MoreHorizontal} />}
      items={menuItems}
    />
  );

  return (
    <>
      {variant === "cell" ? (
        <FormatCell
          label={label}
          control={control}
          meta={marks}
          menu={menu}
          status={<SaveIndicator tracker={tracker} />}
        />
      ) : (
        <SettingRow
          label={label}
          description={description}
          help={
            i18n.exists(settingHelpKey(entry.key)) ? translateKey(t, settingHelpKey(entry.key)) : undefined
          }
          meta={marks}
          control={control}
          status={<SaveIndicator tracker={tracker} />}
          menu={menu}
        />
      )}
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
