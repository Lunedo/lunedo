import {
  Badge,
  Checkbox,
  ConfirmDialog,
  classNames,
  Dialog,
  DurationInput,
  formatDuration,
  IconButton,
  Input,
  isDurationWithin,
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
import { translateKey } from "../i18n/translate.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { localeOptionSet } from "../settings/locale-options.js";
import {
  fromMinutes,
  type SettingField,
  settingDescriptionKey,
  settingField,
  settingLabelKey,
  toMinutes,
} from "../settings/setting-fields.js";
import type { SettingChange } from "../settings/setting-mutations.js";
import { SaveIndicator, useSaveState } from "./auto-save.js";
import { disabledReason, inheritedValue, SettingSource } from "./setting-source.js";

type Level = "instance" | "organization";

export function useSettingValueFormatter() {
  const { t, i18n } = useTranslation();
  const format = useFormat();
  return (field: SettingField | undefined, value: unknown): string => {
    if (field?.type.kind === "duration" && field.type.nullable && value === null)
      return t("settings.noLimit");
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
          onCheckedChange={(checked) => void apply({ value: checked })}
        />
      );
    }
    const inherited = inheritedValue(entry, level);
    return (
      <ValueEditor
        key={own ? "own" : "inherited"}
        field={field}
        label={label}
        value={own ? entry.value : inherited}
        inherited={!own}
        inheritedLabel={formatValue(inherited)}
        disabled={!writable}
        onSave={async (value) => {
          await apply({ value });
        }}
        onReset={async () => {
          await apply({ clear: true });
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
                  level === "instance" ? t("settings.lockForOrganizations") : t("settings.lockForMembers"),
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
        control={
          <div className="flex flex-col items-start gap-1">
            <div className="flex items-center gap-1">
              {control()}
              <Menu
                align="end"
                trigger={<IconButton label={t("settings.moreFor", { name: label })} icon={MoreHorizontal} />}
                items={menuItems}
              />
            </div>
            <SaveIndicator tracker={tracker} />
          </div>
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
          level === "instance" ? t("settings.lockForOrganizations") : t("settings.lockForMembers")
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

const INHERITED = "__inherited__";

function ValueEditor({
  field,
  label,
  value,
  inherited,
  inheritedLabel,
  disabled,
  onSave,
  onReset,
}: {
  field: SettingField;
  label: string;
  value: unknown;
  inherited: boolean;
  inheritedLabel: string;
  disabled: boolean;
  onSave: (value: unknown) => Promise<void>;
  onReset: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [draft, setDraft] = useState(inherited ? "" : String(value ?? ""));
  const [error, setError] = useState<string | null>(null);

  if (field.type.kind === "duration") {
    return (
      <DurationEditor
        type={field.type}
        label={label}
        value={typeof value === "number" ? value : null}
        inherited={inherited}
        disabled={disabled}
        onSave={onSave}
      />
    );
  }

  if (field.type.kind === "enum" || field.type.kind === "locale") {
    const options =
      field.type.kind === "locale"
        ? (localeOptionSet(field.key)?.options(t, i18n.language) ?? [])
        : field.type.values.map((option) => ({
            value: option,
            label: translateKey(t, `${(field.type as { labelPrefix: string }).labelPrefix}.${option}`),
          }));
    return (
      <div className="w-field max-w-full">
        <Select
          aria-label={label}
          value={inherited ? INHERITED : String(value)}
          disabled={disabled}
          className={inherited ? "text-text-muted" : undefined}
          onValueChange={(next) => void (next === INHERITED ? onReset() : onSave(next))}
          options={[
            { value: INHERITED, label: t("settings.useDefaultOption", { value: inheritedLabel }) },
            ...options,
          ]}
        />
      </div>
    );
  }

  const commit = async () => {
    setError(null);
    if (draft.trim() === "") {
      if (!inherited) await onReset();
      return;
    }
    if (field.type.kind === "number") {
      const schema = z.coerce.number().int().min(field.type.min).max(field.type.max);
      const parsed = schema.safeParse(draft);
      if (!parsed.success) {
        setError(t("validation.range", { minimum: field.type.min, maximum: field.type.max }));
        return;
      }
      if (inherited || parsed.data !== value) await onSave(parsed.data);
      return;
    }
    if (inherited || draft !== value) await onSave(draft.trim());
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <div className="w-field max-w-full">
          <Input
            aria-label={label}
            aria-invalid={error !== null}
            value={draft}
            placeholder={inherited ? inheritedLabel : undefined}
            disabled={disabled}
            inputMode={field.type.kind === "number" ? "numeric" : undefined}
            type={field.type.kind === "text" && field.type.inputType === "url" ? "url" : "text"}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void commit();
              }
            }}
          />
        </div>
      </div>
      {error ? (
        <span role="alert" className="text-danger text-sm">
          {error}
        </span>
      ) : null}
    </div>
  );
}

type DurationType = Extract<SettingField["type"], { kind: "duration" }>;

function DurationEditor({
  type,
  label,
  value,
  inherited,
  disabled,
  onSave,
}: {
  type: DurationType;
  label: string;
  value: number | null;
  inherited: boolean;
  disabled: boolean;
  onSave: (value: unknown) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [limited, setLimited] = useState(value !== null);
  const min = toMinutes(type, type.min);
  const max = toMinutes(type, type.max);
  const commit = (minutes: number | null) => {
    if (!isDurationWithin(minutes, min, max) || minutes === null) {
      setError(
        t("validation.durationRange", {
          minimum: formatDuration(min, i18n.language),
          maximum: formatDuration(max, i18n.language),
        }),
      );
      return;
    }
    setError(null);
    const next = fromMinutes(type, minutes);
    if (inherited || next !== value) void onSave(next);
  };
  return (
    <div className={classNames("flex min-w-0 flex-col gap-2", inherited && "[&_input]:text-text-muted")}>
      {type.nullable ? (
        <Checkbox
          label={t("settings.limitDuration")}
          checked={limited}
          disabled={disabled}
          onCheckedChange={(checked) => {
            setLimited(checked);
            setError(null);
            if (!checked && value !== null) void onSave(null);
          }}
        />
      ) : null}
      {limited || !type.nullable ? (
        <DurationInput
          aria-label={label}
          value={value === null ? null : toMinutes(type, value)}
          units={type.unit === "days" ? ["days"] : ["minutes", "hours", "days"]}
          quickChoices={type.quickChoices.map((choice) => toMinutes(type, choice))}
          min={min}
          max={max}
          locale={i18n.language}
          invalid={error !== null}
          disabled={disabled}
          onCommit={commit}
        />
      ) : null}
      {error ? (
        <span role="alert" className="text-danger text-sm">
          {error}
        </span>
      ) : null}
    </div>
  );
}
