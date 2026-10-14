import { Command } from "cmdk";
import type { LucideIcon } from "lucide-react";
import { Search } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Kbd, Spinner } from "./feedback.js";
import { Icon } from "./icon.js";
import { useReturnFocus } from "./return-focus.js";

export interface CommandItem {
  id: string;
  label: string;
  labelContent?: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  shortcut?: string[];
  keywords?: string[];
  alwaysShown?: boolean;
  href?: string;
  keepOpen?: boolean;
  onSelect: () => void;
}

export interface CommandGroup {
  heading: string;
  items: CommandItem[];
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  placeholder: string;
  emptyText: ReactNode;
  groups: CommandGroup[];
  query?: string;
  onQueryChange?: (query: string) => void;
  filter?: boolean;
  icon?: LucideIcon;
  toolbar?: ReactNode;
  status?: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
  busyLabel?: string;
  closeHint?: string;
  onOpenInNewTab?: (item: CommandItem) => void;
}

function openInNewTab(item: CommandItem): void {
  if (item.href) globalThis.open(item.href, "_blank", "noopener");
}

export function CommandPalette({
  open,
  onOpenChange,
  label,
  placeholder,
  emptyText,
  groups,
  query,
  onQueryChange,
  filter = true,
  icon = Search,
  toolbar,
  status,
  footer,
  busy,
  busyLabel,
  closeHint,
  onOpenInNewTab = openInNewTab,
}: CommandPaletteProps) {
  const returnFocus = useReturnFocus(open);
  const visible = useMemo(() => groups.filter((group) => group.items.length > 0), [groups]);
  const items = useMemo(() => visible.flatMap((group) => group.items), [visible]);
  const [selected, setSelected] = useState("");
  const moved = useRef(false);
  const ids = items.map((item) => item.id).join("\n");

  useEffect(() => {
    if (filter) return;
    const list = ids.split("\n");
    const first = list[0] ?? "";
    setSelected((current) => (moved.current && list.includes(current) ? current : first));
  }, [filter, ids]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) moved.current = true;
    if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
    const item = items.find((candidate) => candidate.id === selected);
    if (!item?.href) return;
    event.preventDefault();
    onOpenInNewTab(item);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-overlay p-4 sm:pt-12">
          <DialogPrimitive.Content
            onCloseAutoFocus={returnFocus}
            aria-describedby={undefined}
            className="flex max-h-full w-full max-w-dialog-lg flex-col overflow-hidden rounded-lg bg-surface text-text shadow-dialog"
          >
            <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
            <Command
              label={label}
              loop
              shouldFilter={filter}
              value={selected}
              onValueChange={setSelected}
              onKeyDown={onKeyDown}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="flex items-center gap-2 border-b border-border px-4">
                <Icon icon={icon} className="text-text-muted" />
                <Command.Input
                  {...(query !== undefined ? { value: query } : {})}
                  onValueChange={(value) => {
                    moved.current = false;
                    onQueryChange?.(value);
                  }}
                  placeholder={placeholder}
                  className="h-control-lg w-full min-w-0 bg-transparent text-content text-text outline-none placeholder:text-text-muted"
                />
                {busy && busyLabel ? <Spinner label={busyLabel} /> : null}
                {closeHint ? <Kbd>{closeHint}</Kbd> : null}
              </div>
              {toolbar ? <div className="border-b border-border px-4 py-2">{toolbar}</div> : null}
              {status ? <div className="px-4 pt-3">{status}</div> : null}
              <Command.List
                {...(busy ? { "aria-busy": true } : {})}
                className="min-h-0 flex-1 overflow-y-auto p-2"
              >
                <Command.Empty className="px-3 py-6 text-center text-text-muted">{emptyText}</Command.Empty>
                {visible.map((group) => (
                  <Command.Group
                    key={group.heading}
                    heading={
                      <span className="block px-3 pt-2 pb-1 text-xs font-semibold text-text-muted">
                        {group.heading}
                      </span>
                    }
                  >
                    {group.items.map((item) => (
                      <Command.Item
                        key={item.id}
                        value={item.id}
                        keywords={[item.label, ...(item.keywords ?? [])]}
                        {...(item.alwaysShown ? { forceMount: true } : {})}
                        onSelect={() => {
                          if (!item.keepOpen) onOpenChange(false);
                          item.onSelect();
                        }}
                        className="flex min-h-hit cursor-default items-center gap-3 rounded-sm px-3 py-1 select-none aria-selected:bg-selected aria-selected:text-selected-text"
                      >
                        {item.icon && <Icon icon={item.icon} className="shrink-0 text-text-muted" />}
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate" title={item.label}>
                            {item.labelContent ?? item.label}
                          </span>
                          {item.description ? (
                            <span className="line-clamp-1 text-sm text-text-muted">{item.description}</span>
                          ) : null}
                        </span>
                        {item.shortcut && (
                          <span className="flex shrink-0 gap-1">
                            {item.shortcut.map((key) => (
                              <Kbd key={key}>{key}</Kbd>
                            ))}
                          </span>
                        )}
                      </Command.Item>
                    ))}
                  </Command.Group>
                ))}
              </Command.List>
            </Command>
            {footer ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-2 text-sm text-text-muted">
                {footer}
              </div>
            ) : null}
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
