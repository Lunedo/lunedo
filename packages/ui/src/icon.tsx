import { tokens } from "@pagehall/tokens";
import type { LucideIcon } from "lucide-react";
import { classNames } from "./class-names.js";

export type IconSize = "sm" | "md" | "lg";

const SIZES: Record<IconSize, string> = {
  sm: "size-icon-sm",
  md: "size-icon-md",
  lg: "size-icon-lg",
};

export function Icon({
  icon: Component,
  size = "md",
  className,
}: {
  icon: LucideIcon;
  size?: IconSize;
  className?: string;
}) {
  return (
    <Component
      aria-hidden="true"
      focusable="false"
      strokeWidth={tokens.icon.strokeWidth}
      className={classNames("shrink-0", SIZES[size], className)}
    />
  );
}
