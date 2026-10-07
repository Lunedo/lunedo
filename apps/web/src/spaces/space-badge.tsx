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

export function SpaceBadge({ space }: { space: Pick<Space, "key" | "personal"> }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-xs font-semibold text-accent"
    >
      {space.personal ? <User className="size-icon" /> : space.key.slice(0, 2)}
    </span>
  );
}
