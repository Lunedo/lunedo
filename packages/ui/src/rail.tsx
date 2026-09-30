import type { ReactNode } from "react";
import { classNames } from "./class-names.js";

export interface RailProps {
  label: string;
  logo: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}

/** The narrow navigation column on the left edge of the application. */
export function Rail({ label, logo, children, footer }: RailProps) {
  return (
    <nav
      aria-label={label}
      className="flex w-rail shrink-0 flex-col items-center gap-1 bg-sidebar py-3 text-text-muted"
    >
      <div className="mb-2 flex size-10 items-center justify-center">{logo}</div>
      <ul className="flex flex-col items-center gap-1">{children}</ul>
      <ul className="mt-auto flex flex-col items-center gap-1">{footer}</ul>
    </nav>
  );
}

export interface RailButtonProps {
  label: string;
  icon: ReactNode;
  variant?: "default" | "primary";
  current?: boolean;
  onClick?: () => void;
}

export function RailButton({ label, icon, variant = "default", current = false, onClick }: RailButtonProps) {
  return (
    <li>
      <button
        type="button"
        aria-label={label}
        aria-current={current ? "page" : undefined}
        title={label}
        onClick={onClick}
        className={classNames(
          "flex size-10 items-center justify-center rounded-md transition-colors",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          variant === "primary" && "bg-accent text-on-accent hover:bg-accent-hover",
          variant === "default" && !current && "hover:bg-hover hover:text-text",
          variant === "default" && current && "bg-selected text-selected-text",
        )}
      >
        {icon}
      </button>
    </li>
  );
}
