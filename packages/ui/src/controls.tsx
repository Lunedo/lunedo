import { Check, ChevronDown } from "lucide-react";
import {
  Checkbox as CheckboxPrimitive,
  RadioGroup as RadioGroupPrimitive,
  Select as SelectPrimitive,
  Slider as SliderPrimitive,
  Switch as SwitchPrimitive,
  ToggleGroup as ToggleGroupPrimitive,
} from "radix-ui";
import { type ReactNode, useId, useRef } from "react";
import { classNames } from "./class-names.js";
import { controlClassName, useFieldControl } from "./field.js";
import { Icon } from "./icon.js";
import { Tooltip } from "./tooltip.js";
import { useTruncated } from "./truncated-text.js";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  group?: string;
}

export interface SelectProps {
  value: string | undefined;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
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
  className,
  ...props
}: SelectProps) {
  const field = useFieldControl();
  const selected = options.find((option) => option.value === value);
  const valueRef = useRef<HTMLSpanElement>(null);
  const truncated = useTruncated(valueRef, selected?.label ?? "");
  const trigger = (
    <SelectPrimitive.Trigger
      {...field}
      {...(invalid ? { "aria-invalid": true } : {})}
      {...(props["aria-label"] ? { "aria-label": props["aria-label"] } : {})}
      className={classNames(
        controlClassName,
        "inline-flex h-control-field items-center justify-between gap-2 overflow-hidden text-left",
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
      {truncated && selected ? <Tooltip content={selected.label}>{trigger}</Tooltip> : trigger}
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-sidebar min-w-field overflow-hidden rounded-md border border-border bg-surface shadow-popover"
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
                    className="relative flex h-row cursor-default items-center rounded-sm pr-2 pl-8 text-base text-text outline-none select-none data-disabled:opacity-50 data-highlighted:bg-hover"
                  >
                    <SelectPrimitive.ItemIndicator className="absolute left-2 inline-flex">
                      <Icon icon={Check} className="text-accent" />
                    </SelectPrimitive.ItemIndicator>
                    <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
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
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  "aria-label"?: string;
}

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
  ...props
}: CheckboxProps) {
  const field = useFieldControl();
  const generated = useId();
  const id = field.id ?? `checkbox-${generated}`;
  const descriptionId = description ? `${id}-description` : undefined;
  return (
    <div className="flex items-start gap-2">
      <CheckboxPrimitive.Root
        {...field}
        id={id}
        checked={checked}
        onCheckedChange={(state) => onCheckedChange(state === true)}
        {...(disabled !== undefined ? { disabled } : {})}
        {...(props["aria-label"] ? { "aria-label": props["aria-label"] } : {})}
        {...(descriptionId ? { "aria-describedby": descriptionId } : {})}
        className="mt-1 flex size-4 shrink-0 items-center justify-center rounded-sm border border-border bg-surface text-on-accent focus-visible:focus-ring disabled:opacity-60 aria-checked:border-accent aria-checked:bg-accent"
      >
        <CheckboxPrimitive.Indicator>
          <Icon icon={Check} size="sm" />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {(label || description) && (
        <div className="flex flex-col">
          {label && (
            <label htmlFor={id} className="text-text">
              {label}
            </label>
          )}
          {description && (
            <span id={descriptionId} className="text-sm text-text-muted">
              {description}
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
      className="group relative inline-flex h-5 w-10 shrink-0 items-center rounded-full border border-control-border bg-surface px-1 transition-colors focus-visible:focus-ring aria-checked:border-accent aria-checked:bg-accent data-disabled:cursor-not-allowed data-disabled:border-dashed data-disabled:opacity-50 motion-reduce:transition-none"
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
              "flex cursor-pointer items-start gap-3",
              variant === "card" &&
                "rounded-md border border-border p-3 has-aria-checked:border-accent has-aria-checked:bg-accent-soft",
            )}
          >
            <RadioGroupPrimitive.Item
              id={itemId}
              value={option.value}
              className="mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border border-border bg-surface focus-visible:focus-ring aria-checked:border-accent"
            >
              <RadioGroupPrimitive.Indicator className="block size-2 rounded-full bg-accent" />
            </RadioGroupPrimitive.Item>
            <span className="flex flex-col">
              <span className="font-medium text-text">{option.label}</span>
              {option.description && <span className="text-sm text-text-muted">{option.description}</span>}
            </span>
          </label>
        );
      })}
    </RadioGroupPrimitive.Root>
  );
}

export interface SegmentedControlProps {
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: ReactNode }[];
  label: string;
}

export function SegmentedControl({ value, onValueChange, options, label }: SegmentedControlProps) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onValueChange(next);
      }}
      aria-label={label}
      className="inline-flex gap-1 rounded-md border border-border bg-surface-sunken p-1"
    >
      {options.map((option) => (
        <ToggleGroupPrimitive.Item
          key={option.value}
          value={option.value}
          className="h-control-sm rounded-sm px-3 font-medium text-text-muted focus-visible:focus-ring aria-checked:bg-surface aria-checked:text-text aria-checked:shadow-card"
        >
          {option.label}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
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
