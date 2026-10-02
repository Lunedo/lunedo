import { Popover as PopoverPrimitive } from "radix-ui";
import { useState } from "react";
import { Button } from "./button.js";
import { Select, type SelectOption } from "./controls.js";
import { DURATION_UNITS, type DurationUnit, formatDuration } from "./duration.js";
import { DurationInput, isDurationWithin } from "./duration-input.js";
import { useUiLabels } from "./labels.js";

export interface SettingOption {
  value: string;
  label: string;
  example?: string;
}

export interface SettingSelectProps {
  value: string;
  inheritedValue?: string | undefined;
  inherited: boolean;
  options: readonly SettingOption[];
  onValueChange: (value: string) => void;
  onFollowDefault: () => void;
  disabled?: boolean;
  invalid?: boolean;
  "aria-label"?: string;
}

export function SettingSelect({
  value,
  inheritedValue,
  inherited,
  options,
  onValueChange,
  onFollowDefault,
  disabled,
  invalid,
  ...props
}: SettingSelectProps) {
  const labels = useUiLabels();
  const items: SelectOption[] = options.map((option) => ({
    value: option.value,
    label: option.label,
    ...(option.example ? { example: option.example } : {}),
    ...(option.value === inheritedValue ? { marker: labels.defaultMarker } : {}),
  }));
  return (
    <Select
      value={value}
      options={items}
      {...(disabled !== undefined ? { disabled } : {})}
      {...(invalid !== undefined ? { invalid } : {})}
      {...(props["aria-label"] ? { "aria-label": props["aria-label"] } : {})}
      muted={inherited}
      className="w-full"
      onValueChange={(next) => {
        if (next === inheritedValue) {
          if (!inherited) onFollowDefault();
          return;
        }
        if (next !== value || inherited) onValueChange(next);
      }}
    />
  );
}

const NO_LIMIT = "none";
const CUSTOM = "custom";

export interface DurationSelectProps {
  value: number | null;
  inheritedValue?: number | null | undefined;
  inherited?: boolean;
  choices: readonly number[];
  units?: readonly DurationUnit[];
  min?: number;
  max?: number;
  locale?: string;
  noLimitLabel?: string;
  onValueChange: (minutes: number | null) => void;
  onFollowDefault?: () => void;
  disabled?: boolean;
  invalid?: boolean;
  "aria-label"?: string;
}

function keyOf(minutes: number | null): string {
  return minutes === null ? NO_LIMIT : String(minutes);
}

export function DurationSelect({
  value,
  inheritedValue,
  inherited = false,
  choices,
  units = DURATION_UNITS,
  min,
  max,
  locale,
  noLimitLabel,
  onValueChange,
  onFollowDefault,
  disabled,
  invalid,
  ...props
}: DurationSelectProps) {
  const labels = useUiLabels();
  const [customOpen, setCustomOpen] = useState(false);
  const [draft, setDraft] = useState<number | null>(value);
  const [error, setError] = useState<string | null>(null);
  const known = new Set<number>(choices.filter((choice) => isDurationWithin(choice, min, max)));
  if (typeof value === "number") known.add(value);
  if (typeof inheritedValue === "number") known.add(inheritedValue);
  const marker = (minutes: number | null) =>
    inheritedValue !== undefined && minutes === inheritedValue ? { marker: labels.defaultMarker } : {};
  const options: SelectOption[] = [
    ...(noLimitLabel ? [{ value: NO_LIMIT, label: noLimitLabel, ...marker(null) }] : []),
    ...[...known]
      .sort((left, right) => left - right)
      .map((minutes) => ({
        value: String(minutes),
        label: formatDuration(minutes, locale),
        ...marker(minutes),
      })),
    { value: CUSTOM, label: labels.custom },
  ];

  const choose = (minutes: number | null) => {
    if (inheritedValue !== undefined && minutes === inheritedValue) {
      if (!inherited) onFollowDefault?.();
      return;
    }
    if (minutes !== value || inherited) onValueChange(minutes);
  };

  const apply = () => {
    if (!isDurationWithin(draft, min, max) || draft === null) {
      setError(
        labels.durationRange
          .replace("{minimum}", formatDuration(min ?? 1, locale))
          .replace("{maximum}", max === undefined ? "∞" : formatDuration(max, locale)),
      );
      return;
    }
    setError(null);
    setCustomOpen(false);
    choose(draft);
  };

  return (
    <PopoverPrimitive.Root
      open={customOpen}
      onOpenChange={(next) => {
        setCustomOpen(next);
        if (!next) setError(null);
      }}
    >
      <PopoverPrimitive.Anchor asChild>
        <div className="w-full">
          <Select
            value={keyOf(value)}
            options={options}
            {...(disabled !== undefined ? { disabled } : {})}
            {...(invalid !== undefined ? { invalid } : {})}
            {...(props["aria-label"] ? { "aria-label": props["aria-label"] } : {})}
            muted={inherited}
            className="w-full"
            onValueChange={(next) => {
              if (next === CUSTOM) {
                setDraft(value);
                setTimeout(() => setCustomOpen(true), 0);
                return;
              }
              choose(next === NO_LIMIT ? null : Number(next));
            }}
          />
        </div>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={4}
          collisionPadding={8}
          aria-label={props["aria-label"] ?? labels.custom}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return;
            event.preventDefault();
            apply();
          }}
          className="z-50 flex min-w-popover-trigger flex-col gap-3 rounded-md border border-border bg-surface p-3 text-text shadow-popover"
        >
          <DurationInput
            value={draft}
            units={units}
            {...(min !== undefined ? { min } : {})}
            {...(max !== undefined ? { max } : {})}
            {...(locale ? { locale } : {})}
            invalid={error !== null}
            {...(props["aria-label"] ? { "aria-label": props["aria-label"] } : {})}
            onValueChange={(minutes) => {
              setDraft(minutes);
              setError(null);
            }}
          />
          {error ? (
            <span role="alert" className="text-sm text-danger">
              {error}
            </span>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setCustomOpen(false)}>
              {labels.cancel}
            </Button>
            <Button size="sm" variant="primary" onClick={apply}>
              {labels.apply}
            </Button>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
