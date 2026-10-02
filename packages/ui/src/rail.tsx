import { Slot } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { classNames } from "./class-names.js";
import { Tooltip } from "./tooltip.js";

export interface RailProps {
  label: string;
  logo: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}

export function Rail({ label, logo, children, footer }: RailProps) {
  return (
    <nav
      aria-label={label}
      className="flex w-rail shrink-0 flex-col items-center gap-1 border-r border-border bg-sidebar py-3 text-text-muted"
    >
      <div className="mb-2 flex size-10 items-center justify-center">{logo}</div>
      <ul className="flex flex-col items-center gap-1">{children}</ul>
      <ul className="mt-auto flex flex-col items-center gap-1">{footer}</ul>
    </nav>
  );
}

function railClassName(variant: "default" | "primary", current: boolean): string {
  return classNames(
    "relative flex size-10 items-center justify-center rounded-md transition-colors focus-visible:focus-ring motion-reduce:transition-none",
    variant === "primary" && "my-1 size-control-field bg-accent text-on-accent hover:bg-accent-hover",
    variant === "default" && !current && "hover:bg-hover hover:text-text",
    variant === "default" && current && "bg-selected text-selected-text",
  );
}

function RailBadge({ badge }: { badge: ReactNode }) {
  if (badge === undefined || badge === null || badge === false) return null;
  return (
    <span
      aria-hidden="true"
      className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-badge px-1 text-xs font-bold text-on-accent"
    >
      {badge}
    </span>
  );
}

export interface RailButtonProps extends Omit<ComponentProps<"button">, "children"> {
  label: string;
  icon: ReactNode;
  variant?: "default" | "primary";
  current?: boolean;
  badge?: ReactNode;
  asChild?: boolean;
  children?: ReactNode;
}

export function RailButton({
  label,
  icon,
  variant = "default",
  current = false,
  badge,
  asChild = false,
  children,
  className,
  ...props
}: RailButtonProps) {
  const classes = classNames(railClassName(variant, current), className);
  const content = (
    <>
      {icon}
      <RailBadge badge={badge} />
    </>
  );
  return (
    <li>
      <Tooltip content={label} side="right">
        {asChild ? (
          <Slot.Root aria-label={label} aria-current={current ? "page" : undefined} className={classes}>
            {icon}
            <Slot.Slottable>{children}</Slot.Slottable>
            <RailBadge badge={badge} />
          </Slot.Root>
        ) : (
          <button
            type="button"
            aria-label={label}
            aria-current={current ? "page" : undefined}
            className={classes}
            {...props}
          >
            {content}
          </button>
        )}
      </Tooltip>
    </li>
  );
}

export interface RailLinkProps extends Omit<ComponentProps<"a">, "children"> {
  label: string;
  icon: ReactNode;
  href: string;
  current?: boolean;
  badge?: ReactNode;
}

export function RailLink({ label, icon, href, current = false, badge, className, ...props }: RailLinkProps) {
  return (
    <li>
      <Tooltip content={label} side="right">
        <a
          href={href}
          aria-label={label}
          aria-current={current ? "page" : undefined}
          className={classNames(railClassName("default", current), className)}
          {...props}
        >
          {icon}
          <RailBadge badge={badge} />
        </a>
      </Tooltip>
    </li>
  );
}
