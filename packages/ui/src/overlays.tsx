import { Check, type LucideIcon } from "lucide-react";
import { DropdownMenu, Popover as PopoverPrimitive, Tabs as TabsPrimitive } from "radix-ui";
import { type ReactNode, useRef } from "react";
import { classNames } from "./class-names.js";
import { FieldLayoutProvider } from "./field.js";
import { WIDE_HIT_AREA } from "./hit-area.js";
import { Icon } from "./icon.js";
import { rememberMenuOpener } from "./return-focus.js";
import { ScrollArea } from "./scroll-area.js";

type Side = "top" | "right" | "bottom" | "left";
type Align = "start" | "center" | "end";

const SURFACE = "z-50 rounded-md border border-border bg-surface text-text shadow-popover";

export interface PopoverAnchor {
  getBoundingClientRect(): DOMRect;
}

export interface PopoverProps {
  trigger?: ReactNode;
  anchor?: PopoverAnchor;
  children: ReactNode;
  align?: Align;
  side?: Side;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  label?: string;
  labelledBy?: string;
  onCloseAutoFocus?: (event: Event) => void;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  variant?: "default" | "panel";
}

export function Popover({
  trigger,
  anchor,
  children,
  align = "center",
  side = "bottom",
  open,
  onOpenChange,
  label,
  labelledBy,
  onCloseAutoFocus,
  onEscapeKeyDown,
  variant = "default",
}: PopoverProps) {
  const panel = variant === "panel";
  return (
    <PopoverPrimitive.Root
      {...(open !== undefined ? { open } : {})}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      {anchor ? <PopoverPrimitive.Anchor virtualRef={{ current: anchor }} /> : null}
      {trigger ? <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger> : null}
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align={align}
          side={side}
          sideOffset={panel ? 10 : 6}
          collisionPadding={panel ? 0 : 8}
          {...(label ? { "aria-label": label } : {})}
          {...(labelledBy ? { "aria-labelledby": labelledBy } : {})}
          {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}
          {...(onEscapeKeyDown ? { onEscapeKeyDown } : {})}
          {...(panel
            ? { style: { maxHeight: "min(70dvh, var(--radix-popover-content-available-height))" } }
            : {})}
          className={classNames(
            SURFACE,
            "focus-visible:focus-ring",
            panel
              ? "flex w-card max-w-screen flex-col overflow-hidden max-md:w-screen max-md:rounded-none max-md:border-x-0"
              : "max-w-dialog-sm p-3",
          )}
        >
          <FieldLayoutProvider layout="stacked">{children}</FieldLayoutProvider>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

export type MenuItem =
  | {
      type?: "item";
      label: string;
      icon: LucideIcon;
      onSelect: () => void;
      danger?: boolean;
      disabled?: boolean;
      shortcut?: string;
      checked?: boolean;
    }
  | { type: "separator" }
  | { type: "label"; label: string }
  | { type: "header"; title: string; description?: string };

export interface MenuProps {
  trigger: ReactNode;
  items: MenuItem[];
  align?: Align;
  side?: Side;
  runAfterClose?: boolean;
}

export function Menu({ trigger, items, align = "end", side = "bottom", runAfterClose = false }: MenuProps) {
  const opener = useRef<HTMLButtonElement>(null);
  const pending = useRef<(() => void) | null>(null);
  const select = (action: () => void) => {
    rememberMenuOpener(opener.current);
    if (runAfterClose) pending.current = action;
    else action();
  };
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
          onCloseAutoFocus={(event) => {
            const action = pending.current;
            if (!action) return;
            pending.current = null;
            event.preventDefault();
            action();
          }}
          style={{ maxHeight: "var(--radix-dropdown-menu-content-available-height)" }}
          className={classNames(SURFACE, "min-w-field overflow-y-auto p-1")}
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
            if (item.type === "header") {
              return (
                <div key={`header-${item.title}`} className="flex flex-col px-2 pt-2 pb-2">
                  <span className="truncate font-semibold" title={item.title}>
                    {item.title}
                  </span>
                  {item.description && (
                    <span className="truncate text-sm text-text-muted" title={item.description}>
                      {item.description}
                    </span>
                  )}
                </div>
              );
            }
            if (item.checked !== undefined) {
              return (
                <DropdownMenu.CheckboxItem
                  key={item.label}
                  checked={item.checked}
                  onSelect={() => select(item.onSelect)}
                  {...(item.disabled !== undefined ? { disabled: item.disabled } : {})}
                  className="flex h-row cursor-default items-center gap-2 rounded-sm px-2 text-text outline-none select-none data-disabled:cursor-not-allowed data-disabled:text-text-muted data-highlighted:bg-hover"
                >
                  <Icon icon={item.icon} className="text-text-muted" />
                  <span className="flex-1">{item.label}</span>
                  <DropdownMenu.ItemIndicator className="flex">
                    <Icon icon={Check} className="text-accent" />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.CheckboxItem>
              );
            }
            return (
              <DropdownMenu.Item
                key={item.label}
                onSelect={() => select(item.onSelect)}
                {...(item.disabled !== undefined ? { disabled: item.disabled } : {})}
                className={classNames(
                  "flex h-row cursor-default items-center gap-2 rounded-sm px-2 outline-none select-none data-disabled:cursor-not-allowed data-disabled:text-text-muted data-highlighted:bg-hover",
                  item.danger ? "text-danger" : "text-text",
                )}
              >
                <Icon icon={item.icon} className={item.danger ? "" : "text-text-muted"} />
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
  fill?: boolean;
}

export function Tabs({ value, onValueChange, tabs, label, children, fill = false }: TabsProps) {
  return (
    <TabsPrimitive.Root
      value={value}
      onValueChange={onValueChange}
      className={classNames("flex flex-col", fill ? "min-h-0 flex-1 gap-1" : "gap-4")}
    >
      <ScrollArea surface="bg" className="overflow-y-hidden">
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
      <TabsPrimitive.Content
        value={value}
        className={classNames("focus-visible:focus-ring", fill && "min-h-0 flex-1 overflow-y-auto")}
      >
        {children}
      </TabsPrimitive.Content>
    </TabsPrimitive.Root>
  );
}
