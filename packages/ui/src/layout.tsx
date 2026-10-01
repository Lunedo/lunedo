import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";
import { isValidElement, type ReactNode, useId } from "react";
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
}

export function PageHeader({
  title,
  description,
  icon,
  logo,
  context,
  actions,
  breadcrumbs,
}: PageHeaderProps) {
  const labels = useUiLabels();
  return (
    <header className="flex flex-wrap items-end gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav aria-label={labels.breadcrumbs}>
            <ol className="flex flex-wrap items-center gap-1 text-sm text-text-muted">
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
        <div className="flex items-center gap-3">
          {icon && (
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
              <Icon icon={icon} size="lg" />
            </span>
          )}
          <h1 className="min-w-0 text-xl font-semibold tracking-heading text-balance">{title}</h1>
        </div>
        {description && <p className="text-text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Section({
  title,
  icon,
  actions,
  children,
}: {
  title: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="overflow-hidden rounded-md border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border bg-surface-sunken px-4 py-3">
        {icon && <Icon icon={icon} className="text-text-muted" />}
        <h2 id={id} className="flex-1 font-semibold">
          {title}
        </h2>
        {actions}
      </div>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

export function SettingRow({
  label,
  description,
  meta,
  control,
}: {
  label: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  control: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 px-4 py-3">
      <div className="flex min-w-field flex-1 flex-col gap-1">
        <span className="font-medium text-text">{label}</span>
        {description && <span className="text-sm text-text-muted">{description}</span>}
        {meta && <span className="text-xs text-text-muted">{meta}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{control}</div>
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
}: {
  icon?: LucideIcon | ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
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
    </li>
  );
}
