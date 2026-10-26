import { classNames } from "./class-names.js";
import { WIDE_HIT_AREA } from "./hit-area.js";

export interface FilterChipOption {
  value: string;
  label: string;
  count?: number;
}

export function FilterChips({
  label,
  value,
  options,
  onValueChange,
}: {
  label: string;
  value: string;
  options: readonly FilterChipOption[];
  onValueChange: (value: string) => void;
}) {
  return (
    <fieldset
      aria-label={label}
      data-filter-chips=""
      className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0"
    >
      {options.map((option) => {
        const pressed = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={pressed}
            onClick={() => onValueChange(option.value)}
            className={classNames(
              WIDE_HIT_AREA,
              "inline-flex h-control-sm items-center gap-1 rounded-full border px-3 text-sm whitespace-nowrap focus-visible:focus-ring",
              pressed
                ? "border-accent bg-accent-soft font-semibold text-accent"
                : "border-border bg-bg text-text hover:bg-hover",
            )}
          >
            {option.label}
            {option.count !== undefined ? (
              <span className="font-normal tabular-nums text-text-muted">{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </fieldset>
  );
}
