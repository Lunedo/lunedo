import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { classNames } from "./class-names.js";
import { Select } from "./controls.js";
import {
  DURATION_UNITS,
  type DurationUnit,
  formatDuration,
  joinDuration,
  splitDuration,
} from "./duration.js";
import { controlClassName, OutsideField, useFieldControl } from "./field.js";
import { WIDE_HIT_AREA } from "./hit-area.js";
import { useUiLabels } from "./labels.js";

export interface DurationInputProps {
  value: number | null;
  onValueChange?: (minutes: number | null) => void;
  onCommit?: (minutes: number | null) => void;
  units?: readonly DurationUnit[];
  quickChoices?: readonly number[];
  min?: number;
  max?: number;
  locale?: string;
  invalid?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
}

export function isDurationWithin(minutes: number | null, min?: number, max?: number): boolean {
  if (minutes === null) return false;
  return (min === undefined || minutes >= min) && (max === undefined || minutes <= max);
}

function parseAmount(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const amount = Number(trimmed);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

export function DurationInput({
  value,
  onValueChange,
  onCommit,
  units = DURATION_UNITS,
  quickChoices = [],
  min,
  max,
  locale,
  invalid,
  disabled,
  ...props
}: DurationInputProps) {
  const labels = useUiLabels();
  const field = useFieldControl();
  const initial =
    value === null ? { amount: null, unit: units.at(-1) ?? "minutes" } : splitDuration(value, units);
  const [text, setText] = useState(initial.amount === null ? "" : String(initial.amount));
  const [unit, setUnit] = useState<DurationUnit>(initial.unit);

  const minutesOf = (nextText: string, nextUnit: DurationUnit) => {
    const amount = parseAmount(nextText);
    return amount === null ? null : joinDuration({ amount, unit: nextUnit });
  };
  const current = minutesOf(text, unit);
  const shown = useRef(current);
  shown.current = current;
  const unitsRef = useRef(units);
  unitsRef.current = units;

  useEffect(() => {
    if (value === null || shown.current === value) return;
    const parts = splitDuration(value, unitsRef.current);
    setText(String(parts.amount));
    setUnit(parts.unit);
  }, [value]);

  const outOfRange = text.trim() !== "" && !isDurationWithin(current, min, max);

  const change = (nextText: string, nextUnit: DurationUnit, commit: boolean) => {
    setText(nextText);
    setUnit(nextUnit);
    const minutes = minutesOf(nextText, nextUnit);
    onValueChange?.(minutes);
    if (commit) onCommit?.(minutes);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && onCommit) {
      event.preventDefault();
      onCommit(current);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          {...field}
          {...(invalid || outOfRange ? { "aria-invalid": true } : {})}
          {...(props["aria-label"] ? { "aria-label": props["aria-label"] } : {})}
          {...(disabled !== undefined ? { disabled } : {})}
          inputMode="numeric"
          autoComplete="off"
          value={text}
          onChange={(event) => change(event.target.value, unit, false)}
          onBlur={() => onCommit?.(current)}
          onKeyDown={onKeyDown}
          className={classNames(controlClassName, "h-control-field w-number-field tabular-nums")}
        />
        {units.length > 1 ? (
          <OutsideField>
            <div className="w-unit-field max-w-full">
              <Select
                value={unit}
                onValueChange={(next) => change(text, next as DurationUnit, true)}
                options={units.map((option) => ({ value: option, label: labels[option] }))}
                aria-label={labels.durationUnit}
                {...(disabled !== undefined ? { disabled } : {})}
              />
            </div>
          </OutsideField>
        ) : (
          <span className="text-text-muted">{labels[unit]}</span>
        )}
      </div>
      {quickChoices.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {quickChoices.map((choice) => {
            const parts = splitDuration(choice, units);
            return (
              <button
                key={choice}
                type="button"
                aria-pressed={current === choice}
                {...(disabled !== undefined ? { disabled } : {})}
                onClick={() => change(String(parts.amount), parts.unit, true)}
                className={classNames(
                  WIDE_HIT_AREA,
                  "h-control-sm rounded-sm border border-border bg-surface px-2 text-sm text-text hover:bg-hover focus-visible:focus-ring disabled:cursor-not-allowed disabled:border-dashed disabled:bg-surface-sunken disabled:text-text-muted aria-pressed:border-accent aria-pressed:bg-accent-soft",
                )}
              >
                {formatDuration(choice, locale)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
