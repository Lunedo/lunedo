import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { type KeyboardEvent, type Ref, useEffect, useMemo, useRef, useState } from "react";
import { Button, IconButton } from "./button.js";
import { classNames } from "./class-names.js";
import { Combobox } from "./combobox.js";
import { controlWidth, useFieldControl } from "./field.js";
import { Icon } from "./icon.js";
import { useUiLabels } from "./labels.js";

export type WeekStart = "monday" | "sunday" | "saturday";

const WEEK_START_INDEX: Record<WeekStart, number> = { sunday: 0, monday: 1, saturday: 6 };
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIsoDate(value: string): Date | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), Math.min(date.getUTCDate(), last)));
}

export function monthGrid(month: Date, weekStart: WeekStart): Date[] {
  const first = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
  const offset = (first.getUTCDay() - WEEK_START_INDEX[weekStart] + 7) % 7;
  const start = addDays(first, -offset);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function todayIso(): string {
  const now = new Date();
  return isoDate(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

export interface DatePickerProps {
  value: string;
  onValueChange: (value: string) => void;
  formatDate: (date: Date) => string;
  locale?: string;
  weekStart?: WeekStart;
  min?: string;
  max?: string;
  placeholder?: string;
  clearable?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
  "aria-label"?: string;
}

export function DatePicker({
  value,
  onValueChange,
  formatDate,
  locale,
  weekStart = "monday",
  min,
  max,
  placeholder,
  clearable = false,
  invalid,
  disabled = false,
  className,
  ref,
  ...props
}: DatePickerProps) {
  const labels = useUiLabels();
  const { "aria-required": _required, ...field } = useFieldControl();
  const selected = parseIsoDate(value);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState<Date>(() => selected ?? parseIsoDate(todayIso()) ?? new Date());
  const grid = useRef<HTMLTableElement>(null);
  const month = new Date(Date.UTC(focused.getUTCFullYear(), focused.getUTCMonth(), 1));
  const days = monthGrid(month, weekStart);
  const monthLabel = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(month),
    [locale, month],
  );
  const weekdays = useMemo(() => {
    const short = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
    const long = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" });
    return days.slice(0, 7).map((day) => ({ short: short.format(day), long: long.format(day) }));
  }, [locale, days]);
  const dayLabel = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" }),
    [locale],
  );
  const allowed = (date: Date) => {
    const iso = isoDate(date);
    return (!min || iso >= min) && (!max || iso <= max);
  };
  const focusedIso = isoDate(focused);

  useEffect(() => {
    if (!open) return;
    grid.current?.querySelector<HTMLButtonElement>(`[data-date="${focusedIso}"]`)?.focus();
  }, [open, focusedIso]);

  const choose = (date: Date) => {
    if (!allowed(date)) return;
    onValueChange(isoDate(date));
    setOpen(false);
  };

  const move = (event: KeyboardEvent<HTMLTableElement>) => {
    const steps: Record<string, () => Date> = {
      ArrowLeft: () => addDays(focused, -1),
      ArrowRight: () => addDays(focused, 1),
      ArrowUp: () => addDays(focused, -7),
      ArrowDown: () => addDays(focused, 7),
      PageUp: () => addMonths(focused, -1),
      PageDown: () => addMonths(focused, 1),
      Home: () => addDays(focused, -((focused.getUTCDay() - WEEK_START_INDEX[weekStart] + 7) % 7)),
      End: () => addDays(focused, 6 - ((focused.getUTCDay() - WEEK_START_INDEX[weekStart] + 7) % 7)),
    };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    setFocused(step());
  };

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setFocused(selected ?? parseIsoDate(todayIso()) ?? new Date());
        setOpen(next);
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <button
          ref={ref}
          type="button"
          disabled={disabled}
          {...(min ? { "data-min": min } : {})}
          {...(max ? { "data-max": max } : {})}
          {...field}
          {...(invalid ? { "aria-invalid": true } : {})}
          {...(props["aria-label"] ? { "aria-label": props["aria-label"] } : {})}
          className={classNames(
            controlWidth(className),
            "inline-flex h-control-field items-center justify-between gap-2 text-left",
            className,
          )}
        >
          <span className={classNames("min-w-0 flex-1 truncate", !selected && "text-text-muted")}>
            {selected ? formatDate(selected) : (placeholder ?? labels.chooseDate)}
          </span>
          <Icon icon={CalendarDays} size="sm" className="text-text-muted" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            grid.current?.querySelector<HTMLButtonElement>(`[data-date="${focusedIso}"]`)?.focus();
          }}
          onCloseAutoFocus={(event) => {
            if (document.activeElement && document.activeElement !== document.body) event.preventDefault();
          }}
          className="z-50 flex flex-col gap-2 rounded-md border border-border bg-surface p-3 shadow-popover"
        >
          <div className="flex items-center justify-between gap-2">
            <IconButton
              label={labels.previousMonth}
              icon={ChevronLeft}
              variant="ghost"
              size="sm"
              onClick={() => setFocused(addMonths(focused, -1))}
            />
            <span className="font-medium" aria-live="polite">
              {monthLabel}
            </span>
            <IconButton
              label={labels.nextMonth}
              icon={ChevronRight}
              variant="ghost"
              size="sm"
              onClick={() => setFocused(addMonths(focused, 1))}
            />
          </div>
          <table
            ref={grid}
            aria-label={monthLabel}
            onKeyDown={move}
            className="border-separate border-spacing-1"
          >
            <thead>
              <tr>
                {weekdays.map((weekday) => (
                  <th
                    key={weekday.long}
                    scope="col"
                    abbr={weekday.long}
                    className="h-control-sm text-center text-xs font-normal text-text-muted"
                  >
                    {weekday.short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3, 4, 5].map((row) => (
                <tr key={row}>
                  {days.slice(row * 7, row * 7 + 7).map((day) => {
                    const iso = isoDate(day);
                    const inMonth = day.getUTCMonth() === month.getUTCMonth();
                    const isSelected = value === iso;
                    const enabled = allowed(day);
                    return (
                      <td key={iso} className="p-0">
                        <button
                          type="button"
                          data-date={iso}
                          aria-pressed={isSelected}
                          tabIndex={iso === focusedIso ? 0 : -1}
                          disabled={!enabled}
                          aria-label={dayLabel.format(day)}
                          aria-current={iso === todayIso() ? "date" : undefined}
                          onClick={() => choose(day)}
                          className={classNames(
                            "flex size-control-md items-center justify-center rounded-md text-sm tabular-nums focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-40",
                            isSelected
                              ? "bg-accent font-semibold text-on-accent"
                              : inMonth
                                ? "text-text hover:bg-hover"
                                : "text-text-muted hover:bg-hover",
                            iso === todayIso() && !isSelected && "font-semibold text-accent",
                          )}
                        >
                          {day.getUTCDate()}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const today = parseIsoDate(todayIso());
                if (today) choose(today);
              }}
            >
              {labels.today}
            </Button>
            {clearable && value ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onValueChange("");
                  setOpen(false);
                }}
              >
                {labels.clear}
              </Button>
            ) : null}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

export function timeOptions(locale: string | undefined, hour12: boolean, stepMinutes = 15) {
  const format = new Intl.DateTimeFormat(locale, {
    hour: hour12 ? "numeric" : "2-digit",
    minute: "2-digit",
    hour12,
    timeZone: "UTC",
  });
  return Array.from({ length: (24 * 60) / stepMinutes }, (_, index) => {
    const minutes = index * stepMinutes;
    const value = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    return { value, label: format.format(new Date(Date.UTC(2026, 0, 1, 0, minutes))) };
  });
}

export function TimePicker({
  value,
  onValueChange,
  locale,
  hour12 = false,
  invalid,
  disabled,
  ...props
}: {
  value: string;
  onValueChange: (value: string) => void;
  locale?: string;
  hour12?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const items = useMemo(() => {
    const options = timeOptions(locale, hour12);
    return value && !options.some((option) => option.value === value)
      ? [...options, { value, label: value }].sort((a, b) => a.value.localeCompare(b.value))
      : options;
  }, [locale, hour12, value]);
  return (
    <Combobox
      items={items}
      value={value || null}
      onValueChange={(next) => onValueChange(next ?? "")}
      {...(invalid !== undefined ? { invalid } : {})}
      {...(disabled !== undefined ? { disabled } : {})}
      {...(props["aria-label"] ? { "aria-label": props["aria-label"] } : {})}
    />
  );
}
