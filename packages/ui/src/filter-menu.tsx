import { Check, ChevronDown, Search } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { type KeyboardEvent, useId, useRef, useState } from "react";
import { classNames } from "./class-names.js";
import { controlClassName } from "./field.js";
import { WIDE_HIT_AREA } from "./hit-area.js";
import { Icon } from "./icon.js";
import { useUiLabels } from "./labels.js";

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
  description?: string;
}

export interface FilterMenuProps {
  label: string;
  value: string;
  options: FilterOption[];
  onValueChange: (value: string) => void;
  defaultValue?: string;
  valueLabel?: string;
  search?: { value: string; onChange: (value: string) => void; placeholder: string };
  emptyText?: string;
}

const CHIP =
  "inline-flex h-control-field max-w-full items-center gap-1.5 rounded-md border bg-control px-3 text-sm whitespace-nowrap hover:bg-hover focus-visible:focus-ring";

export function FilterMenu({
  label,
  value,
  options,
  onValueChange,
  defaultValue = "",
  valueLabel,
  search,
  emptyText,
}: FilterMenuProps) {
  const labels = useUiLabels();
  const [open, setOpen] = useState(false);
  const listId = useId();
  const list = useRef<HTMLUListElement>(null);
  const active = value !== defaultValue;
  const shown = valueLabel ?? options.find((option) => option.value === value)?.label;
  const move = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = Array.from(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    if (buttons.length === 0) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "ArrowDown"
        ? buttons[(index + 1) % buttons.length]
        : buttons[(index - 1 + buttons.length) % buttons.length];
    next?.focus();
  };
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          data-filter-active={active ? "" : undefined}
          className={classNames(
            CHIP,
            active ? "border-accent text-text" : "border-control-border text-text-muted",
          )}
        >
          <span>{shown ? `${label}:` : label}</span>
          {shown ? (
            <span className={classNames("truncate text-text", active && "font-medium")} title={shown}>
              {shown}
            </span>
          ) : null}
          <Icon icon={ChevronDown} size="sm" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          aria-label={label}
          onKeyDown={move}
          className="z-50 flex max-h-dialog w-field max-w-screen flex-col gap-1 overflow-y-auto rounded-md border border-border bg-surface p-1 text-text shadow-popover focus-visible:focus-ring"
        >
          <p className="px-2 pt-2 pb-1 text-xs font-semibold tracking-label text-text-muted uppercase">
            {label}
          </p>
          {search ? (
            <div className="relative px-1 pb-1">
              <Icon
                icon={Search}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-muted"
              />
              <input
                type="search"
                value={search.value}
                aria-label={search.placeholder}
                aria-controls={listId}
                placeholder={search.placeholder}
                onChange={(event) => search.onChange(event.target.value)}
                className={classNames(controlClassName, "h-control-field pl-8 text-sm")}
              />
            </div>
          ) : null}
          <ul ref={list} id={listId} className="flex flex-col">
            {options.length === 0 ? (
              <li className="px-2 py-2 text-sm text-text-muted">{emptyText ?? labels.noMatches}</li>
            ) : (
              options.map((option) => {
                const selected = option.value === value;
                return (
                  <li key={option.value}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        onValueChange(option.value);
                        setOpen(false);
                      }}
                      className={classNames(
                        WIDE_HIT_AREA,
                        "flex min-h-row w-full items-center gap-2 rounded-sm px-2 py-1 text-left hover:bg-hover focus-visible:bg-hover focus-visible:outline-none",
                      )}
                    >
                      <span className="flex w-4 shrink-0 justify-center text-accent">
                        {selected ? <Icon icon={Check} size="sm" /> : null}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate" title={option.label}>
                          {option.label}
                        </span>
                        {option.description ? (
                          <span className="truncate text-xs text-text-muted" title={option.description}>
                            {option.description}
                          </span>
                        ) : null}
                      </span>
                      {option.count !== undefined ? (
                        <span className="text-xs text-text-muted tabular-nums">{option.count}</span>
                      ) : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
