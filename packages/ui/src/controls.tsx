import { Check, ChevronDown, CircleAlert, Minus } from "lucide-react";
import {
  Checkbox as CheckboxPrimitive,
  RadioGroup as RadioGroupPrimitive,
  Select as SelectPrimitive,
  Slider as SliderPrimitive,
  Switch as SwitchPrimitive,
  ToggleGroup as ToggleGroupPrimitive,
} from "radix-ui";
import { type ReactNode, type RefObject, useId, useLayoutEffect, useRef, useState } from "react";
import { classNames } from "./class-names.js";
import { controlWidth, useFieldControl } from "./field.js";
import { HIT_AREA, WIDE_HIT_AREA } from "./hit-area.js";
import { Icon } from "./icon.js";
import { Tooltip } from "./tooltip.js";
import { useTruncated } from "./truncated-text.js";

export interface SelectOption {
  value: string;
  label: string;
  example?: string;
  marker?: string;
  disabled?: boolean;
  group?: string;
}

export function optionText(option: SelectOption): string {
  return option.example ? `${option.label} (${option.example})` : option.label;
}

export interface SelectProps {
  value: string | undefined;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  muted?: boolean;
  "aria-label"?: string;
  className?: string;
}

function groupOptions(options: SelectOption[]): [string | undefined, SelectOption[]][] {
  const groups = new Map<string | undefined, SelectOption[]>();
  for (const option of options) groups.set(option.group, [...(groups.get(option.group) ?? []), option]);
  return [...groups];
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  invalid,
  disabled,
  muted,
  className,
  ...props
}: SelectProps) {
  const field = useFieldControl();
  const selected = options.find((option) => option.value === value);
  const valueRef = useRef<HTMLSpanElement>(null);
  const truncated = useTruncated(valueRef, selected ? optionText(selected) : "");
  const trigger = (
    <SelectPrimitive.Trigger
      {...field}
      {...(invalid ? { "aria-invalid": true } : {})}
      {...(muted ? { "data-muted": "" } : {})}
      {...(props["aria-label"] ? { "aria-label": props["aria-label"] } : {})}
      className={classNames(
        controlWidth(className),
        WIDE_HIT_AREA,
        "inline-flex h-control-field items-center justify-between gap-2 text-left",
        muted && "text-text-muted",
        className,
      )}
    >
      <span ref={valueRef} className="min-w-0 flex-1 truncate">
        <SelectPrimitive.Value {...(placeholder !== undefined ? { placeholder } : {})} />
      </span>
      <SelectPrimitive.Icon>
        <Icon icon={ChevronDown} className="text-text-muted" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
  return (
    <SelectPrimitive.Root
      {...(value !== undefined ? { value } : {})}
      onValueChange={onValueChange}
      {...(disabled !== undefined ? { disabled } : {})}
    >
      <Tooltip content={selected ? optionText(selected) : ""} disabled={!truncated || !selected}>
        {trigger}
      </Tooltip>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-sidebar min-w-select-trigger overflow-hidden rounded-md border border-border bg-surface shadow-popover"
        >
          <SelectPrimitive.Viewport className="p-1">
            {groupOptions(options).map(([group, items]) => (
              <SelectPrimitive.Group key={group ?? ""}>
                {group && (
                  <SelectPrimitive.Label className="px-2 pt-2 pb-1 text-xs font-semibold tracking-label text-text-muted uppercase">
                    {group}
                  </SelectPrimitive.Label>
                )}
                {items.map((option) => (
                  <SelectPrimitive.Item
                    key={option.value}
                    value={option.value}
                    {...(option.disabled !== undefined ? { disabled: option.disabled } : {})}
                    className="relative flex h-row cursor-default items-center rounded-sm pr-2 pl-8 text-base text-text outline-none select-none data-disabled:cursor-not-allowed data-disabled:text-text-muted data-highlighted:bg-hover"
                  >
                    <SelectPrimitive.ItemIndicator className="absolute left-2 inline-flex">
                      <Icon icon={Check} className="text-accent" />
                    </SelectPrimitive.ItemIndicator>
                    <SelectPrimitive.ItemText>
                      {option.label}
                      {option.example ? <span className="text-text-muted"> ({option.example})</span> : null}
                    </SelectPrimitive.ItemText>
                    {option.marker ? (
                      <span className="ml-auto pl-4 text-xs font-medium text-text-muted">
                        {option.marker}
                      </span>
                    ) : null}
                  </SelectPrimitive.Item>
                ))}
              </SelectPrimitive.Group>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export interface CheckboxProps {
  checked: boolean | "mixed";
  onCheckedChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  disabled?: boolean;
  "aria-label"?: string;
}

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  description,
  error,
  disabled,
  ...props
}: CheckboxProps) {
  const field = useFieldControl();
  const generated = useId();
  const id = field.id ?? `checkbox-${generated}`;
  const errorId = error ? `${id}-error` : undefined;
  const descriptionId =
    [errorId, description ? `${id}-description` : undefined].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex items-start gap-2">
      <CheckboxPrimitive.Root
        {...field}
        {...(error ? { "aria-invalid": true } : {})}
        id={id}
        checked={checked === "mixed" ? "indeterminate" : checked}
        onCheckedChange={(state) => onCheckedChange(state === true)}
        {...(disabled !== undefined ? { disabled } : {})}
        {...(props["aria-label"] ? { "aria-label": props["aria-label"] } : {})}
        {...(descriptionId ? { "aria-describedby": descriptionId } : {})}
        className={classNames(
          HIT_AREA,
          "mt-1 flex size-4 shrink-0 items-center justify-center rounded-sm border border-control-border bg-control text-on-accent focus-visible:focus-ring aria-invalid:border-danger disabled:cursor-not-allowed disabled:border-dashed disabled:bg-surface-sunken aria-checked:border-accent aria-checked:bg-accent disabled:aria-checked:border-control-border disabled:aria-checked:bg-control-border",
          checked === "mixed" && !disabled && "border-accent bg-accent",
        )}
      >
        <CheckboxPrimitive.Indicator>
          <Icon icon={checked === "mixed" ? Minus : Check} size="sm" />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {(label || description || error) && (
        <div className="flex flex-col">
          {label && (
            <label htmlFor={id} className="text-text">
              {label}
            </label>
          )}
          {description && (
            <span id={`${id}-description`} className="text-sm text-text-muted">
              {description}
            </span>
          )}
          {error && (
            <span id={errorId} className="text-sm text-danger">
              <Icon icon={CircleAlert} size="sm" className="mr-1 inline align-text-bottom" />
              {error}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  labelHidden?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  labelHidden = false,
  disabled = false,
  disabledReason,
}: SwitchProps) {
  const id = useId();
  const reasonId = `${id}-reason`;
  const explained = disabled && disabledReason !== undefined;
  const root = (
    <SwitchPrimitive.Root
      id={id}
      checked={checked}
      onCheckedChange={explained ? () => {} : onCheckedChange}
      {...(disabled && !explained ? { disabled: true } : {})}
      {...(explained ? { "aria-disabled": true, "aria-describedby": reasonId, "data-disabled": "" } : {})}
      {...(labelHidden ? { "aria-label": label } : {})}
      className={classNames(
        WIDE_HIT_AREA,
        "group inline-flex h-5 w-10 shrink-0 items-center rounded-full border border-control-border bg-control px-1 transition-colors focus-visible:focus-ring aria-checked:border-accent aria-checked:bg-accent data-disabled:cursor-not-allowed data-disabled:border-dashed data-disabled:bg-surface-sunken data-disabled:aria-checked:border-control-border data-disabled:aria-checked:bg-control-border motion-reduce:transition-none",
      )}
    >
      <SwitchPrimitive.Thumb className="block size-3 rounded-full bg-control-border transition-transform group-aria-checked:translate-x-5 group-aria-checked:bg-on-accent motion-reduce:transition-none" />
    </SwitchPrimitive.Root>
  );
  return (
    <div className="inline-flex items-center gap-2">
      {explained ? <Tooltip content={disabledReason}>{root}</Tooltip> : root}
      {explained && (
        <span id={reasonId} hidden>
          {disabledReason}
        </span>
      )}
      {!labelHidden && (
        <label htmlFor={id} className={classNames("text-text", disabled && "text-text-muted")}>
          {label}
        </label>
      )}
    </div>
  );
}

export interface ChoiceOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps {
  value: string;
  onValueChange: (value: string) => void;
  options: ChoiceOption[];
  label: string;
  variant?: "default" | "card";
}

export function RadioGroup({ value, onValueChange, options, label, variant = "default" }: RadioGroupProps) {
  const id = useId();
  return (
    <RadioGroupPrimitive.Root
      value={value}
      onValueChange={onValueChange}
      aria-label={label}
      className="flex flex-col gap-2"
    >
      {options.map((option) => {
        const itemId = `${id}-${option.value}`;
        return (
          <label
            key={option.value}
            htmlFor={itemId}
            className={classNames(
              "flex items-start gap-3",
              option.disabled ? "cursor-not-allowed" : "cursor-pointer",
              variant === "card" &&
                "rounded-md border border-border p-3 has-aria-checked:border-accent has-aria-checked:bg-accent-soft",
            )}
          >
            <RadioGroupPrimitive.Item
              id={itemId}
              value={option.value}
              {...(option.disabled ? { disabled: true } : {})}
              className={classNames(
                HIT_AREA,
                "mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border border-control-border bg-control focus-visible:focus-ring disabled:opacity-60 aria-checked:border-accent",
              )}
            >
              <RadioGroupPrimitive.Indicator className="block size-2 rounded-full bg-accent" />
            </RadioGroupPrimitive.Item>
            <span className="flex flex-col">
              <span className={classNames("font-medium", option.disabled ? "text-text-muted" : "text-text")}>
                {option.label}
              </span>
              {option.description && <span className="text-sm text-text-muted">{option.description}</span>}
            </span>
          </label>
        );
      })}
    </RadioGroupPrimitive.Root>
  );
}

export interface SegmentedOption {
  value: string;
  label: string;
  disabled?: boolean;
  disabledReason?: string;
}

export interface SegmentedControlProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SegmentedOption[];
  label: string;
  disabled?: boolean;
}

const SEGMENTED_ROOT = "inline-flex gap-1 rounded-md border border-control-border bg-surface-sunken p-1";
const SEGMENTED_ITEM = "h-control-sm rounded-sm px-3 font-medium whitespace-nowrap";

function SegmentedItem({ option }: { option: SegmentedOption }) {
  const reasonId = useId();
  const blocked = option.disabled === true;
  const item = (
    <ToggleGroupPrimitive.Item
      value={option.value}
      {...(blocked ? { "aria-disabled": true } : {})}
      {...(blocked && option.disabledReason ? { "aria-describedby": reasonId } : {})}
      className={classNames(
        SEGMENTED_ITEM,
        WIDE_HIT_AREA,
        "text-text-muted focus-visible:focus-ring aria-checked:bg-accent aria-checked:text-on-accent",
        blocked
          ? "cursor-not-allowed border border-dashed border-control-border"
          : "hover:bg-hover hover:text-text aria-checked:hover:bg-accent-hover",
      )}
    >
      {option.label}
    </ToggleGroupPrimitive.Item>
  );
  if (!blocked || !option.disabledReason) return item;
  return (
    <>
      <Tooltip content={option.disabledReason}>{item}</Tooltip>
      <span id={reasonId} className="sr-only">
        {option.disabledReason}
      </span>
    </>
  );
}

export function useFits<T extends HTMLElement, M extends HTMLElement>(
  container: RefObject<T | null>,
  content: RefObject<M | null>,
  key: string,
): boolean {
  const [fits, setFits] = useState(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: new content changes the width to measure
  useLayoutEffect(() => {
    const outer = container.current;
    const inner = content.current;
    if (!outer || !inner) return;
    const measure = () => setFits(inner.scrollWidth <= outer.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [container, content, key]);
  return fits;
}

export function SegmentedControl({ value, onValueChange, options, label, disabled }: SegmentedControlProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const fits = useFits(containerRef, measureRef, options.map((option) => option.label).join("|"));
  const choose = (next: string) => {
    if (!next || options.find((option) => option.value === next)?.disabled) return;
    onValueChange(next);
  };
  return (
    <div
      ref={containerRef}
      data-segmented=""
      data-collapsed={fits ? undefined : ""}
      className={classNames("relative min-w-0", fits ? "inline-flex max-w-full" : "flex w-full")}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden"
      >
        <div ref={measureRef} className={classNames(SEGMENTED_ROOT, "w-max")}>
          {options.map((option) => (
            <span key={option.value} className={classNames(SEGMENTED_ITEM, "inline-flex items-center")}>
              {option.label}
            </span>
          ))}
        </div>
      </div>
      {fits ? (
        <ToggleGroupPrimitive.Root
          type="single"
          value={value}
          {...(disabled !== undefined ? { disabled } : {})}
          onValueChange={choose}
          aria-label={label}
          className={classNames(SEGMENTED_ROOT, "max-w-full")}
        >
          {options.map((option) => (
            <SegmentedItem key={option.value} option={option} />
          ))}
        </ToggleGroupPrimitive.Root>
      ) : (
        <Select
          value={value}
          onValueChange={choose}
          aria-label={label}
          {...(disabled !== undefined ? { disabled } : {})}
          className="w-full"
          options={options.map((option) => ({
            value: option.value,
            label: option.label,
            ...(option.disabled ? { disabled: true } : {}),
            ...(option.disabled && option.disabledReason ? { marker: option.disabledReason } : {}),
          }))}
        />
      )}
    </div>
  );
}

export interface SliderProps {
  value: number;
  onValueChange: (value: number) => void;
  steps: readonly number[];
  label: string;
  formatValue: (value: number) => string;
}

export function Slider({ value, onValueChange, steps, label, formatValue }: SliderProps) {
  const index = Math.max(0, steps.indexOf(value));
  return (
    <div className="inline-flex items-center gap-3">
      <SliderPrimitive.Root
        value={[index]}
        min={0}
        max={steps.length - 1}
        step={1}
        onValueChange={([next = index]) => {
          const step = steps[next];
          if (step !== undefined) onValueChange(step);
        }}
        className="relative flex h-5 w-field max-w-full touch-none items-center select-none"
      >
        <SliderPrimitive.Track className="relative h-1 grow rounded-full bg-border">
          <SliderPrimitive.Range className="absolute h-full rounded-full bg-accent" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          aria-label={label}
          aria-valuetext={formatValue(value)}
          className="block size-4 rounded-full border-2 border-accent bg-surface focus-visible:focus-ring"
        />
      </SliderPrimitive.Root>
      <span aria-hidden="true" className="min-w-12 text-right text-sm text-text-muted tabular-nums">
        {formatValue(value)}
      </span>
    </div>
  );
}
