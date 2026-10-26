import { Badge, IconButton } from "@lunedo/ui";
import type { TFunction } from "i18next";
import { Lock, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SettingEntry } from "../api/organization-queries.js";
import type { SettingField } from "../settings/setting-fields.js";

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

export interface InstanceBound {
  direction: "lower" | "higher";
  value: unknown;
}

export function instanceBound(entry: SettingEntry, level: SettingLevel): InstanceBound | null {
  if (level === "instance") return null;
  if (typeof entry.maximum === "number") return { direction: "lower", value: entry.maximum };
  if (typeof entry.minimum === "number") return { direction: "higher", value: entry.minimum };
  if (!entry.stricterOnly) return null;
  const instanceState = entry.levels.find((state) => state.level === "instance");
  if (!instanceState || instanceState.value === null || instanceState.value === undefined) return null;
  return { direction: entry.stricterOnly, value: instanceState.value };
}

export function boundedField(field: SettingField, bound: InstanceBound | null): SettingField {
  if (!bound || typeof bound.value !== "number") return field;
  const type = field.type;
  if (type.kind !== "number" && type.kind !== "duration") return field;
  const limit = bound.value;
  const narrowed =
    bound.direction === "lower"
      ? { ...type, max: Math.min(type.max, limit) }
      : { ...type, min: Math.max(type.min, limit) };
  if (narrowed.kind === "duration" && bound.direction === "lower") {
    const { nullable: _nullable, ...withoutNoLimit } = narrowed;
    return { ...field, type: withoutNoLimit };
  }
  if (narrowed.kind === "number" && bound.direction === "lower") {
    const { unlimited: _unlimited, ...withoutUnlimited } = narrowed;
    return { ...field, type: withoutUnlimited };
  }
  return { ...field, type: narrowed };
}

export function BoundMark({
  bound,
  formatValue,
}: {
  bound: InstanceBound;
  formatValue: (value: unknown) => string;
}) {
  const { t } = useTranslation();
  const text =
    typeof bound.value === "boolean"
      ? t("settings.bound.required")
      : t(bound.direction === "lower" ? "settings.bound.atMost" : "settings.bound.atLeast", {
          value: formatValue(bound.value),
        });
  return (
    <span data-instance-bound="" className="text-text-muted text-xs whitespace-nowrap">
      {text}
    </span>
  );
}
