import type { TFunction } from "i18next";
import { User } from "lucide-react";
import type { Space } from "./space-queries.js";

export function spaceDisplayName(
  t: TFunction,
  space: Pick<Space, "name" | "personal" | "ownerName">,
): string {
  if (space.name) return space.name;
  return space.personal
    ? space.ownerName
      ? t("spaces.personal.nameOf", { name: space.ownerName })
      : t("spaces.personal.label")
    : "";
}

export function SpaceBadge({
  space,
  size = "md",
}: {
  space: Pick<Space, "key" | "personal">;
  size?: "sm" | "md";
}) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center bg-accent-soft font-semibold text-accent ${size === "sm" ? "size-6 rounded-sm text-2xs" : "size-8 rounded-md text-xs"}`}
    >
      {space.personal ? (
        <User className={size === "sm" ? "size-icon-sm" : "size-icon-md"} />
      ) : (
        space.key.slice(0, 2)
      )}
    </span>
  );
}
