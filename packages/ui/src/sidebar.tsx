import type { LucideIcon } from "lucide-react";
import { Slot } from "radix-ui";
import { type ComponentProps, type ReactNode, useId } from "react";
import { classNames } from "./class-names.js";
import { Icon } from "./icon.js";
import { TruncatedText } from "./truncated-text.js";

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

export function SidebarHeader({
  children,
  actions,
  eyebrow,
}: {
  children: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 px-2 pb-2">
      <div className="flex min-w-0 flex-1 flex-col">
        {eyebrow && <span className="truncate text-xs text-text-muted">{eyebrow}</span>}
        <h2 className="min-w-0 truncate text-content font-semibold">{children}</h2>
      </div>
      {actions}
    </div>
  );
}

export function SidebarGroup({
  label,
  variant = "default",
  children,
}: {
  label?: ReactNode;
  variant?: "default" | "divided";
  children: ReactNode;
}) {
  const id = useId();
  if (label === undefined || label === null) {
    return <ul className="flex flex-col gap-px">{children}</ul>;
  }
  return (
    <div
      data-sidebar-group={variant}
      className={classNames(
        "flex flex-col",
        variant === "divided" && "-mx-2 mt-3 border-t border-border px-2",
      )}
    >
      <h3
        id={id}
        className={classNames(
          "px-2 pb-1 tracking-label text-text-muted uppercase",
          variant === "divided" ? "pt-3 text-2xs font-bold" : "pt-4 text-xs font-semibold",
        )}
      >
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
    current ? "bg-accent font-semibold text-on-accent" : "hover:bg-hover",
    className,
  );
  const glyph = icon && <Icon icon={icon} className={current ? "text-on-accent" : "text-text-muted"} />;
  const text =
    typeof label === "string" ? (
      <TruncatedText text={label} className="flex-1" />
    ) : (
      <span className="min-w-0 flex-1 truncate">{label}</span>
    );
  const count = badge !== undefined && badge !== null && (
    <span className={classNames("text-xs", current ? "text-on-accent" : "text-text-muted")}>{badge}</span>
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
