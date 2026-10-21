import type { LucideIcon } from "lucide-react";
import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert } from "lucide-react";
import { VisuallyHidden as VisuallyHiddenPrimitive } from "radix-ui";
import type { ReactNode } from "react";
import { classNames } from "./class-names.js";
import { Icon } from "./icon.js";

export type BadgeVariant = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const BADGES: Record<BadgeVariant, string> = {
  neutral: "bg-hover text-text-muted",
  accent: "bg-accent-soft text-accent",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};

export function Badge({
  variant = "neutral",
  icon,
  children,
}: {
  variant?: BadgeVariant;
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <span
      className={classNames(
        "inline-flex h-5 items-center gap-1 rounded-sm px-2 text-xs font-semibold whitespace-nowrap",
        BADGES[variant],
      )}
    >
      {icon && <Icon icon={icon} size="sm" />}
      {children}
    </span>
  );
}

const AVATAR_COLORS = [
  "bg-palette-petrol",
  "bg-palette-blue",
  "bg-palette-violet",
  "bg-palette-amber",
  "bg-palette-red",
  "bg-palette-green",
  "bg-palette-gray",
] as const;

const AVATAR_SIZES = { sm: "size-6 text-xs", md: "size-8 text-xs", lg: "size-10 text-sm" } as const;

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts.at(-1)] : [parts[0]];
  return letters
    .map((part) => Array.from(part ?? "")[0] ?? "")
    .join("")
    .toUpperCase();
}

export function avatarColor(name: string): (typeof AVATAR_COLORS)[number] {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
}

export function Avatar({
  name,
  src,
  size = "md",
  decorative = false,
}: {
  name: string;
  src?: string;
  size?: "sm" | "md" | "lg";
  decorative?: boolean;
}) {
  const classes = classNames(
    "inline-flex shrink-0 items-center justify-center rounded-full",
    AVATAR_SIZES[size],
  );
  if (src)
    return <img src={src} alt={decorative ? "" : name} className={classNames(classes, "object-cover")} />;
  return (
    <span
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": name })}
      className={classNames(classes, avatarColor(name), "font-bold text-bg")}
    >
      <span aria-hidden="true" data-initials={initialsOf(name)} />
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-surface-sunken text-text-muted">
        <Icon icon={icon} size="lg" />
      </span>
      <p className="font-semibold text-text">{title}</p>
      {description && <p className="max-w-dialog-sm text-text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={classNames(
        "block h-4 animate-pulse rounded-sm bg-hover motion-reduce:animate-none",
        className,
      )}
    />
  );
}

const LINE_WIDTHS = ["w-full", "w-5/6", "w-2/3", "w-3/4"] as const;

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <span aria-hidden="true" className="flex flex-col gap-2">
      {Array.from({ length: lines }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the lines are identical placeholders that never reorder
        <Skeleton key={index} className={LINE_WIDTHS[index % LINE_WIDTHS.length]} />
      ))}
    </span>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-text-muted">
      <Icon icon={LoaderCircle} className="animate-spin motion-reduce:animate-none" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-surface-sunken px-1 font-mono text-xs text-text-muted">
      {children}
    </kbd>
  );
}

export type NoticeVariant = "info" | "warning" | "danger" | "success";

const NOTICES: Record<NoticeVariant, { container: string; icon: string; glyph: LucideIcon }> = {
  info: { container: "bg-accent-soft", icon: "text-accent", glyph: Info },
  warning: { container: "bg-warning-soft", icon: "text-warning", glyph: TriangleAlert },
  danger: { container: "bg-danger-soft", icon: "text-danger", glyph: CircleAlert },
  success: { container: "bg-success-soft", icon: "text-success", glyph: CircleCheck },
};

export function Notice({
  variant = "info",
  title,
  children,
  action,
}: {
  variant?: NoticeVariant;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const style = NOTICES[variant];
  return (
    <div
      role={variant === "danger" ? "alert" : undefined}
      className={classNames(
        "flex flex-wrap items-start gap-3 rounded-md px-4 py-3 text-text",
        style.container,
      )}
    >
      <Icon icon={style.glyph} className={classNames("mt-1", style.icon)} />
      <div className="flex min-w-0 flex-1 basis-field flex-col gap-1">
        {title && <p className="font-semibold wrap-anywhere">{title}</p>}
        {children && <div className="wrap-anywhere">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <VisuallyHiddenPrimitive.Root>{children}</VisuallyHiddenPrimitive.Root>;
}
