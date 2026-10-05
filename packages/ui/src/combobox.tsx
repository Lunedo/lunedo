import { Check, ChevronDown, X } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { classNames } from "./class-names.js";
import { Spinner } from "./feedback.js";
import { controlClassName, useFieldControl } from "./field.js";
import { Icon } from "./icon.js";
import { useUiLabels } from "./labels.js";

export interface ComboboxItem {
  value: string;
  label: string;
  description?: string;
  keywords?: readonly string[];
  group?: string;
  marker?: string;
}

export interface ComboboxPage {
  items: ComboboxItem[];
  nextCursor?: string | null;
}

export type ComboboxLoader = (query: string, cursor: string | null) => Promise<ComboboxPage>;

interface ComboboxCommonProps {
  items?: readonly ComboboxItem[];
  load?: ComboboxLoader;
  debounceMs?: number;
  placeholder?: string;
  emptyText?: string;
  invalid?: boolean;
  disabled?: boolean;
  muted?: boolean;
  "aria-label"?: string;
  renderItem?: (item: ComboboxItem) => ReactNode;
}

export interface SingleComboboxProps extends ComboboxCommonProps {
  multiple?: false;
  value: string | null;
  onValueChange: (value: string | null, item: ComboboxItem | null) => void;
  selectedItem?: ComboboxItem | null;
}

export interface MultiComboboxProps extends ComboboxCommonProps {
  multiple: true;
  value: readonly string[];
  onValueChange: (value: string[], items: ComboboxItem[]) => void;
  selectedItems?: readonly ComboboxItem[];
}

export type ComboboxProps = SingleComboboxProps | MultiComboboxProps;

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function matchesQuery(item: ComboboxItem, query: string): boolean {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalize([item.label, item.description ?? "", ...(item.keywords ?? [])].join(" "));
  return words.every((word) => haystack.includes(word));
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (delay <= 0) {
      setDebounced(value);
      return;
    }
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return delay <= 0 ? value : debounced;
}

interface Loaded {
  query: string;
  items: ComboboxItem[];
  nextCursor: string | null;
}

function useLoadedItems(load: ComboboxLoader | undefined, query: string, active: boolean) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  const run = useCallback(
    async (nextQuery: string, cursor: string | null, previous: ComboboxItem[]) => {
      if (!load) return;
      const id = ++request.current;
      setLoading(true);
      try {
        const page = await load(nextQuery, cursor);
        if (id !== request.current) return;
        setLoaded({
          query: nextQuery,
          items: [...previous, ...page.items],
          nextCursor: page.nextCursor ?? null,
        });
      } finally {
        if (id === request.current) setLoading(false);
      }
    },
    [load],
  );
  useEffect(() => {
    if (!active || !load) return;
    void run(query, null, []);
  }, [active, load, query, run]);
  const loadMore = () => {
    if (loaded?.nextCursor) void run(loaded.query, loaded.nextCursor, loaded.items);
  };
  return { loaded, loading, loadMore };
}

function groupItems(items: readonly ComboboxItem[]): [string | undefined, ComboboxItem[]][] {
  const groups = new Map<string | undefined, ComboboxItem[]>();
  for (const item of items) groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
  return [...groups];
}

