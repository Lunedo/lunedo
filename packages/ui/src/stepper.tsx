import { Minus, Plus } from "lucide-react";
import { useId, useRef } from "react";
import { Button, IconButton } from "./button.js";
import { useUiLabels } from "./labels.js";

export interface StepperProps {
  value: number;
  onValueChange: (value: number) => void;
  steps: readonly number[];
  label: string;
  formatValue: (value: number) => string;
  defaultValue?: number;
  disabled?: boolean;
}

function nearestIndex(steps: readonly number[], value: number): number {
  let best = 0;
  steps.forEach((step, index) => {
    if (Math.abs(step - value) < Math.abs((steps[best] ?? step) - value)) best = index;
  });
  return best;
}

export function Stepper({
  value,
  onValueChange,
  steps,
  label,
  formatValue,
  defaultValue,
  disabled = false,
}: StepperProps) {
  const labels = useUiLabels();
  const valueId = useId();
  const decrease = useRef<HTMLButtonElement>(null);
  const index = nearestIndex(steps, value);
  const edge = (atEnd: boolean) =>
    disabled
      ? { disabled: true }
      : atEnd
        ? { "aria-disabled": true, className: "aria-disabled:cursor-not-allowed aria-disabled:border-dashed aria-disabled:bg-surface-sunken aria-disabled:text-text-muted" }
        : {};
  const move = (offset: number) => {
    if (disabled) return;
    const next = steps[index + offset];
    if (next !== undefined) onValueChange(next);
  };
  return (
    <fieldset aria-label={label} className="inline-flex min-w-0 flex-wrap items-center gap-2">
      <IconButton
        ref={decrease}
        label={labels.decrease}
        icon={Minus}
        variant="outline"
        size="sm"
        tooltip={false}
        aria-describedby={valueId}
        {...edge(index === 0)}
        onClick={() => move(-1)}
      />
      <output
        id={valueId}
        aria-live="polite"
        className="min-w-control-lg text-center font-medium text-text tabular-nums"
      >
        {formatValue(value)}
      </output>
      <IconButton
        label={labels.increase}
        icon={Plus}
        variant="outline"
        size="sm"
        tooltip={false}
        aria-describedby={valueId}
        {...edge(index === steps.length - 1)}
        onClick={() => move(1)}
      />
      {defaultValue !== undefined && value !== defaultValue && (
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => {
            onValueChange(defaultValue);
            decrease.current?.focus();
          }}
        >
          {labels.resetToDefault}
        </Button>
      )}
    </fieldset>
  );
}
