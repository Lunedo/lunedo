import type { TFunction } from "i18next";
import { User } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSession } from "../shell/shell-context.js";
import type { Space } from "./space-queries.js";

export function spaceDisplayName(
  t: TFunction,
  space: Pick<Space, "name" | "personal" | "ownerName"> & { ownerId?: string | null },
  viewerId?: string | null,
): string {
  if (space.name) return space.name;
  if (!space.personal) return "";
  if (viewerId && space.ownerId === viewerId) return t("spaces.personal.mine");
  return space.ownerName
    ? t("spaces.personal.nameOf", { name: space.ownerName })
    : t("spaces.personal.label");
}

export function useSpaceDisplayName() {
  const { t } = useTranslation();
  const viewerId = useSession().account?.id ?? null;
  return (space: Pick<Space, "name" | "personal" | "ownerName"> & { ownerId?: string | null }) =>
    spaceDisplayName(t, space, viewerId);
}

export function referenceSpaceName(t: TFunction, reference: { spaceName: string; mySpace: boolean }): string {
  return reference.mySpace ? t("spaces.personal.mine") : reference.spaceName;
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
