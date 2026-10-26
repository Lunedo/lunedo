import { classNames } from "@lunedo/ui";
import { Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

export function ShellBanner({
  variant,
  title,
  children,
  role,
}: {
  variant: "info" | "warning";
  title: ReactNode;
  children?: ReactNode;
  role?: "status";
}) {
  const Glyph = variant === "warning" ? TriangleAlert : Info;
  return (
    <section
      {...(role ? { role } : {})}
      className={classNames(
        "flex items-start gap-3 border-b border-border px-4 py-2 text-sm",
        variant === "warning" ? "bg-warning-soft" : "bg-info-soft",
      )}
    >
      <Glyph
        aria-hidden="true"
        className={classNames("size-icon-md shrink-0", variant === "warning" ? "text-warning" : "text-info")}
      />
      <div className="min-w-0 flex-1 wrap-anywhere text-text">
        <span className="font-semibold">{title}</span>
        {children ? <span> {children}</span> : null}
      </div>
    </section>
  );
}
