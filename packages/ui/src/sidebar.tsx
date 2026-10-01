import type { LucideIcon } from "lucide-react";
import { Slot } from "radix-ui";
import { type ComponentProps, type ReactNode, useId } from "react";
import { classNames } from "./class-names.js";
import { Icon } from "./icon.js";

export function Sidebar({
  label,
  children,
  collapsed = false,
}: {
  label: string;
  children: ReactNode;
  collapsed?: boolean;
}) {
  return (
    <nav
      aria-label={label}
      data-collapsed={collapsed || undefined}
      className={classNames(
        "w-sidebar shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-bg px-2 py-4",
        collapsed ? "hidden" : "flex",
      )}
    >
      {children}
    </nav>
  );
}

export function SidebarHeader({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-2 pb-2">
      <h2 className="min-w-0 flex-1 truncate text-content font-semibold">{children}</h2>
      {actions}
    </div>
  );
}

export function SidebarGroup({ label, children }: { label: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col">
      <h3 id={id} className="px-2 pt-4 pb-1 text-xs font-semibold tracking-label text-text-muted uppercase">
        {label}
      </h3>
      <ul aria-labelledby={id} className="flex flex-col gap-px">
        {children}
      </ul>
    </div>
  );
}

export interface SidebarItemProps extends Omit<ComponentProps<"a">, "children"> {
  icon?: LucideIcon;
  label: ReactNode;
  current?: boolean;
  badge?: ReactNode;
  asChild?: boolean;
  children?: ReactNode;
}

export function SidebarItem({
  icon,
  label,
  current = false,
  badge,
  asChild = false,
  children,
  className,
  ...props
}: SidebarItemProps) {
  const classes = classNames(
    "flex h-row items-center gap-2 rounded-sm px-2 text-text transition-colors focus-visible:focus-ring motion-reduce:transition-none",
    current ? "bg-selected font-semibold text-selected-text" : "hover:bg-hover",
    className,
  );
  const glyph = icon && <Icon icon={icon} className={current ? "text-selected-text" : "text-text-muted"} />;
  const text = <span className="min-w-0 flex-1 truncate">{label}</span>;
  const count = badge !== undefined && badge !== null && (
    <span className="text-xs text-text-muted">{badge}</span>
  );
  return (
    <li>
      {asChild ? (
        <Slot.Root aria-current={current ? "page" : undefined} className={classes}>
          {glyph}
          <Slot.Slottable>{children}</Slot.Slottable>
          {text}
          {count}
        </Slot.Root>
      ) : (
        <a aria-current={current ? "page" : undefined} className={classes} {...props}>
          {glyph}
          {text}
          {count}
        </a>
      )}
    </li>
  );
}
