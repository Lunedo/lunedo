import type { LucideIcon } from "lucide-react";
import { DropdownMenu, Popover as PopoverPrimitive, Tabs as TabsPrimitive } from "radix-ui";
import { type ReactNode, useRef } from "react";
import { classNames } from "./class-names.js";
import { WIDE_HIT_AREA } from "./hit-area.js";
import { Icon } from "./icon.js";
import { rememberMenuOpener } from "./return-focus.js";
import { ScrollArea } from "./scroll-area.js";

type Side = "top" | "right" | "bottom" | "left";
type Align = "start" | "center" | "end";

const SURFACE = "z-50 rounded-md border border-border bg-surface text-text shadow-popover";

export interface PopoverProps {
  trigger: ReactNode;
  children: ReactNode;
  align?: Align;
  side?: Side;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  label?: string;
}

export function Popover({
  trigger,
  children,
  align = "center",
  side = "bottom",
  open,
  onOpenChange,
  label,
}: PopoverProps) {
  return (
    <PopoverPrimitive.Root
      {...(open !== undefined ? { open } : {})}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align={align}
          side={side}
          sideOffset={6}
          collisionPadding={8}
          {...(label ? { "aria-label": label } : {})}
          className={classNames(SURFACE, "max-w-dialog-sm p-3 focus-visible:focus-ring")}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

export type MenuItem =
  | {
      type?: "item";
      label: string;
      icon?: LucideIcon;
      onSelect: () => void;
      danger?: boolean;
      disabled?: boolean;
      shortcut?: string;
    }
  | { type: "separator" }
  | { type: "label"; label: string };

export interface MenuProps {
  trigger: ReactNode;
  items: MenuItem[];
  align?: Align;
  side?: Side;
}

export function Menu({ trigger, items, align = "end", side = "bottom" }: MenuProps) {
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild ref={opener}>
        {trigger}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          side={side}
          sideOffset={4}
          collisionPadding={8}
          className={classNames(SURFACE, "min-w-field p-1")}
        >
          {items.map((item, index) => {
            if (item.type === "separator") {
              // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity besides their position
              return <DropdownMenu.Separator key={`separator-${index}`} className="my-1 h-px bg-border" />;
            }
            if (item.type === "label") {
              return (
                <DropdownMenu.Label
                  key={`label-${item.label}`}
                  className="px-2 pt-2 pb-1 text-xs font-semibold tracking-label text-text-muted uppercase"
                >
                  {item.label}
                </DropdownMenu.Label>
              );
            }
            return (
              <DropdownMenu.Item
                key={item.label}
                onSelect={() => {
                  rememberMenuOpener(opener.current);
                  item.onSelect();
                }}
                {...(item.disabled !== undefined ? { disabled: item.disabled } : {})}
                className={classNames(
                  "flex h-row cursor-default items-center gap-2 rounded-sm px-2 outline-none select-none data-disabled:cursor-not-allowed data-disabled:text-text-muted data-highlighted:bg-hover",
                  item.danger ? "text-danger" : "text-text",
                )}
              >
                {item.icon && <Icon icon={item.icon} className={item.danger ? "" : "text-text-muted"} />}
                <span className="flex-1">{item.label}</span>
                {item.shortcut && <span className="text-xs text-text-muted">{item.shortcut}</span>}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  tabs: { value: string; label: ReactNode; count?: number }[];
  label: string;
  children?: ReactNode;
}

export function Tabs({ value, onValueChange, tabs, label, children }: TabsProps) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onValueChange} className="flex flex-col gap-4">
      <ScrollArea surface="bg">
        <TabsPrimitive.List aria-label={label} className="flex w-max min-w-full gap-1 border-b border-border">
          {tabs.map((tab) => (
            <TabsPrimitive.Trigger
              key={tab.value}
              value={tab.value}
              className={classNames(
                WIDE_HIT_AREA,
                "-mb-px inline-flex h-control-field items-center gap-2 border-b-2 border-transparent px-3 font-medium whitespace-nowrap text-text-muted hover:text-text focus-visible:focus-ring aria-selected:border-accent aria-selected:text-text",
              )}
            >
              {tab.label}
              {tab.count !== undefined && <span className="text-text-muted">{tab.count}</span>}
            </TabsPrimitive.Trigger>
          ))}
        </TabsPrimitive.List>
      </ScrollArea>
      <TabsPrimitive.Content value={value} className="focus-visible:focus-ring">
        {children}
      </TabsPrimitive.Content>
    </TabsPrimitive.Root>
  );
}
