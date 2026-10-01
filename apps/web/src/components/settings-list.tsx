import {
  Badge,
  Button,
  Dialog,
  IconButton,
  Input,
  Menu,
  Select,
  SettingRow,
  Skeleton,
  Switch,
  Table,
} from "@pagehall/ui";
import { Info, Lock, LockOpen, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { SettingEntry } from "../api/organization-queries.js";
import { timeZoneOptions } from "../format/time-zones.js";
import { translateKey } from "../i18n/translate.js";
import { useFormat } from "../preferences/preferences-provider.js";
import {
  type SettingField,
  settingDescriptionKey,
  settingField,
  settingLabelKey,
} from "../settings/setting-fields.js";
import type { SettingChange } from "../settings/setting-mutations.js";
import { disabledReason, inheritedValue, SettingSource } from "./setting-source.js";

type Level = "instance" | "organization";

export function useSettingValueFormatter() {
  const { t } = useTranslation();
  const format = useFormat();
  return (field: SettingField | undefined, value: unknown): string => {
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
      case "enum":
        return translateKey(t, `${field.type.labelPrefix}.${String(value)}`);
      case "timeZone":
        return String(value).replaceAll("_", " ");
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
  const [overriding, setOverriding] = useState(false);
  const lockedAbove = entry.lockedBy !== null && entry.lockedBy !== level;
  const own = entry.source === level;
  const canLock = entry.lockable && entry.levelsBelow.length > 0;
  const writable = editable && !lockedAbove;
  const label = translateKey(t, settingLabelKey(entry.key));

  const control = () => {
    if (!field) return <span className="text-text-muted">{formatValue(entry.value)}</span>;
    if (field.type.kind === "boolean") {
      return (
        <Switch
          label={label}
          labelHidden
          checked={entry.value === true}
          disabled={!writable}
          {...(writable
            ? {}
            : { disabledReason: disabledReason(t, entry, level, editable, organizationName) })}
          onCheckedChange={(checked) => void onChange({ value: checked })}
        />
      );
    }
    if (!own && !overriding) {
      return (
        <div className="flex items-center gap-2">
          <span>{formatValue(entry.value)}</span>
          {writable ? (
            <Button variant="outline" size="sm" onClick={() => setOverriding(true)}>
              {t("settings.override")}
            </Button>
          ) : null}
        </div>
      );
    }
    return (
      <ValueEditor
        field={field}
        label={label}
        value={own ? entry.value : inheritedValue(entry, level)}
        disabled={!writable}
        onSave={async (value) => {
          await onChange({ value });
          setOverriding(false);
        }}
      />
    );
  };

  const menuItems = [
    { label: t("settings.explain"), icon: Info, onSelect: () => setExplaining(true) },
    ...(writable && own
      ? [
          {
            label: level === "organization" ? t("settings.useInstanceValue") : t("settings.useDefault"),
            onSelect: () => void onChange({ clear: true }),
          },
        ]
      : []),
    ...(writable && canLock
      ? [
          entry.locked
            ? {
                label: t("settings.unlock"),
                icon: LockOpen,
                onSelect: () => void onChange({ locked: false }),
              }
            : {
                label:
                  level === "instance" ? t("settings.lockForOrganizations") : t("settings.lockForMembers"),
                icon: Lock,
                onSelect: () => void onChange({ locked: true }),
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
        control={
          <div className="flex items-center gap-1">
            {control()}
            <Menu
              align="end"
              trigger={<IconButton label={t("settings.moreFor", { name: label })} icon={MoreHorizontal} />}
              items={menuItems}
            />
          </div>
        }
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

function ValueEditor({
  field,
  label,
  value,
  disabled,
  onSave,
}: {
  field: SettingField;
  label: string;
  value: unknown;
  disabled: boolean;
  onSave: (value: unknown) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(String(value ?? ""));
  const [error, setError] = useState<string | null>(null);

  if (field.type.kind === "enum" || field.type.kind === "timeZone") {
    const options =
      field.type.kind === "timeZone"
        ? timeZoneOptions()
        : field.type.values.map((option) => ({
            value: option,
            label: translateKey(t, `${(field.type as { labelPrefix: string }).labelPrefix}.${option}`),
          }));
    return (
      <div className="w-field max-w-full">
        <Select
          aria-label={label}
          value={String(value)}
          disabled={disabled}
          onValueChange={(next) => void onSave(next)}
          options={options}
        />
      </div>
    );
  }

  const commit = async () => {
    setError(null);
    if (field.type.kind === "number") {
      const schema = z.coerce.number().int().min(field.type.min).max(field.type.max);
      const parsed = schema.safeParse(draft);
      if (!parsed.success) {
        setError(t("validation.range", { minimum: field.type.min, maximum: field.type.max }));
        return;
      }
      if (parsed.data !== value) await onSave(parsed.data);
      return;
    }
    if (draft !== value) await onSave(draft.trim());
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <div className="w-field max-w-full">
          <Input
            aria-label={label}
            aria-invalid={error !== null}
            value={draft}
            disabled={disabled}
            inputMode={field.type.kind === "number" ? "numeric" : undefined}
            type={field.type.kind === "text" && field.type.inputType === "url" ? "url" : "text"}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void commit();
            }}
          />
        </div>
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => void commit()}>
          {t("common.save")}
        </Button>
      </div>
      {error ? (
        <span role="alert" className="text-danger text-sm">
          {error}
        </span>
      ) : null}
    </div>
  );
}
