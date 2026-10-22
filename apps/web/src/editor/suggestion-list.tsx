import { classNames } from "@lunedo/ui";
import type { LucideIcon } from "lucide-react";
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";

export interface SuggestionEntry {
  id: string;
  label: string;
  description?: string;
  group?: string;
  hint?: string;
  icon?: LucideIcon;
  select(): void;
}

export interface SuggestionListProps {
  items: SuggestionEntry[];
  label: string;
  emptyText: string;
  loading?: boolean;
}

export interface SuggestionListHandle {
  onKeyDown(event: KeyboardEvent): boolean;
}

export function moveIndex(current: number, delta: number, length: number): number {
  if (length === 0) return 0;
  return (current + delta + length) % length;
}

export const SuggestionList = forwardRef<SuggestionListHandle, SuggestionListProps>(function SuggestionList(
  { items, label, emptyText, loading = false },
  ref,
) {
  const [active, setActive] = useState(0);
  const listId = useId();
  const container = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new list of entries starts at the first entry again
  useEffect(() => setActive(0), [items]);
  useEffect(() => {
    container.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  useImperativeHandle(
    ref,
    () => ({
      onKeyDown(event) {
        if (event.key === "ArrowDown") {
          setActive((index) => moveIndex(index, 1, items.length));
          return true;
        }
        if (event.key === "ArrowUp") {
          setActive((index) => moveIndex(index, -1, items.length));
          return true;
        }
        if (event.key === "Home") {
          setActive(0);
          return true;
        }
        if (event.key === "End") {
          setActive(Math.max(items.length - 1, 0));
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          const item = items[active];
          if (!item) return false;
          item.select();
          return true;
        }
        return false;
      },
    }),
    [items, active],
  );
  let previousGroup: string | undefined;
  return (
    <div
      ref={container}
      className="ld-suggestions max-h-card w-card overflow-y-auto rounded-md border border-border bg-surface p-1 text-text shadow-popover"
    >
      <div role="listbox" id={listId} aria-label={label}>
        {items.length === 0 ? (
          <p className="px-2 py-2 text-sm text-text-muted" role="status">
            {loading ? "…" : emptyText}
          </p>
        ) : null}
        {items.map((item, index) => {
          const heading = item.group && item.group !== previousGroup ? item.group : null;
          previousGroup = item.group;
          const Icon = item.icon;
          return (
            <div key={item.id}>
              {heading ? (
                <div
                  role="presentation"
                  className="px-2 pt-2 pb-1 text-xs font-semibold tracking-label text-text-muted uppercase"
                >
                  {heading}
                </div>
              ) : null}
              <div
                role="option"
                tabIndex={-1}
                data-index={index}
                aria-selected={index === active}
                className={classNames(
                  "flex min-h-hit cursor-default items-center gap-3 rounded-sm px-2 py-1",
                  index === active ? "bg-selected text-selected-text" : "",
                )}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  item.select();
                }}
              >
                {Icon ? (
                  <span className="flex size-control-sm shrink-0 items-center justify-center rounded-sm border border-border bg-surface">
                    <Icon aria-hidden="true" className="size-icon-md" />
                  </span>
                ) : null}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{item.label}</span>
                  {item.description ? (
                    <span className="truncate text-xs text-text-muted">{item.description}</span>
                  ) : null}
                </span>
                {item.hint ? <span className="font-mono text-xs text-text-muted">{item.hint}</span> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