export function Combobox(props: ComboboxProps) {
  const {
    items: staticItems,
    load,
    debounceMs = 250,
    placeholder,
    emptyText,
    invalid,
    disabled,
    muted,
    renderItem,
  } = props;
  const labels = useUiLabels();
  const field = useFieldControl();
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const known = useRef(new Map<string, ComboboxItem>()).current;
  const debouncedQuery = useDebounced(query, load ? debounceMs : 0);
  const { loaded, loading, loadMore } = useLoadedItems(load, debouncedQuery, open);

  const selectedValues: readonly string[] = props.multiple ? props.value : props.value ? [props.value] : [];
  const options = useMemo(() => {
    if (load) return loaded?.items ?? [];
    return (staticItems ?? []).filter((item) => matchesQuery(item, query));
  }, [load, loaded, staticItems, query]);

  for (const item of staticItems ?? []) known.set(item.value, item);
  for (const item of loaded?.items ?? []) known.set(item.value, item);
  for (const item of (props.multiple
    ? props.selectedItems
    : props.selectedItem
      ? [props.selectedItem]
      : []) ?? [])
    known.set(item.value, item);

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(0, options.length - 1)));
  }, [options.length]);

  const labelOf = (value: string) => known.get(value)?.label ?? value;
  const singleLabel = !props.multiple && props.value ? labelOf(props.value) : "";

  const itemsOf = (values: readonly string[]) =>
    values.map((value) => known.get(value) ?? { value, label: value });

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const choose = (item: ComboboxItem) => {
    if (props.multiple) {
      const next = props.value.includes(item.value)
        ? props.value.filter((value) => value !== item.value)
        : [...props.value, item.value];
      props.onValueChange(next, itemsOf(next));
      setQuery("");
      inputRef.current?.focus();
      return;
    }
    props.onValueChange(item.value, item);
    close();
  };

  const remove = (value: string) => {
    if (!props.multiple) return;
    const next = props.value.filter((entry) => entry !== value);
    props.onValueChange(next, itemsOf(next));
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const last = options.length - 1;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) {
          setOpen(true);
          setActive(0);
        } else setActive((current) => Math.min(last, current + 1));
        return;
      case "ArrowUp":
        event.preventDefault();
        if (!open) setOpen(true);
        setActive((current) => Math.max(0, current - 1));
        return;
      case "Home":
        if (!open) return;
        event.preventDefault();
        setActive(0);
        return;
      case "End":
        if (!open) return;
        event.preventDefault();
        setActive(Math.max(0, last));
        return;
      case "Enter": {
        if (!open) return;
        event.preventDefault();
        const item = options[active];
        if (item) choose(item);
        return;
      }
      case "Escape":
        if (!open) return;
        event.preventDefault();
        close();
        return;
      case "Backspace":
        if (props.multiple && query === "" && props.value.length > 0) {
          remove(props.value[props.value.length - 1] ?? "");
        }
        return;
      default:
        return;
    }
  };

  const activeItem = open ? options[active] : undefined;
  const showLoading = loading && options.length === 0;
  const pinnedFirst = groupItems(options);
  let index = -1;

  return (
    <PopoverPrimitive.Root open={open && !disabled} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <PopoverPrimitive.Anchor asChild>
        <div
          ref={wrapperRef}
          data-combobox=""
          className={classNames(
            controlClassName,
            "flex min-h-control-field w-full flex-wrap items-center gap-1 py-1",
            disabled && "cursor-not-allowed border-dashed bg-surface-sunken text-text-muted",
          )}
          {...(invalid ? { "data-invalid": "" } : {})}
        >
          {props.multiple
            ? props.value.map((value) => (
                <span
                  key={value}
                  className="inline-flex max-w-full items-center gap-1 rounded-sm bg-surface-sunken py-1 pr-1 pl-2 text-sm"
                >
                  <span className="truncate">{labelOf(value)}</span>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={labels.removeItem.replace("{item}", labelOf(value))}
                    onClick={() => remove(value)}
                    className="inline-flex rounded-sm text-text-muted hover:text-text focus-visible:focus-ring"
                  >
                    <Icon icon={X} size="sm" />
                  </button>
                </span>
              ))
            : null}
          <input
            ref={inputRef}
            {...field}
            role="combobox"
            type="text"
            autoComplete="off"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listId}
            {...(activeItem ? { "aria-activedescendant": optionId(active) } : {})}
            {...(props["aria-label"] ? { "aria-label": props["aria-label"] } : {})}
            {...(invalid ? { "aria-invalid": true } : {})}
            disabled={disabled}
            value={open || props.multiple ? query : singleLabel}
            placeholder={props.multiple && props.value.length > 0 ? undefined : (placeholder ?? singleLabel)}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
              setOpen(true);
            }}
            onClick={() => setOpen(true)}
            onKeyDown={onKeyDown}
            className={classNames(
              "h-control-sm min-w-0 flex-1 bg-transparent outline-none placeholder:text-text-muted",
              muted && !open && "text-text-muted",
            )}
          />
          <Icon icon={ChevronDown} className="text-text-muted" />
        </div>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (event.target instanceof Node && wrapperRef.current?.contains(event.target))
              event.preventDefault();
          }}
          data-combobox-content=""
          className="z-50 max-h-sidebar min-w-popover-trigger overflow-y-auto rounded-md border border-border bg-surface p-1 text-text shadow-popover"
        >
          <div id={listId} role="listbox" {...(props.multiple ? { "aria-multiselectable": true } : {})}>
            {pinnedFirst.map(([group, groupItemsList]) => (
              // biome-ignore lint/a11y/useSemanticElements: a listbox groups its options with role group, a fieldset is not allowed there
              <div key={group ?? ""} role="group" {...(group ? { "aria-label": group } : {})}>
                {group ? (
                  <div className="px-2 pt-2 pb-1 text-xs font-semibold tracking-label text-text-muted uppercase">
                    {group}
                  </div>
                ) : null}
                {groupItemsList.map((item) => {
                  index += 1;
                  const position = index;
                  const selected = selectedValues.includes(item.value);
                  return (
                    // biome-ignore lint/a11y/useFocusableInteractive: focus stays in the input, which points at the option with aria-activedescendant
                    // biome-ignore lint/a11y/useKeyWithClickEvents: the input handles the keyboard for all options
                    <div
                      key={item.value}
                      id={optionId(position)}
                      role="option"
                      aria-selected={selected}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseMove={() => setActive(position)}
                      onClick={() => choose(item)}
                      className={classNames(
                        "relative flex min-h-row cursor-default items-center gap-2 rounded-sm py-1 pr-2 pl-8 select-none",
                        position === active && "bg-hover",
                      )}
                    >
                      {selected ? (
                        <span className="absolute left-2 inline-flex">
                          <Icon icon={Check} className="text-accent" />
                        </span>
                      ) : null}
                      <span className="flex min-w-0 flex-1 flex-col">
                        {renderItem ? (
                          renderItem(item)
                        ) : (
                          <>
                            <span className="truncate">{item.label}</span>
                            {item.description ? (
                              <span className="truncate text-sm text-text-muted">{item.description}</span>
                            ) : null}
                          </>
                        )}
                      </span>
                      {item.marker ? (
                        <span className="pl-4 text-xs font-medium text-text-muted">{item.marker}</span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          {showLoading ? (
            <div className="flex items-center gap-2 px-2 py-2 text-text-muted">
              <Spinner label={labels.loading} />
              <span aria-hidden="true">{labels.loading}</span>
            </div>
          ) : null}
          {!loading && options.length === 0 ? (
            <div role="status" className="px-2 py-2 text-text-muted">
              {emptyText ?? labels.noMatches}
            </div>
          ) : null}
          {load && loaded?.nextCursor ? (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={loadMore}
              disabled={loading}
              className="mt-1 flex h-row w-full items-center justify-center rounded-sm text-accent hover:bg-hover focus-visible:focus-ring"
            >
              {labels.loadMore}
            </button>
          ) : null}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
