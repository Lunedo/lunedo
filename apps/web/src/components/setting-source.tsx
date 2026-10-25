import { Badge, IconButton } from "@lunedo/ui";
import type { TFunction } from "i18next";
import { Lock, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SettingEntry } from "../api/organization-queries.js";

export type SettingLevel = "instance" | "organization" | "space" | "user";

export function inheritedValue(entry: SettingEntry, level: SettingLevel): unknown {
  const above = entry.levels.filter(
    (state) => state.level !== level && state.effective && state.value !== null && state.value !== undefined,
  );
  const order = ["instance", "organization", "space", "user"];
  const levelIndex = order.indexOf(level);
  const candidates = above.filter((state) => order.indexOf(state.level) < levelIndex);
  return candidates.at(-1)?.value ?? entry.defaultValue;
}

export function inheritedFrom(entry: SettingEntry, level: SettingLevel): string {
  const order = ["instance", "organization", "space", "user"];
  const levelIndex = order.indexOf(level);
  const source = entry.levels
    .filter(
      (state) =>
        order.indexOf(state.level) < levelIndex &&
        state.effective &&
        state.value !== null &&
        state.value !== undefined,
    )
    .at(-1);
  return source?.level ?? "default";
}

export function disabledReason(
  t: TFunction,
  entry: SettingEntry,
  level: SettingLevel,
  editable: boolean,
  organizationName?: string,
): string | undefined {
  if (entry.lockedBy && entry.lockedBy !== level) {
    return entry.lockedBy === "instance"
      ? t("settings.disabled.lockedByInstance")
      : t("settings.disabled.lockedByOrganization", { name: organizationName ?? "" });
  }
  return editable ? undefined : t("settings.disabled.noPermission");
}

export function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export function OwnValueChip({
  resetLabel,
  onReset,
}: {
  resetLabel: string;
  onReset?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  return (
    <span
      data-own-value=""
      className="inline-flex h-5 items-center gap-1 rounded-sm bg-accent-soft pl-2 text-xs font-medium text-accent whitespace-nowrap"
    >
      {t("settings.ownValue")}
      {onReset ? (
        <IconButton label={resetLabel} icon={RotateCcw} size="sm" onClick={onReset} />
      ) : (
        <span className="pr-2" />
      )}
    </span>
  );
}

export function SettingMarks({
  entry,
  level,
  own,
  differs,
  writable,
  label,
  organizationName,
  onReset,
}: {
  entry: SettingEntry;
  level: SettingLevel;
  own: boolean;
  differs: boolean;
  writable: boolean;
  label: string;
  organizationName?: string;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  if (entry.lockedBy && entry.lockedBy !== level) {
    return (
      <Badge variant="neutral" icon={Lock}>
        {entry.lockedBy === "instance"
          ? t("settings.source.lockedByInstance")
          : t("settings.source.lockedByOrganization", { name: organizationName ?? "" })}
      </Badge>
    );
  }
  if (!own) return null;
  return (
    <>
      {differs ? (
        <OwnValueChip
          resetLabel={t("settings.resetNamed", { name: label })}
          {...(writable ? { onReset } : {})}
        />
      ) : null}
      {entry.locked ? (
        <Badge variant="neutral" icon={Lock}>
          {t("settings.locked")}
        </Badge>
      ) : null}
    </>
  );
}
