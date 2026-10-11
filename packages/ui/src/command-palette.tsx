import { Command } from "cmdk";
import type { LucideIcon } from "lucide-react";
import { Search } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Kbd } from "./feedback.js";
import { Icon } from "./icon.js";
import { useReturnFocus } from "./return-focus.js";

export interface CommandItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  shortcut?: string[];
  keywords?: string[];
  alwaysShown?: boolean;
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
  emptyText: string;
  groups: CommandGroup[];
  query?: string;
  onQueryChange?: (query: string) => void;
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
}: CommandPaletteProps) {
  const returnFocus = useReturnFocus(open);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-overlay p-4 sm:pt-12">
          <DialogPrimitive.Content
            onCloseAutoFocus={returnFocus}
            aria-describedby={undefined}
            className="w-full max-w-dialog-lg overflow-hidden rounded-lg bg-surface text-text shadow-dialog"
          >
            <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
            <Command label={label} loop>
              <div className="flex items-center gap-2 border-b border-border px-4">
                <Icon icon={Search} className="text-text-muted" />
                <Command.Input
                  {...(query !== undefined ? { value: query } : {})}
                  {...(onQueryChange ? { onValueChange: onQueryChange } : {})}
                  placeholder={placeholder}
                  className="h-control-lg w-full min-w-0 bg-transparent text-content text-text outline-none placeholder:text-text-muted"
                />
              </div>
              <Command.List className="max-h-sidebar overflow-y-auto p-2">
                <Command.Empty className="px-3 py-6 text-center text-text-muted">{emptyText}</Command.Empty>
                {groups
                  .filter((group) => group.items.length > 0)
                  .map((group) => (
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
                            onOpenChange(false);
                            item.onSelect();
                          }}
                          className="flex h-control-lg cursor-default items-center gap-3 rounded-sm px-3 select-none aria-selected:bg-selected aria-selected:text-selected-text"
                        >
                          {item.icon && <Icon icon={item.icon} className="text-text-muted" />}
                          <span className="flex-1 truncate">{item.label}</span>
                          {item.shortcut && (
                            <span className="flex gap-1">
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
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
