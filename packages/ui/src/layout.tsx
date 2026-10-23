import type { LucideIcon } from "lucide-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Slot } from "radix-ui";
import { type ComponentProps, isValidElement, type ReactNode, useId } from "react";
import { classNames } from "./class-names.js";
import { Icon } from "./icon.js";
import { useUiLabels } from "./labels.js";

export interface Breadcrumb {
  label: ReactNode;
  href?: string;
}

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  logo?: ReactNode;
  context?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: Breadcrumb[];
  status?: ReactNode;
  variant?: "content" | "settings";
}

export function PageHeader({
  title,
  description,
  icon,
  logo,
  context,
  actions,
  breadcrumbs,
  status,
  variant = "content",
}: PageHeaderProps) {
  const labels = useUiLabels();
  const showIcon = icon && variant === "content";
  return (
    <header className="flex flex-wrap items-end gap-4">
      <div className="flex min-w-0 flex-1 basis-field flex-col gap-2">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav aria-label={labels.breadcrumbs}>
            <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 text-sm text-text-muted">
              {breadcrumbs.map((crumb, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a breadcrumb is identified by its position in the path
                <li key={index} className="inline-flex items-center gap-1">
                  {index > 0 && <Icon icon={ChevronRight} size="sm" />}
                  {crumb.href ? (
                    <a
                      href={crumb.href}
                      className="rounded-sm text-accent hover:underline focus-visible:focus-ring"
                    >
                      {crumb.label}
                    </a>
                  ) : (
                    <span aria-current={index === breadcrumbs.length - 1 ? "page" : undefined}>
                      {crumb.label}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        )}
        {(logo || context) && (
          <div className="flex items-center gap-2 text-sm text-text-muted">
            {logo}
            {context}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {showIcon && (
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
              <Icon icon={icon} size="lg" />
            </span>
          )}
          <h1 className="min-w-0 text-xl font-semibold tracking-heading text-balance">{title}</h1>
          {status && <div className="flex items-center text-sm">{status}</div>}
        </div>
        {description && <p className="text-text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Section({
  title,
  description,
  icon,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} data-section="" className="flex flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-2">
        {icon && <Icon icon={icon} className="text-text-muted" />}
        <h2 id={id} className="min-w-0 flex-1 font-semibold">
          {title}
        </h2>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {description && <p className="pb-2 text-sm text-text-muted">{description}</p>}
      <div className="divide-y divide-border border-t border-border">{children}</div>
    </section>
  );
}

export function DangerZone({ title, children }: { title: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} data-danger-zone="" className="flex flex-col">
      <h2 id={id} className="pb-2 font-semibold text-danger">
        {title}
      </h2>
      <div className="divide-y divide-border border-t border-border">{children}</div>
    </section>
  );
}

export function DangerAction({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description: ReactNode;
  action: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 py-3">
      <div className="flex min-w-0 flex-1 basis-field flex-col gap-1">
        <span className="font-medium text-text">{title}</span>
        <div className="text-sm text-text-muted">{description}</div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">{action}</div>
    </div>
  );
}

export interface SettingRowProps {
  label: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  control: ReactNode;
  menu?: ReactNode;
  status?: ReactNode;
}

export function SettingRow({ label, description, meta, control, menu, status }: SettingRowProps) {
  return (
    <div
      data-setting-row=""
      className="grid grid-cols-1 items-start gap-x-4 gap-y-2 py-3 sm:grid-cols-setting-row"
    >
      <div data-setting-label="" className="flex min-w-0 items-center text-text-muted sm:min-h-control-field">
        {label}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <div data-setting-line="" className="flex items-center justify-between gap-3">
          <div data-setting-control="" className="flex w-full min-w-0 sm:w-field">
            {control}
          </div>
          <div
            data-setting-menu=""
            className={classNames("w-control-md shrink-0 justify-end", menu ? "flex" : "hidden sm:flex")}
          >
            {menu}
          </div>
        </div>
        {description && (
          <div data-setting-hint="" className="text-sm text-text-muted">
            {description}
          </div>
        )}
        {meta && (
          <div data-setting-source="" className="text-xs text-text-muted">
            {meta}
          </div>
        )}
        {status && <div className="flex min-w-0">{status}</div>}
      </div>
    </div>
  );
}

export interface BackLinkProps extends Omit<ComponentProps<"a">, "children"> {
  label: ReactNode;
  asChild?: boolean;
  children?: ReactNode;
}

export function BackLink({ label, asChild = false, children, className, ...props }: BackLinkProps) {
  const classes = classNames(
    "inline-flex items-center gap-1 self-start rounded-sm text-sm text-text-muted hover:text-text focus-visible:focus-ring",
    className,
  );
  const content = (
    <>
      <Icon icon={ChevronLeft} size="sm" />
      <span className="min-w-0 truncate">{label}</span>
    </>
  );
  if (asChild) {
    return (
      <Slot.Root data-back-link="" className={classes}>
        <Slot.Slottable>{children}</Slot.Slottable>
        {content}
      </Slot.Root>
    );
  }
  return (
    <a data-back-link="" className={classes} {...props}>
      {content}
    </a>
  );
}

export interface PageContainerProps {
  width: "narrow" | "wide";
  children: ReactNode;
}

export function PageContainer({ width, children }: PageContainerProps) {
  return (
    <div
      data-page-width={width}
      className={classNames(
        "flex w-full flex-col gap-6 px-4 pt-6 pb-12 md:px-8",
        width === "narrow" && "mx-auto max-w-page",
      )}
    >
      {children}
    </div>
  );
}

export function List({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul aria-label={label} className="flex flex-col divide-y divide-border">
      {children}
    </ul>
  );
}

function isLucideIcon(value: unknown): value is LucideIcon {
  if (typeof value === "function") return true;
  return typeof value === "object" && value !== null && "$$typeof" in value && !isValidElement(value);
}

export function ListRow({
  icon,
  title,
  description,
  actions,
  children,
}: {
  icon?: LucideIcon | ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const glyph = isLucideIcon(icon) ? <Icon icon={icon} /> : icon;
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      {glyph && <span className="flex shrink-0 items-center text-text-muted">{glyph}</span>}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium text-text">{title}</span>
        {description && <div className="text-sm text-text-muted">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      {children && <div className="min-w-0 basis-full">{children}</div>}
    </li>
  );
}
