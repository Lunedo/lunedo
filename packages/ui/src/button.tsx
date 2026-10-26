import type { LucideIcon } from "lucide-react";
import { LoaderCircle } from "lucide-react";
import { Slot } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { classNames } from "./class-names.js";
import { HIT_AREA, WIDE_HIT_AREA } from "./hit-area.js";
import { Icon } from "./icon.js";
import { useUiLabels } from "./labels.js";
import { Tooltip } from "./tooltip.js";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "dangerPrimary";
export type ButtonSize = "sm" | "md" | "field" | "lg";

const BASE =
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border font-medium transition-colors focus-visible:focus-ring disabled:cursor-not-allowed disabled:border-dashed disabled:border-control-border disabled:bg-surface-sunken disabled:text-text-muted aria-busy:cursor-progress motion-reduce:transition-none";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "border-accent bg-accent font-semibold text-on-accent hover:border-accent-hover hover:bg-accent-hover",
  secondary: "border-control-border bg-control text-text hover:bg-control-hover",
  outline: "border-control-border bg-surface text-text hover:bg-control-hover",
  ghost: "border-transparent bg-transparent text-text hover:bg-hover",
  danger: "border-transparent bg-transparent text-danger hover:bg-danger-soft",
  dangerPrimary: "border-danger bg-danger font-semibold text-on-accent hover:opacity-90 disabled:opacity-100",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-control-sm px-2 text-sm",
  md: "h-control-md px-3 text-base",
  field: "h-control-field px-3 text-base",
  lg: "h-control-lg px-4 text-content",
};

export function buttonClassName({
  variant = "secondary",
  size = "md",
  block = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  className?: string | undefined;
}): string {
  return classNames(BASE, WIDE_HIT_AREA, VARIANTS[variant], SIZES[size], block && "w-full", className);
}

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  loading?: boolean;
  block?: boolean;
  asChild?: boolean;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  loading = false,
  block = false,
  asChild = false,
  className,
  children,
  disabled,
  type = "button",
  onClick,
  ...props
}: ButtonProps) {
  const labels = useUiLabels();
  const classes = buttonClassName({ variant, size, block, className });
  if (asChild) {
    return (
      <Slot.Root className={classes} {...props}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button
      type={type}
      className={classes}
      {...(disabled ? { disabled } : {})}
      {...(loading ? { "aria-busy": true, "aria-disabled": true } : {})}
      onClick={(event) => {
        if (loading) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      {...props}
    >
      {loading ? (
        <Icon icon={LoaderCircle} className="animate-spin motion-reduce:animate-none" />
      ) : (
        icon && <Icon icon={icon} />
      )}
      {children}
      {loading && <span className="sr-only">{labels.loading}</span>}
    </button>
  );
}

export function ButtonGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset
      aria-label={label}
      className="m-0 inline-flex min-w-0 items-stretch rounded-md border border-border bg-surface p-0 *:rounded-none *:border-0 *:not-first:border-l *:not-first:border-border *:first:rounded-l-md *:last:rounded-r-md"
    >
      {children}
    </fieldset>
  );
}

export type IconButtonVariant = "ghost" | "outline" | "primary";

const ICON_VARIANTS: Record<IconButtonVariant, string> = {
  ghost:
    "border-transparent bg-transparent text-text-muted hover:border-control-border hover:bg-control hover:text-text focus-visible:border-control-border",
  outline: "border-control-border bg-surface text-text hover:bg-control-hover",
  primary: "border-accent bg-accent text-on-accent hover:bg-accent-hover",
};

const ICON_SIZES: Record<ButtonSize, string> = {
  sm: "size-control-sm",
  md: "size-control-md",
  field: "size-control-field",
  lg: "size-control-lg",
};

export interface IconButtonProps extends Omit<ComponentProps<"button">, "children"> {
  label: string;
  icon: LucideIcon;
  variant?: IconButtonVariant;
  size?: ButtonSize;
  tooltip?: boolean;
  badge?: ReactNode;
}

export function IconButton({
  label,
  icon,
  variant = "ghost",
  size = "md",
  tooltip = true,
  badge,
  className,
  type = "button",
  ...props
}: IconButtonProps) {
  const button = (
    <button
      type={type}
      aria-label={label}
      className={classNames(BASE, HIT_AREA, ICON_VARIANTS[variant], ICON_SIZES[size], className)}
      {...props}
    >
      <Icon icon={icon} size={size === "lg" ? "lg" : "md"} />
      {badge !== undefined && badge !== null && (
        <span
          aria-hidden="true"
          className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-badge px-1 text-xs font-bold text-on-accent"
        >
          {badge}
        </span>
      )}
    </button>
  );
  return tooltip ? <Tooltip content={label}>{button}</Tooltip> : button;
}
