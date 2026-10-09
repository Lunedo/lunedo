import {
  Checkbox,
  Combobox,
  DurationSelect,
  Input,
  SettingSelect,
  Switch,
  TimeZoneCombobox,
} from "@pagehall/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { browserTimeZone } from "../format/time-zones.js";
import { supportedLanguages } from "../i18n/index.js";
import { translateKey } from "../i18n/translate.js";
import { languageLabel, localeOptionSet } from "../settings/locale-options.js";
import { fromMinutes, type SettingField, toMinutes } from "../settings/setting-fields.js";

export interface SettingControlProps {
  field: SettingField;
  label: string;
  value: unknown;
  inheritedValue: unknown;
  inherited: boolean;
  disabled: boolean;
  disabledReason?: string | undefined;
  inheritedLabel: string;
  maximum?: unknown;
  onSave: (value: unknown) => Promise<void>;
  onFollowDefault: () => Promise<void>;
}

export function SettingControl(props: SettingControlProps) {
  const { t, i18n } = useTranslation();
  const { field, label, value, inheritedValue, inherited, disabled, onSave, onFollowDefault } = props;
  const type = field.type;

  if (type.kind === "boolean") {
    return (
      <Switch
        label={label}
        labelHidden
        checked={value === true}
        disabled={disabled}
        {...(disabled && props.disabledReason ? { disabledReason: props.disabledReason } : {})}
        onCheckedChange={(checked) => void onSave(checked)}
      />
    );
  }

  if (type.kind === "duration") {
    const toChoice = (raw: unknown) => (typeof raw === "number" ? toMinutes(type, raw) : null);
    return (
      <DurationSelect
        aria-label={label}
        value={toChoice(value)}
        inheritedValue={toChoice(inheritedValue)}
        inherited={inherited}
        choices={type.quickChoices.map((choice) => toMinutes(type, choice))}
        units={type.unit === "days" ? ["days"] : ["minutes", "hours", "days"]}
        min={toMinutes(type, type.min)}
        max={toMinutes(type, type.max)}
        locale={i18n.language}
        {...(type.nullable ? { noLimitLabel: t("settings.noLimit") } : {})}
        disabled={disabled}
        onValueChange={(minutes) => void onSave(minutes === null ? null : fromMinutes(type, minutes))}
        onFollowDefault={() => void onFollowDefault()}
      />
    );
  }

  if (field.key === "locale.timeZone") {
    return (
      <TimeZoneCombobox
        aria-label={label}
        value={typeof value === "string" ? value : null}
        {...(typeof inheritedValue === "string" ? { inheritedTimeZone: inheritedValue } : {})}
        browserTimeZone={browserTimeZone()}
        locale={i18n.language}
        muted={inherited}
        disabled={disabled}
        onValueChange={(next) => void choose(next)}
      />
    );
  }

  if (field.key === "locale.language") {
    return (
      <Combobox
        aria-label={label}
        value={typeof value === "string" ? value : null}
        items={supportedLanguages.map((language) => ({
          value: language,
          label: languageLabel(t, language),
          ...(language === inheritedValue ? { marker: t("ui.defaultMarker") } : {}),
        }))}
        muted={inherited}
        disabled={disabled}
        onValueChange={(next) => void choose(next)}
      />
    );
  }

  if (type.kind === "enum" || type.kind === "locale") {
    const options =
      type.kind === "locale"
        ? (localeOptionSet(field.key)?.options(t, i18n.language) ?? []).map(
            ({ value: option, label: text }) => ({
              value: option,
              label: text,
            }),
          )
        : type.values.map((option) => ({
            value: option,
            label: translateKey(t, `${type.labelPrefix}.${option}`),
          }));
    return (
      <SettingSelect
        aria-label={label}
        value={String(value)}
        inheritedValue={
          inheritedValue === undefined || inheritedValue === null ? undefined : String(inheritedValue)
        }
        inherited={inherited}
        options={options}
        disabled={disabled}
        onValueChange={(next) => void onSave(next)}
        onFollowDefault={() => void onFollowDefault()}
      />
    );
  }

  return <TextControl {...props} />;

  function choose(next: string | null) {
    if (next === null) return Promise.resolve();
    if (next === inheritedValue) return inherited ? Promise.resolve() : onFollowDefault();
    if (next === value && !inherited) return Promise.resolve();
    return onSave(next);
  }
}

function TextControl({
  field,
  label,
  value,
  inherited,
  inheritedLabel,
  maximum,
  disabled,
  onSave,
  onFollowDefault,
}: SettingControlProps) {
  const { t } = useTranslation();
  const unlimitedValue = !inherited && value === "unlimited";
  const [draft, setDraft] = useState(inherited || unlimitedValue ? "" : String(value ?? ""));
  const [error, setError] = useState<string | null>(null);
  const type = field.type;
  const ceiling =
    type.kind === "number" && typeof maximum === "number" ? Math.min(type.max, maximum) : undefined;
  const offerUnlimited =
    type.kind === "number" && type.unlimited === true && (maximum === "unlimited" || maximum === null);

  const commit = async () => {
    setError(null);
    if (draft.trim() === "") {
      if (!inherited) await onFollowDefault();
      return;
    }
    if (type.kind === "number") {
      const highest = ceiling ?? type.max;
      const parsed = z.coerce
        .number()
        .int()
        .min(type.min)
        .max(highest)
        .safeParse(draft.replace(/[\s.,']/g, ""));
      if (!parsed.success) {
        setError(
          ceiling !== undefined && ceiling < type.max
            ? t("settings.aboveMaximum", { minimum: type.min, maximum: ceiling })
            : t("validation.range", { minimum: type.min, maximum: type.max }),
        );
        return;
      }
      if (inherited || parsed.data !== value) await onSave(parsed.data);
      return;
    }
    if (inherited || draft !== value) await onSave(draft.trim());
  };

  return (
    <div className="flex w-full flex-col gap-1">
      <Input
        aria-label={label}
        aria-invalid={error !== null}
        value={draft}
        placeholder={inherited ? inheritedLabel : unlimitedValue ? t("settings.noLimit") : undefined}
        disabled={disabled || unlimitedValue}
        inputMode={type.kind === "number" ? "numeric" : undefined}
        type={type.kind === "text" && type.inputType === "url" ? "url" : "text"}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void commit();
          }
        }}
      />
      {error ? (
        <span role="alert" className="text-danger text-sm">
          {error}
        </span>
      ) : null}
      {offerUnlimited ? (
        <Checkbox
          label={t("settings.noLimit")}
          checked={unlimitedValue}
          {...(disabled ? { disabled } : {})}
          onCheckedChange={(checked) => {
            setError(null);
            if (checked) void onSave("unlimited");
            else void onFollowDefault();
          }}
        />
      ) : null}
    </div>
  );
}
