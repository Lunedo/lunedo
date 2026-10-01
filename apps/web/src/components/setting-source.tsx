import type { TFunction } from "i18next";
import { Link2, Lock, PenLine } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SettingEntry } from "../api/organization-queries.js";

export type SettingLevel = "instance" | "organization" | "user";

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

export function SettingSource({
  entry,
  level,
  organizationName,
  formatValue,
}: {
  entry: SettingEntry;
  level: SettingLevel;
  organizationName?: string;
  formatValue: (value: unknown) => string;
}) {
  const { t } = useTranslation();
  const className = "inline-flex items-center gap-1 text-text-muted text-xs";
  const icon = "size-icon-sm shrink-0";
  if (entry.lockedBy && entry.lockedBy !== level) {
    return (
      <span className={className}>
        <Lock aria-hidden="true" className={icon} />
        {entry.lockedBy === "instance"
          ? t("settings.source.lockedByInstance")
          : t("settings.source.lockedByOrganization", { name: organizationName ?? "" })}
      </span>
    );
  }
  if (entry.source === level) {
    return (
      <span className={className}>
        <PenLine aria-hidden="true" className={icon} />
        {level === "user"
          ? t("settings.source.setByYou")
          : level === "organization"
            ? t("settings.source.setForOrganization", { name: organizationName ?? "" })
            : t("settings.source.setForInstance")}
        {entry.locked ? ` · ${t("settings.source.lockedBelow")}` : ""}
      </span>
    );
  }
  const from = inheritedFrom(entry, level);
  const value = formatValue(inheritedValue(entry, level));
  return (
    <span className={className}>
      <Link2 aria-hidden="true" className={icon} />
      {from === "organization"
        ? t("settings.source.fromOrganization", { name: organizationName ?? "", value })
        : from === "instance"
          ? t("settings.source.fromInstance", { value })
          : t("settings.source.fromDefault", { value })}
      {entry.locked ? ` · ${t("settings.source.lockedBelow")}` : ""}
    </span>
  );
}
